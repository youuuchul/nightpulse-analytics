import { useMemo } from 'react'
import { inRange, segFilter, sum } from '../lib/agg'
import { md } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { F, uniquePersons } from '../lib/persons'
import type { DailyMetric, HourlyMetric } from '../lib/types'
import TrendCard, { type TrendMetric } from '../components/TrendCard'
import { Tile, TileRow } from '../components/ui'
import { delta, ptDelta, type TabProps } from './common'

const KEYS = [
  'persons',
  'new_persons',
  'sessions',
  'engaged_sessions',
  'signups',
  'applies',
  'pay_count',
  'pay_amount',
] as const

type M = TrendMetric<DailyMetric, HourlyMetric>

const VISITORS: [M] = [{ label: '방문자', unit: '명', flag: F.visited, value: (r) => r.persons, hour: (r) => r.persons }]
const ENGAGED: [M] = [{ label: '활성 세션', unit: '세션', value: (r) => r.engaged_sessions }]
const NEW_SIGNUP: [M, M] = [
  { label: '신규 방문자', unit: '명', value: (r) => r.new_persons },
  { label: '가입', unit: '명', value: (r) => r.signups },
]
const APPLY_PAY: [M, M] = [
  { label: '신청', unit: '건', value: (r) => r.applies, hour: (r) => r.applies },
  { label: '결제', unit: '건', value: (r) => r.pay_count, hour: (r) => r.pay_count },
]
const AMOUNT: [M] = [{ label: '결제 금액', unit: '원', value: (r) => r.pay_amount, format: won }]

export default function Overview({ data, s, set, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = sum(inRange(m, range.from, range.to), [...KEYS])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), [...KEYS])
  const d = (k: (typeof KEYS)[number], goodUp = true) => delta(data, range, cur[k], prev[k], goodUp)

  const segState = { ch: s.ch, pf: s.pf, ms: s.ms }
  const pd = data.person_day
  const visitors = (from: string, to: string, fallback: number) =>
    pd ? (uniquePersons(pd, from, to, F.visited, segState).get('') ?? 0) : fallback
  const vCur = useMemo(() => visitors(range.from, range.to, cur.persons), [data, range.from, range.to, s.ch, s.pf, s.ms])
  const vPrev = useMemo(
    () => visitors(range.prevFrom, range.prevTo, prev.persons),
    [data, range.prevFrom, range.prevTo, s.ch, s.pf, s.ms],
  )

  const status = useMemo(() => {
    const to = data.meta.to_date
    let members = 0
    for (const r of data.daily_metrics) if (r.kst_date <= to) members += r.signups
    const venues = new Set(data.daily_venue.filter((r) => r.kst_date <= to).map((r) => r.venue_id)).size
    return { to, members, venues }
  }, [data])

  const engaged = ratio(cur.engaged_sessions, cur.sessions)
  const engagedPrev = ratio(prev.engaged_sessions, prev.sessions)

  const card = {
    daily: data.daily_metrics,
    hourly: data.hourly_metrics,
    persons: pd,
    seg: segState,
    range,
    dataFrom: data.meta.from_date,
    dataTo: data.meta.to_date,
    onDrill: (p: { p: '1'; d: string } | { p: 'custom'; from: string; to: string }) => set(p, true),
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5 text-[13px]">
        <span className="text-xs text-muted">{md(status.to)} 기준</span>
        <span className="text-ink2">
          누적 회원 <span className="tnum font-semibold text-ink">{num(status.members)}</span>명
        </span>
        <span className="text-ink2">
          공간 <span className="tnum font-semibold text-ink">{num(status.venues)}</span>곳
        </span>
      </section>

      <TileRow cols="sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="방문자" value={num(vCur)} unit="명" delta={delta(data, range, vCur, vPrev)} />
        <Tile label="세션" value={num(cur.sessions)} delta={d('sessions')} />
        <Tile
          label="활성 세션 비율"
          value={pct(engaged)}
          sub={`세션 ${num(cur.sessions)} 중`}
          delta={ptDelta(data, range, engaged, engagedPrev)}
        />
        <Tile label="신규 방문자" value={num(cur.new_persons)} unit="명" delta={d('new_persons')} />
        <Tile label="가입" value={num(cur.signups)} unit="명" delta={d('signups')} />
        <Tile label="신청" value={num(cur.applies)} unit="건" delta={d('applies')} />
        <Tile label="결제" value={num(cur.pay_count)} unit="건" delta={d('pay_count')} />
        <Tile label="결제 금액" value={won(cur.pay_amount)} unit="원" delta={d('pay_amount')} />
      </TileRow>

      <TrendCard title="방문자" metrics={VISITORS} {...card} />
      <TrendCard title="활성 세션" metrics={ENGAGED} {...card} />
      <TrendCard title="신규 방문자 · 가입" metrics={NEW_SIGNUP} {...card} />
      <TrendCard title="신청 · 결제" metrics={APPLY_PAY} {...card} />
      <TrendCard title="결제 금액" metrics={AMOUNT} {...card} />
    </div>
  )
}
