import { useMemo } from 'react'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Tile, TileRow } from '../components/ui'
import { diffDays, md, mondayOf } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { S } from '../lib/labels'
import { F, pdFlags, pdKey, pdMs, pdSpan } from '../lib/persons'
import { sumRevenue } from '../lib/revenue'
import { ready, useTable, waitOf } from '../lib/source'
import type { DailySubscription, PersonDay } from '../lib/types'
import { delta, grain, ptDelta, type TabProps, vsLabel, weekTip } from './common'

interface CompareRow {
  key: string
  label: string
  visitors: number
  payers: number
  amount: number
  discount: number
}

/**
 * 기간 안 회원인 날의 방문·결제 고유 사람을 구독 여부로 나눠 센다.
 * 사람마다 기간 안 마지막 회원 행(방문 또는 결제)의 구독 여부 하나로 귀속한다 — 구독자 + 비구독 = 회원 전체.
 */
function compare(pd: PersonDay, from: string, to: string): Record<'sub' | 'non', { visitors: number; payers: number }> {
  const lo = diffDays(pd.base_date, from)
  const hi = diffDays(pd.base_date, to)
  const [i0, i1] = pdSpan(pd, lo, hi)
  const member = pd.codes.m.indexOf('member')
  const any = F.visited | F.paid
  const last = new Map<number, number>()
  for (let i = i0; i < i1; i++) {
    const b = pd.w[2 * i + 1]
    if (pdMs(b) === member && pdFlags(b) & any) last.set(pdKey(pd.w[2 * i]), pdFlags(b))
  }
  const v = { sub: new Set<number>(), non: new Set<number>() }
  const p = { sub: new Set<number>(), non: new Set<number>() }
  for (let i = i0; i < i1; i++) {
    const a = pd.w[2 * i]
    const b = pd.w[2 * i + 1]
    if (pdMs(b) !== member) continue
    const f = pdFlags(b)
    const k = pdKey(a)
    const g = (last.get(k) ?? 0) & F.subscribed ? 'sub' : 'non'
    if (f & F.visited) v[g].add(k)
    if (f & F.paid) p[g].add(k)
  }
  return {
    sub: { visitors: v.sub.size, payers: p.sub.size },
    non: { visitors: v.non.size, payers: p.non.size },
  }
}

function at(rows: DailySubscription[], d: string): DailySubscription | undefined {
  let last: DailySubscription | undefined
  for (const r of rows) {
    if (r.kst_date > d) break
    last = r
  }
  return last
}

/** 기간 흐름. 월 이탈률 = 기간 해지 ÷ 기간 시작일 활성 구독자 × 30 ÷ 기간 일수. */
function span(rows: DailySubscription[], from: string, to: string) {
  let churn = 0
  let fresh = 0
  let amount = 0
  let start: number | null = null
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to) continue
    if (start == null) start = r.active_subscribers
    churn += r.churned_subscribers
    fresh += r.new_subscribers
    amount += r.subscriber_ticket_amount
  }
  const days = diffDays(from, to) + 1
  return { churn, fresh, amount, rate: start ? (churn / start) * (30 / days) : null }
}

export default function Subscription({ data, range }: TabProps) {
  const rows = data.daily_subscription
  const pdL = useTable(data, 'person_day')
  const pd = ready(pdL)
  const pw = waitOf(pdL)
  const cmp = useMemo(() => (pd ? compare(pd, range.from, range.to) : null), [pd, range.from, range.to])

  const trend = useMemo(() => {
    if (!rows) return { weekly: false, rows: [] as { date: string; active: number; mrr: number }[] }
    const inR = rows.filter((r) => r.kst_date >= range.from && r.kst_date <= range.to)
    const weekly = range.days > 120
    if (!weekly) return { weekly, rows: inR.map((r) => ({ date: r.kst_date, active: r.active_subscribers, mrr: r.mrr })) }
    const m = new Map<string, { date: string; active: number; mrr: number }>()
    for (const r of inR) m.set(mondayOf(r.kst_date), { date: mondayOf(r.kst_date), active: r.active_subscribers, mrr: r.mrr })
    return { weekly, rows: [...m.values()] }
  }, [rows, range.from, range.to, range.days])

  if (!rows)
    return (
      <Card title="구독" metricId="S01">
        <div className="text-sm text-muted">데이터 없음</div>
      </Card>
    )

  const end = at(rows, range.to)
  const endPrev = at(rows, range.prevTo)
  const w = span(rows, range.from, range.to)
  const wp = span(rows, range.prevFrom, range.prevTo)
  const rev = data.daily_revenue ? sumRevenue(data.daily_revenue, range.from, range.to) : null

  const table: CompareRow[] = cmp
    ? [
        { key: 'sub', label: '구독자', ...cmp.sub, amount: w.amount, discount: rev?.discount ?? 0 },
        { key: 'non', label: '비구독 회원', ...cmp.non, amount: rev ? rev.ticket - w.amount : 0, discount: 0 },
      ]
    : []
  const cols: Col<CompareRow>[] = [
    { key: 'label', label: '회원', value: (r) => r.label, render: (r) => <span className="text-ink">{r.label}</span> },
    { key: 'visitors', label: '방문 회원', value: (r) => r.visitors, render: (r) => num(r.visitors), num: true },
    { key: 'payers', label: '결제자', value: (r) => r.payers, render: (r) => num(r.payers), num: true },
    {
      key: 'conv',
      label: '방문 대비 결제',
      value: (r) => ratio(r.payers, r.visitors),
      render: (r) => pct(ratio(r.payers, r.visitors)),
      num: true,
    },
    ...(rev
      ? [
          { key: 'amount', label: '티켓 순매출', value: (r: CompareRow) => r.amount, render: (r: CompareRow) => won(r.amount), num: true },
          {
            key: 'per',
            label: '결제자당 금액',
            value: (r: CompareRow) => ratio(r.amount, r.payers),
            render: (r: CompareRow) => won(ratio(r.amount, r.payers)),
            num: true,
          },
          { key: 'discount', label: '구독 할인', value: (r: CompareRow) => r.discount, render: (r: CompareRow) => won(r.discount), num: true },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-5" title={`구독 · ${vsLabel(data, range)}`}>
        <Tile
          metricId="S01"
          label="구독자"
          value={num(end?.active_subscribers)}
          unit="명"
          sub={end ? `${md(end.kst_date)} 기준` : undefined}
          delta={delta(data, range, end?.active_subscribers ?? null, endPrev?.active_subscribers ?? null)}
        />
        <Tile metricId="S02" label="신규 구독" value={num(w.fresh)} unit="건" delta={delta(data, range, w.fresh, wp.fresh)} />
        <Tile metricId="S03" label="해지" value={num(w.churn)} unit="건" delta={delta(data, range, w.churn, wp.churn, false)} />
        <Tile
          metricId="S04"
          label="구독 MRR"
          value={won(end?.mrr)}
          unit="원"
          delta={delta(data, range, end?.mrr ?? null, endPrev?.mrr ?? null)}
        />
        <Tile
          metricId="S05"
          label="월 이탈률"
          value={pct(w.rate)}
          sub="30일 환산"
          delta={ptDelta(data, range, w.rate, wp.rate, false)}
        />
      </TileRow>

      {!range.oneDay && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="구독자" metricId="S01" meta={`${grain(trend.weekly)} · 명 · ${trend.weekly ? '주 마지막 날' : '그날'} 활성`}>
            <TimeChart
              data={trend.rows}
              kind="line"
              tipTitle={weekTip(trend.weekly)}
              series={[{ key: 'active', label: '구독자', color: S(2) }]}
              height={220}
            />
          </Card>
          <Card title="구독 MRR" metricId="S04" meta={`${grain(trend.weekly)} · 원`}>
            <TimeChart
              data={trend.rows}
              kind="area"
              tipTitle={weekTip(trend.weekly)}
              valueFormat={won}
              series={[{ key: 'mrr', label: 'MRR', color: S(2) }]}
              height={220}
            />
          </Card>
        </div>
      )}

      <Card title="구독자 vs 비구독 회원 · 티켓 결제" metricId="S06" meta="회원으로 방문한 날 기준 · 기간 고유 사람" wait={pw} waitH={120}>
        {cmp ? (
          <DataTable cols={cols} rows={table} sortKey="visitors" rowKey={(r) => r.key} />
        ) : (
          <div className="text-sm text-muted">데이터 없음</div>
        )}
      </Card>
    </div>
  )
}
