import { useMemo } from 'react'
import { Heatmap, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Tile, TileRow } from '../components/ui'
import { cohortHeat } from '../lib/cohort'
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

/**
 * 기간 흐름. 구독자·월 = Σ 일별 활성 ÷ 30 — 월 해지율·ARPU·1인·월 할인의 분모.
 * 월 해지율 = 기간 해지 ÷ 구독자·월(월 평균 활성 기준이라 기간이 출시 전부터 시작해도 계산된다).
 */
function span(rows: DailySubscription[], from: string, to: string) {
  let churn = 0
  let fresh = 0
  let amount = 0
  let discount = 0
  let activeDays = 0
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to) continue
    churn += r.churned_subscribers
    fresh += r.new_subscribers
    amount += r.subscriber_ticket_amount
    discount += r.discount_amount ?? 0
    activeDays += r.active_subscribers
  }
  const subMonths = activeDays / 30
  return { churn, fresh, amount, discount, subMonths, rate: ratio(churn, subMonths) }
}

/** 구독 LTV(추정) = (ARPU − 1인·월 할인) ÷ 월 해지율. */
function ltv(membership: number, discount: number, subMonths: number, rate: number | null) {
  const arpu = ratio(membership, subMonths)
  const dpm = ratio(discount, subMonths)
  const value = arpu != null && dpm != null && rate ? (arpu - dpm) / rate : null
  return { arpu, dpm, value }
}

/** 날짜 d 까지 누적 가입(전체 세그먼트). */
function membersAt(signups: Map<string, number>, d: string): number {
  let n = 0
  for (const [k, v] of signups) if (k <= d) n += v
  return n
}

export default function Subscription({ data, range }: TabProps) {
  const rows = data.daily_subscription
  const pdL = useTable(data, 'person_day')
  const pd = ready(pdL)
  const pw = waitOf(pdL)
  const cmp = useMemo(() => (pd ? compare(pd, range.from, range.to) : null), [pd, range.from, range.to])
  const signups = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data.daily_metrics) m.set(r.kst_date, (m.get(r.kst_date) ?? 0) + r.signups)
    return m
  }, [data])
  const heat = useMemo(
    () =>
      cohortHeat(
        data.subscription_cohort ?? [],
        range.to,
        (r, f) => ratio(r.retained, f.cohort_size),
        (f) => num(f.cohort_size),
      ),
    [data, range.to],
  )

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
  const revPrev = data.daily_revenue ? sumRevenue(data.daily_revenue, range.prevFrom, range.prevTo) : null
  const discount = rows[0]?.discount_amount != null ? w.discount : (rev?.discount ?? 0)
  const discountPrev = rows[0]?.discount_amount != null ? wp.discount : (revPrev?.discount ?? 0)
  const lv = ltv(rev?.membership ?? 0, discount, w.subMonths, w.rate)
  const lvPrev = ltv(revPrev?.membership ?? 0, discountPrev, wp.subMonths, wp.rate)
  const members = membersAt(signups, end?.kst_date ?? range.to)
  const membersPrev = membersAt(signups, endPrev?.kst_date ?? range.prevTo)
  const pen = ratio(end?.active_subscribers ?? 0, members)
  const penPrev = ratio(endPrev?.active_subscribers ?? 0, membersPrev)
  const burden = rev ? ratio(discount, rev.membership) : null
  const burdenPrev = revPrev ? ratio(discountPrev, revPrev.membership) : null

  const table: CompareRow[] = cmp
    ? [
        { key: 'sub', label: '구독자', ...cmp.sub, amount: w.amount, discount },
        { key: 'non', label: '비구독 회원', ...cmp.non, amount: rev ? rev.paid - w.amount : 0, discount: 0 },
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
          { key: 'amount', label: '티켓 결제액', value: (r: CompareRow) => r.amount, render: (r: CompareRow) => won(r.amount), num: true },
          {
            key: 'per',
            label: '결제자당 금액',
            value: (r: CompareRow) => ratio(r.amount, r.payers),
            render: (r: CompareRow) => won(ratio(r.amount, r.payers)),
            num: true,
          },
          { key: 'discount', label: '멤버 할인', value: (r: CompareRow) => r.discount, render: (r: CompareRow) => won(r.discount), num: true },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-4" title={`구독 · ${vsLabel(data, range)}`}>
        <Tile
          metricId="S01"
          label="활성 구독자"
          value={num(end?.active_subscribers)}
          unit="명"
          sub={end ? `${md(end.kst_date)} 기준` : undefined}
          delta={delta(data, range, end?.active_subscribers ?? null, endPrev?.active_subscribers ?? null)}
        />
        <Tile metricId="S02" label="신규 구독" value={num(w.fresh)} unit="건" delta={delta(data, range, w.fresh, wp.fresh)} />
        <Tile metricId="S03" label="구독 해지" value={num(w.churn)} unit="건" delta={delta(data, range, w.churn, wp.churn, false)} />
        <Tile
          metricId="S05"
          label="구독 월 해지율"
          value={pct(w.rate)}
          sub={`구독자·월 ${num(w.subMonths)} 기준`}
          delta={ptDelta(data, range, w.rate, wp.rate, false)}
        />
        <Tile
          metricId="S04"
          label="구독 MRR"
          value={won(end?.mrr)}
          unit="원"
          sub={end ? `ARR ${won(end.mrr * 12)}원` : undefined}
          delta={delta(data, range, end?.mrr ?? null, endPrev?.mrr ?? null)}
        />
        <Tile
          metricId="S08"
          label="구독 LTV"
          value={won(lv.value)}
          unit="원"
          sub={lv.arpu != null ? `ARPU ${won(lv.arpu)} − 할인 ${won(lv.dpm)}` : undefined}
          delta={delta(data, range, lv.value, lvPrev.value)}
        />
        <Tile
          metricId="S10"
          label="회원 대비 구독 비중"
          value={pct(pen)}
          sub={`회원 ${num(members)}명 중`}
          delta={ptDelta(data, range, pen, penPrev)}
        />
        <Tile
          metricId="S11"
          label="멤버 할인 부담률"
          value={pct(burden)}
          sub={`할인 ${won(discount)}원`}
          delta={ptDelta(data, range, burden, burdenPrev, false)}
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

      <Card
        title="구독 코호트 유지율"
        metricId="S09"
        meta={`시작 월 코호트 · ${md(range.to)}까지 끝난 달 · %`}
      >
        {heat.rows.length ? (
          <Heatmap
            cols={heat.cols}
            rows={heat.rows}
            head
            headLabel="시작"
            format={(v) => `${Math.round(v * 100)}`}
            rowLabelWidth={48}
            tip={(r, c, v) => `${heat.rows[r].label} 코호트 M${c + 1} · ${pct(v)}`}
          />
        ) : (
          <div className="text-sm text-muted">데이터 없음</div>
        )}
      </Card>

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
