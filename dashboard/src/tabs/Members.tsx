import { useMemo } from 'react'
import { bucketed, inRange, segFilter, sum } from '../lib/agg'
import { addDays, md, mondayOf } from '../lib/date'
import { num, pct, ratio } from '../lib/format'
import { S } from '../lib/labels'
import { TimeChart } from '../components/charts'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, hourTip, hourX, ptDelta, type TabProps, weekTip } from './common'

export default function Members({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = sum(inRange(m, range.from, range.to), ['persons', 'new_persons', 'signups'])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), ['persons', 'new_persons', 'signups'])
  const memberRows = (from: string, to: string) =>
    sum(inRange(m, from, to).filter((r) => r.member_seg === 'member'), ['persons']).persons
  const memCur = memberRows(range.from, range.to)
  const memPrev = memberRows(range.prevFrom, range.prevTo)
  const conv = ratio(cur.signups, cur.new_persons)

  const split = useMemo(() => {
    const rows = inRange(m, range.from, range.to).map((r) => ({
      kst_date: r.kst_date,
      member: r.member_seg === 'member' ? r.persons : 0,
      guest: r.member_seg === 'guest' ? r.persons : 0,
    }))
    return bucketed(rows, ['member', 'guest'], range)
  }, [m, range])

  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, member: 0, guest: 0 }))
    for (const r of data.hourly_metrics)
      if (r.kst_date === range.from && seg(r)) out[r.kst_hour][r.member_seg] += r.sessions
    return out
  }, [data, range.from, s.ch, s.pf, s.ms])

  const lastFullWeek = mondayOf(addDays(data.meta.to_date, -6))
  const cohort = useMemo(() => {
    const first = mondayOf(range.from) < range.from ? addDays(mondayOf(range.from), 7) : range.from
    const size = new Map<number, [number, number]>()
    const weeks = new Set<string>()
    for (const r of data.weekly_cohort) {
      if (r.cohort_week < first || r.cohort_week > range.to || !seg(r)) continue
      if (addDays(r.cohort_week, 7 * r.week_offset) > lastFullWeek) continue
      if (r.week_offset >= 1) weeks.add(r.cohort_week)
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
    const ws = [...weeks].sort()
    return { curve, w1: at(1), w4: at(4), span: ws.length ? `${md(ws[0])}~${md(ws[ws.length - 1])} 주` : '' }
  }, [data, range.from, range.to, s.ch, s.pf, s.ms, lastFullWeek])

  const series = [
    { key: 'member', label: '회원', color: S(1) },
    { key: 'guest', label: '비회원', color: S(2) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow>
        <Tile label="가입" value={num(cur.signups)} unit="명" delta={delta(data, range, cur.signups, prev.signups)} />
        <Tile
          label="신규 방문자 대비 가입"
          value={pct(conv)}
          sub={`신규 ${num(cur.new_persons)}명 중`}
          delta={ptDelta(data, range, conv, ratio(prev.signups, prev.new_persons))}
        />
        <Tile
          label={range.oneDay ? '회원 방문자' : '회원 방문자 · 일평균'}
          value={num(memCur / range.days)}
          unit="명"
          delta={delta(data, range, memCur, memPrev)}
        />
        <Tile
          label="방문자 중 회원 비중"
          value={pct(ratio(memCur, cur.persons))}
          sub={`방문자 ${num(cur.persons)}명·일 중`}
          delta={ptDelta(data, range, ratio(memCur, cur.persons), ratio(memPrev, prev.persons))}
        />
        <Tile
          label="W1 리텐션"
          value={pct(cohort.w1?.rate)}
          sub={cohort.w1 ? `코호트 ${num(cohort.w1.n)}명 · ${cohort.span}` : '완결 코호트 없음'}
        />
        <Tile
          label="W4 리텐션"
          value={pct(cohort.w4?.rate)}
          sub={cohort.w4 ? `코호트 ${num(cohort.w4.n)}명` : '완결 코호트 없음'}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card
          title={range.oneDay ? '시간별 세션 · 회원 구분' : '방문자 · 회원 구분'}
          meta={range.oneDay ? range.from : `${grain(split.weekly)} · 사람`}
          right={<Legend items={series} />}
        >
          {range.oneDay ? (
            <TimeChart data={hourly} xKey="hour" xFormat={hourX} tipTitle={hourTip} kind="stack" series={series} height={260} />
          ) : (
            <TimeChart data={split.rows} kind="stack" tipTitle={weekTip(split.weekly)} series={series} height={260} />
          )}
        </Card>
        <Card title="리텐션 곡선" meta={cohort.span ? `첫 방문 코호트 ${cohort.span}` : '첫 방문 코호트'}>
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
