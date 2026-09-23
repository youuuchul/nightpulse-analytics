import { useMemo } from 'react'
import { bucketed, inRange, segFilter, sum } from '../lib/agg'
import { addDays, md, mondayOf } from '../lib/date'
import { num, pct, ratio } from '../lib/format'
import { S } from '../lib/labels'
import { F, uniquePersons } from '../lib/persons'
import { ready, useTable, waitOf } from '../lib/source'
import { TimeChart } from '../components/charts'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, hourTip, hourX, ptDelta, type TabProps, weekTip } from './common'
import Subscription from './Subscription'

function MemberView({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = sum(inRange(m, range.from, range.to), ['new_persons', 'signups'])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), ['new_persons', 'signups'])
  const pdL = useTable(data, 'person_day')
  const hourL = useTable(data, 'hourly_metrics', range.oneDay)
  const pd = ready(pdL)
  const pw = waitOf(pdL)
  const visitors = (from: string, to: string) => {
    if (!pd) {
      const rows = inRange(m, from, to)
      return {
        all: sum(rows, ['persons']).persons,
        member: sum(rows.filter((r) => r.member_seg === 'member'), ['persons']).persons,
      }
    }
    const u = uniquePersons(pd, from, to, F.visited, { ch: s.ch, pf: s.pf, ms: s.ms }, (r) => ['', r.member_seg])
    return { all: u.get('') ?? 0, member: u.get('member') ?? 0 }
  }
  const vCur = useMemo(() => visitors(range.from, range.to), [data, pd, m, range.from, range.to])
  const vPrev = useMemo(() => visitors(range.prevFrom, range.prevTo), [data, pd, m, range.prevFrom, range.prevTo])
  const memCur = vCur.member
  const memPrev = vPrev.member
  const conv = ratio(cur.signups, cur.new_persons)

  const split = useMemo(() => {
    const rows = inRange(m, range.from, range.to).map((r) => ({
      kst_date: r.kst_date,
      member: r.member_seg === 'member' ? r.persons : 0,
      guest: r.member_seg === 'guest' ? r.persons : 0,
    }))
    const b = bucketed(rows, ['member', 'guest'], range)
    if (!b.weekly || !pd) return b
    const u = uniquePersons(pd, range.from, range.to, F.visited, { ch: s.ch, pf: s.pf, ms: s.ms }, (r) => [
      `${mondayOf(addDays(range.from, r.off))}|${r.member_seg}`,
    ])
    return {
      weekly: true,
      rows: b.rows.map((r) => ({ ...r, member: u.get(`${r.date}|member`) ?? 0, guest: u.get(`${r.date}|guest`) ?? 0 })),
    }
  }, [data, pd, m, range])

  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, member: 0, guest: 0 }))
    for (const r of ready(hourL) ?? [])
      if (r.kst_date === range.from && seg(r)) out[r.kst_hour][r.member_seg] += r.sessions
    return out
  }, [hourL, range.from, s.ch, s.pf, s.ms])

  const lastFullWeek = mondayOf(addDays(data.meta.to_date, -6))
  const cohort = useMemo(() => {
    const first = mondayOf(range.from) < range.from ? addDays(mondayOf(range.from), 7) : range.from
    const size = new Map<number, [number, number]>()
    const weeks = new Set<string>()
    const all = new Set<string>()
    const at4 = new Set<string>()
    for (const r of data.weekly_cohort) {
      if (r.cohort_week < first || r.cohort_week > range.to || !seg(r)) continue
      all.add(r.cohort_week)
      if (addDays(r.cohort_week, 7 * r.week_offset) > lastFullWeek) continue
      if (r.week_offset >= 1) weeks.add(r.cohort_week)
      if (r.week_offset === 4) at4.add(r.cohort_week)
      const z = size.get(r.week_offset) ?? [0, 0]
      z[0] += r.cohort_size
      z[1] += r.retained
      size.set(r.week_offset, z)
    }
    const curve = Array.from({ length: 12 }, (_, i) => {
      const k = i + 1
      const z = size.get(k)
      return { week: `W${k}`, rate: z && z[0] > 0 ? z[1] / z[0] : null }
    }).filter((x) => x.rate != null)
    const at = (k: number) => {
      const z = size.get(k)
      return z && z[0] > 0 ? { rate: z[1] / z[0], n: z[0] } : null
    }
    const span = (v: Set<string>) => {
      const ws = [...v].sort()
      if (!ws.length) return ''
      return ws.length === 1 ? `${md(ws[0])} 주` : `${md(ws[0])}~${md(ws[ws.length - 1])} 주`
    }
    return { curve, w1: at(1), w4: at(4), span: span(weeks.size ? weeks : all), span4: span(at4.size ? at4 : all) }
  }, [data, range.from, range.to, s.ch, s.pf, s.ms, lastFullWeek])

  const series = [
    { key: 'member', label: '회원', color: S(1) },
    { key: 'guest', label: '비회원', color: S(2) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow>
        <Tile metricId="C10" label="가입" value={num(cur.signups)} unit="명" delta={delta(data, range, cur.signups, prev.signups)} />
        <Tile
          metricId="C01"
          label="신규 방문자 대비 가입"
          value={pct(conv)}
          sub={`신규 ${num(cur.new_persons)}명 중`}
          delta={ptDelta(data, range, conv, ratio(prev.signups, prev.new_persons))}
        />
        <Tile
          metricId="V14"
          label="회원 방문자"
          value={num(memCur)}
          unit="명"
          delta={delta(data, range, memCur, memPrev)}
          wait={pw}
        />
        <Tile
          metricId="V15"
          label="방문자 중 회원 비중"
          value={pct(ratio(memCur, vCur.all))}
          sub={`방문자 ${num(vCur.all)}명 중`}
          delta={ptDelta(data, range, ratio(memCur, vCur.all), ratio(memPrev, vPrev.all))}
          wait={pw}
        />
        <Tile
          metricId="R01"
          label={cohort.span ? `W1 리텐션 · ${cohort.span}` : 'W1 리텐션'}
          value={pct(cohort.w1?.rate)}
          sub={cohort.w1 ? `코호트 ${num(cohort.w1.n)}명` : '1주 경과 전'}
        />
        <Tile
          metricId="R01"
          label={cohort.span4 ? `W4 리텐션 · ${cohort.span4}` : 'W4 리텐션'}
          value={pct(cohort.w4?.rate)}
          sub={cohort.w4 ? `코호트 ${num(cohort.w4.n)}명` : '4주 경과 전'}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card
          title={range.oneDay ? '시간별 세션 · 회원 구분' : '방문자 · 회원 구분'}
          meta={range.oneDay ? range.from : `${grain(split.weekly)} · 명`}
          right={<Legend items={series} />}
          wait={range.oneDay ? waitOf(hourL) : split.weekly ? pw : null}
          waitH={260}
        >
          {range.oneDay ? (
            <TimeChart data={hourly} xKey="hour" xFormat={hourX} tipTitle={hourTip} kind="stack" series={series} height={260} />
          ) : (
            <TimeChart data={split.rows} kind="stack" tipTitle={weekTip(split.weekly)} series={series} height={260} />
          )}
        </Card>
        <Card title="리텐션 곡선" metricId="R01" meta={cohort.span ? `첫 방문 코호트 ${cohort.span}` : '첫 방문 코호트'}>
          {cohort.curve.length > 0 ? (
            <TimeChart
              data={cohort.curve as { week: string; rate: number }[]}
              xKey="week"
              xFormat={(v) => String(v)}
              kind="line"
              decimals
              yFormat={(v) => `${Math.round(v * 100)}%`}
              valueFormat={(v) => pct(v)}
              series={[{ key: 'rate', label: '재방문', color: S(1) }]}
              height={260}
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted">완결 코호트 없음</div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function Members(p: TabProps) {
  if (p.s.view === 'subscription') return <Subscription {...p} />
  return <MemberView {...p} />
}
