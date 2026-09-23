import { useMemo } from 'react'
import { type Range, inRange, segFilter, sum } from '../lib/agg'
import { addDays, eachDay, md, mondayOf, weekday, WEEKDAYS } from '../lib/date'
import { dec, num, pct, ratio } from '../lib/format'
import {
  AUDIENCES,
  EXIT_NODE,
  FUNNEL_LABEL,
  OTHER_NODE,
  S,
  SCREEN_GROUPS,
} from '../lib/labels'
import type { State } from '../lib/state'
import type { FunnelStep, Seg } from '../lib/types'
import { Funnel, Heatmap, TimeChart } from '../components/charts'
import { PathSankey, type PathLink } from '../components/PathSankey'
import { ReachTable, type ReachRow } from '../components/ReachTable'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import { hourTip, hourX, ptDelta, type TabProps, weekTip } from './common'

const STEPS: FunnelStep[] = ['landing', 'detail', 'signup', 'apply_view', 'payment']
const REACH_STEPS = STEPS.slice(1).map((k) => FUNNEL_LABEL[k])
type StepSums = Record<FunnelStep, number>

function zero(): StepSums {
  return { landing: 0, detail: 0, signup: 0, apply_view: 0, payment: 0 }
}

function stepSums<T extends { step: FunnelStep; persons: number }>(rows: T[], keep: (r: T) => boolean): StepSums {
  const t = zero()
  for (const r of rows) if (keep(r)) t[r.step] += r.persons
  return t
}

function weeksIn(range: Range, weeks: string[]): string[] {
  const lo = mondayOf(range.from)
  return [...new Set(weeks)].filter((w) => w >= lo && w <= range.to).sort()
}

function weekMeta(ws: string[]): string {
  if (!ws.length) return ''
  const span = ws.length === 1 ? `${md(ws[0])} 주` : `${md(ws[0])}~${md(addDays(ws[ws.length - 1], 6))}`
  return `${ws.length}주 · ${span}`
}

function NoData({ h = 120 }: { h?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted" style={{ height: h }}>
      데이터 없음
    </div>
  )
}

const SEG_ROWS: { key: string; group: string; label: string; test: (r: Seg) => boolean; hide: (s: State) => boolean }[] = [
  { key: 'all', group: '', label: '전체', test: () => true, hide: () => false },
  { key: 'paid', group: '채널', label: '유료', test: (r) => r.channel1 === 'paid', hide: (s) => s.ch === 'non_paid' },
  { key: 'non_paid', group: '채널', label: '비유료', test: (r) => r.channel1 === 'non_paid', hide: (s) => s.ch === 'paid' },
  { key: 'ios', group: '플랫폼', label: 'iOS', test: (r) => r.device_platform === 'ios', hide: (s) => s.pf !== 'all' && s.pf !== 'ios' },
  { key: 'android', group: '플랫폼', label: 'Android', test: (r) => r.device_platform === 'android', hide: (s) => s.pf !== 'all' && s.pf !== 'android' },
  { key: 'web', group: '플랫폼', label: '웹', test: (r) => r.device_platform === 'web', hide: (s) => s.pf !== 'all' && s.pf !== 'web' },
  { key: 'member', group: '회원', label: '회원', test: (r) => r.member_seg === 'member', hide: (s) => s.ms === 'guest' },
  { key: 'guest', group: '회원', label: '비회원', test: (r) => r.member_seg === 'guest', hide: (s) => s.ms === 'member' },
]

function Chips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="오디언스">
      {AUDIENCES.map((a, i) => {
        const on = value.includes(a.id)
        return (
          <button
            key={a.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (on && value.length === 1) return
              onChange(on ? value.filter((x) => x !== a.id) : AUDIENCES.map((x) => x.id).filter((x) => x === a.id || value.includes(x)))
            }}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors ${
              on ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--axis)]' : 'bg-wash text-muted hover:text-ink'
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: on ? S(i + 1) : 'var(--axis)' }} />
            {a.label}
          </button>
        )
      })}
    </div>
  )
}

function Audience({ data, s, set, range }: TabProps) {
  const all = data.weekly_audience_funnel ?? []
  const seg = segFilter(s)
  const weeks = useMemo(() => weeksIn(range, all.map((r) => r.week_start)), [all, range.from, range.to])
  const picked = s.aud.split(',').filter((x) => AUDIENCES.some((a) => a.id === x))
  const sel = picked.length ? picked : ['new']
  const rows = useMemo(() => {
    const ws = new Set(weeks)
    return all.filter((r) => ws.has(r.week_start) && seg(r))
  }, [all, weeks, s.ch, s.pf, s.ms])

  const table: ReachRow[] = sel.map((id) => {
    const i = AUDIENCES.findIndex((a) => a.id === id)
    const t = stepSums(rows, (r) => r.audience_id === id)
    return {
      key: id,
      label: AUDIENCES[i].label,
      color: S(i + 1),
      base: t.landing,
      counts: STEPS.slice(1).map((k) => t[k]),
    }
  })

  const trend = useMemo(() => {
    const m = new Map<string, Record<string, StepSums>>()
    for (const w of weeks) m.set(w, {})
    for (const r of rows) {
      const z = m.get(r.week_start)!
      z[r.audience_id] ??= zero()
      z[r.audience_id][r.step] += r.persons
    }
    return [...m.entries()].map(([date, z]) => {
      const o: Record<string, number | string | null> = { date }
      for (const id of sel) o[id] = ratio(z[id]?.payment ?? 0, z[id]?.landing ?? 0)
      return o
    })
  }, [rows, weeks, s.aud])

  const series = sel.map((id) => {
    const i = AUDIENCES.findIndex((a) => a.id === id)
    return { key: id, label: AUDIENCES[i].label, color: S(i + 1) }
  })

  return (
    <Card title="오디언스별 퍼널" meta={all.length ? `${weekMeta(weeks)} · 사람·주` : undefined}>
      {!all.length ? (
        <NoData />
      ) : (
        <div className="flex flex-col gap-4">
          <Chips value={sel} onChange={(v) => set({ aud: v.join(',') })} />
          {!weeks.length ? (
            <NoData />
          ) : (
            <div className={`grid gap-6 ${weeks.length >= 2 ? 'xl:grid-cols-[6fr_5fr]' : ''}`}>
              <div className="min-w-0">
                <div className="mb-2 text-xs text-muted">랜딩 대비 도달률</div>
                <ReachTable rows={table} steps={REACH_STEPS} baseLabel="랜딩" unit="명" />
              </div>
              {weeks.length >= 2 && (
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted">랜딩 → 결제 전환율 · 주별</span>
                    <Legend items={series.map((x) => ({ ...x, kind: 'line' as const }))} />
                  </div>
                  <TimeChart
                    data={trend}
                    kind="line"
                    series={series}
                    yFormat={(v) => pct(v, 0)}
                    valueFormat={(v) => pct(v)}
                    tipTitle={weekTip(true)}
                    decimals
                    height={220}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Paths({ data, s, range }: TabProps) {
  const all = data.weekly_path ?? []
  const seg = segFilter(s)
  const weeks = useMemo(() => weeksIn(range, all.map((r) => r.week_start)), [all, range.from, range.to])
  const base = useMemo(() => {
    const ws = new Set(weeks)
    return all.filter((r) => ws.has(r.week_start) && seg(r))
  }, [all, weeks, s.ch, s.pf, s.ms])

  const links = useMemo(() => {
    const rows = base
    const freq = new Map<string, number>()
    for (const r of rows)
      for (const x of r.step === 1 ? [r.from_screen, r.to_screen] : [r.to_screen])
        if (x !== EXIT_NODE && x !== OTHER_NODE) freq.set(x, (freq.get(x) ?? 0) + r.sessions)
    const keep = new Set([...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k))
    const fold = (x: string) => (x === EXIT_NODE || keep.has(x) ? x : OTHER_NODE)
    const m = new Map<string, PathLink>()
    for (const r of rows) {
      const from = fold(r.from_screen)
      const to = fold(r.to_screen)
      const k = `${r.step}|${from}|${to}`
      const z = m.get(k)
      if (z) z.value += r.sessions
      else m.set(k, { step: r.step, from, to, value: r.sessions })
    }
    return [...m.values()]
  }, [base])
  const total = links.filter((l) => l.step === 1).reduce((a, l) => a + l.value, 0)

  return (
    <Card
      title="경로 탐색"
      meta={all.length ? `${weekMeta(weeks)} · 세션 ${num(total)}` : undefined}
    >
      {!all.length || !weeks.length || !links.length ? (
        <NoData />
      ) : (
        <>
          <PathSankey links={links} />
          <div className="mt-1">
            <Legend
              items={[
                ...SCREEN_GROUPS.map((g) => ({ label: g.label, color: g.color })),
                { label: '기타', color: 'var(--muted)' },
                { label: '이탈', color: 'var(--exit)' },
              ]}
            />
          </div>
        </>
      )}
    </Card>
  )
}

export default function FunnelTab(p: TabProps) {
  const { data, s, range } = p
  const seg = segFilter(s)
  const f = useMemo(() => data.funnel_daily.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = stepSums(inRange(f, range.from, range.to), () => true)
  const prev = stepSums(inRange(f, range.prevFrom, range.prevTo), () => true)
  const hasPrev = range.prevFrom >= data.meta.from_date

  const conv = ratio(cur.payment, cur.landing)
  const reach = (t: StepSums, i: number) => ratio(t[STEPS[i]], t.landing)
  const stepRate = (t: StepSums, i: number) => ratio(t[STEPS[i]], t[STEPS[i - 1]])

  let drop = { i: 0, v: -1 }
  for (let i = 1; i < STEPS.length; i++) {
    const v = (reach(cur, i - 1) ?? 0) - (reach(cur, i) ?? 0)
    if (cur.landing > 0 && v > drop.v) drop = { i, v }
  }
  const prevDrop = drop.i ? (reach(prev, drop.i - 1) ?? 0) - (reach(prev, drop.i) ?? 0) : null

  let moved = { i: 0, v: 0 }
  if (hasPrev)
    for (let i = 1; i < STEPS.length; i++) {
      const a = stepRate(cur, i)
      const b = stepRate(prev, i)
      if (a != null && b != null && Math.abs(a - b) > Math.abs(moved.v)) moved = { i, v: a - b }
    }

  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const dm = sum(inRange(m, range.from, range.to), ['persons', 'explorers'])
  const dmPrev = sum(inRange(m, range.prevFrom, range.prevTo), ['persons', 'explorers'])

  const weekly = range.days >= 28
  const trend = useMemo(() => {
    const b = new Map<string, StepSums>()
    for (const d of eachDay(range.from, range.to)) {
      const k = weekly ? mondayOf(d) : d
      if (!b.has(k)) b.set(k, zero())
    }
    for (const r of f) {
      if (r.kst_date < range.from || r.kst_date > range.to) continue
      b.get(weekly ? mondayOf(r.kst_date) : r.kst_date)![r.step] += r.persons
    }
    return [...b.entries()].map(([date, t]) => ({
      date,
      a: ratio(t.apply_view, t.detail),
      b: ratio(t.payment, t.apply_view),
    }))
  }, [f, range.from, range.to, weekly])
  const series = [
    { key: 'a', label: '행사 상세 → 신청 화면', color: S(1) },
    { key: 'b', label: '신청 화면 → 결제', color: S(2) },
  ]

  const segTable: ReachRow[] = SEG_ROWS.filter((r) => !r.hide(s)).map((r) => {
    const t = stepSums(inRange(f, range.from, range.to), r.test)
    return { key: r.key, label: r.label, group: r.group, base: t.landing, counts: STEPS.slice(1).map((k) => t[k]) }
  })

  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    for (const r of data.hourly_metrics)
      if (r.kst_date >= range.from && r.kst_date <= range.to && seg(r)) grid[weekday(r.kst_date)][r.kst_hour] += r.sessions
    const cnt = Array<number>(7).fill(0)
    for (const d of eachDay(range.from, range.to)) cnt[weekday(d)] += 1
    return grid.map((row, i) => row.map((v) => (cnt[i] ? v / cnt[i] : 0)))
  }, [data, range.from, range.to, s.ch, s.pf, s.ms])
  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }))
    for (const r of data.hourly_metrics) if (r.kst_date === range.from && seg(r)) out[r.kst_hour].sessions += r.sessions
    return out
  }, [data, range.from, s.ch, s.pf, s.ms])

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-4">
        <Tile
          label="전체 전환율 · 랜딩 → 결제"
          value={pct(conv, 2)}
          sub={`랜딩 ${num(cur.landing)}명·일 중 ${num(cur.payment)}`}
          delta={ptDelta(data, range, conv, ratio(prev.payment, prev.landing))}
        />
        <Tile
          label="최대 이탈 단계"
          value={drop.i ? FUNNEL_LABEL[STEPS[drop.i]] : '—'}
          sub={drop.i ? `${FUNNEL_LABEL[STEPS[drop.i - 1]]}에서 −${dec(drop.v * 100)}%p` : undefined}
          delta={drop.i ? ptDelta(data, range, drop.v, prevDrop, false) : undefined}
        />
        <Tile
          label="가장 크게 변한 단계"
          value={moved.i ? FUNNEL_LABEL[STEPS[moved.i]] : '—'}
          sub={
            moved.i
              ? `${FUNNEL_LABEL[STEPS[moved.i - 1]]} → ${FUNNEL_LABEL[STEPS[moved.i]]} ${pct(stepRate(cur, moved.i))}`
              : hasPrev
                ? undefined
                : '직전 기간 없음'
          }
          delta={moved.i ? ptDelta(data, range, stepRate(cur, moved.i), stepRate(prev, moved.i)) : undefined}
        />
        <Tile
          label="탐색 도달률"
          value={pct(ratio(dm.explorers, dm.persons))}
          sub={`방문자 ${num(dm.persons)}명·일 중`}
          delta={ptDelta(data, range, ratio(dm.explorers, dm.persons), ratio(dmPrev.explorers, dmPrev.persons))}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[6fr_6fr]">
        {range.oneDay ? (
          <Card title="단계 전환" meta={`${range.from} · 사람`}>
            <Funnel steps={STEPS.map((k) => ({ label: FUNNEL_LABEL[k], value: cur[k] }))} />
          </Card>
        ) : (
          <Card
            title="단계 전환율 추이"
            meta={weekly ? '주별' : '일별'}
            right={<Legend items={series.map((x) => ({ ...x, kind: 'line' as const }))} />}
          >
            <TimeChart
              data={trend}
              kind="line"
              series={series}
              yFormat={(v) => pct(v, 0)}
              valueFormat={(v) => pct(v)}
              tipTitle={weekTip(weekly)}
              decimals
              height={260}
            />
          </Card>
        )}
        <Card title="세그먼트별 퍼널" meta="랜딩 대비 도달률 · 사람·일">
          <ReachTable rows={segTable} steps={REACH_STEPS} baseLabel="랜딩" unit="명·일" />
        </Card>
      </div>

      <Audience {...p} />
      <Paths {...p} />

      {range.oneDay ? (
        <Card title="시간별 세션" meta={range.from}>
          <TimeChart
            data={hourly}
            xKey="hour"
            xFormat={hourX}
            tipTitle={hourTip}
            kind="bar"
            series={[{ key: 'sessions', label: '세션', color: S(1) }]}
            height={220}
          />
        </Card>
      ) : (
        <Card title="요일 × 시간대 세션" meta="하루 평균">
          <Heatmap
            cols={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h) : ''))}
            rows={heat.map((cells, i) => ({ label: WEEKDAYS[i], cells }))}
            format={() => ''}
            rowLabelWidth={20}
            minCell={12}
            tip={(r, c, v) => `${WEEKDAYS[r]} ${c}시 · 세션 ${dec(v)}`}
          />
        </Card>
      )}
    </div>
  )
}
