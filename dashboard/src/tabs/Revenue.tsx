import { useMemo } from 'react'
import { buckets } from '../components/TrendCard'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import type { Range } from '../lib/agg'
import { addDays } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { REVENUE_KINDS, S } from '../lib/labels'
import { sumRevenue } from '../lib/revenue'
import type { DailyRevenue } from '../lib/types'
import { delta, ptDelta, type TabProps } from './common'

const PARTNER = [
  { key: 'partner', label: '파트너 공간', color: S(7) },
  { key: 'other', label: '비파트너 공간', color: 'var(--exit)' },
]

function grainOf(range: Range): { g: 'day' | 'week' | 'month'; label: string } {
  if (range.days > 120) return { g: 'month', label: '월별' }
  if (range.days > 31) return { g: 'week', label: '주별' }
  return { g: 'day', label: '일별' }
}

function bucketRows(rows: DailyRevenue[], range: Range) {
  const { g } = grainOf(range)
  const bks = buckets(range, g)
  const at = new Map<string, number>()
  bks.forEach((b, i) => {
    for (let d = b.from; d <= b.to; d = addDays(d, 1)) at.set(d, i)
  })
  const out = bks.map((b) => ({
    x: b.label,
    title: b.title,
    ticket: 0,
    subscription: 0,
    b2b: 0,
    gross: 0,
    count: 0,
    discount: 0,
    partner: 0,
    other: 0,
    aov: null as number | null,
  }))
  for (const r of rows) {
    const i = at.get(r.kst_date)
    if (i == null) continue
    const z = out[i]
    z[r.kind] += r.net_amount
    if (r.kind === 'ticket') {
      z.gross += r.gross_amount
      z.count += r.pay_count
      z.discount += r.discount_amount
      if (r.partner_flag) z.partner += r.net_amount
      else z.other += r.net_amount
    }
  }
  for (const z of out) z.aov = z.count > 0 ? z.gross / z.count : null
  return out
}

interface PartnerRow {
  key: string
  label: string
  count: number
  net: number
  gross: number
}

export default function Revenue({ data, range }: TabProps) {
  const rows = data.daily_revenue
  const cur = useMemo(() => (rows ? sumRevenue(rows, range.from, range.to) : null), [rows, range.from, range.to])
  const prev = useMemo(() => (rows ? sumRevenue(rows, range.prevFrom, range.prevTo) : null), [rows, range.prevFrom, range.prevTo])
  const series = useMemo(() => (rows ? bucketRows(rows, range) : []), [rows, range.from, range.to, range.days])
  const partnerRows = usePartnerRows(rows ?? [], range)

  if (!rows || !cur || !prev)
    return (
      <Card title="매출 구성" metricId="M05">
        <div className="text-sm text-muted">데이터 없음</div>
      </Card>
    )

  const { label: gl } = grainOf(range)
  const tip = (x: string | number) => series.find((r) => r.x === x)?.title ?? String(x)
  const aov = ratio(cur.ticketGross, cur.ticketCount)
  const share = ratio(cur.partner, cur.ticket)

  const cols: Col<PartnerRow>[] = [
    {
      key: 'label',
      label: '개최 공간',
      value: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-ink">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PARTNER.find((p) => p.key === r.key)?.color }} />
          {r.label}
        </span>
      ),
    },
    { key: 'count', label: '결제', value: (r) => r.count, render: (r) => num(r.count), num: true },
    { key: 'net', label: '순매출', value: (r) => r.net, render: (r) => won(r.net), num: true },
    { key: 'share', label: '티켓 매출 중', value: (r) => ratio(r.net, cur.ticket), render: (r) => pct(ratio(r.net, cur.ticket)), num: true },
    { key: 'aov', label: '객단가', value: (r) => ratio(r.gross, r.count), render: (r) => won(ratio(r.gross, r.count)), num: true },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="sm:grid-cols-4 lg:grid-cols-4">
        <Tile metricId="M01" label="총 매출" value={won(cur.total)} unit="원" delta={delta(data, range, cur.total, prev.total)} />
        <Tile
          metricId="M06"
          label="티켓 객단가"
          value={won(aov)}
          unit="원"
          sub={`티켓 결제 ${num(cur.ticketCount)}건`}
          delta={delta(data, range, aov, ratio(prev.ticketGross, prev.ticketCount))}
        />
        <Tile
          metricId="M07"
          label="구독 할인액"
          value={won(cur.discount)}
          unit="원"
          sub={`티켓 결제액의 ${pct(ratio(cur.discount, cur.ticketGross))}`}
          delta={delta(data, range, cur.discount, prev.discount, false)}
        />
        <Tile
          metricId="M08"
          label="파트너 티켓 매출 비중"
          value={pct(share)}
          sub={`티켓 ${won(cur.ticket)}원 중`}
          delta={ptDelta(data, range, share, ratio(prev.partner, prev.ticket))}
        />
      </TileRow>

      <Card
        title="매출 구성"
        metricId="M05"
        meta={`${gl} · 원`}
        right={<Legend items={REVENUE_KINDS.map((k) => ({ label: k.label, color: k.color }))} />}
      >
        <TimeChart
          data={series}
          xKey="x"
          xFormat={(v) => String(v)}
          tipTitle={tip}
          kind="stack"
          valueFormat={won}
          series={REVENUE_KINDS.map((k) => ({ key: k.key, label: k.label, color: k.color }))}
          height={260}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="티켓 객단가" metricId="M06" meta={`${gl} · 원 · 할인 전`}>
          <TimeChart
            data={series}
            xKey="x"
            xFormat={(v) => String(v)}
            tipTitle={tip}
            kind="line"
            valueFormat={won}
            series={[{ key: 'aov', label: '객단가', color: S(1) }]}
            height={200}
          />
        </Card>
        <Card title="구독 할인액" metricId="M07" meta={`${gl} · 원`}>
          <TimeChart
            data={series}
            xKey="x"
            xFormat={(v) => String(v)}
            tipTitle={tip}
            kind="bar"
            valueFormat={won}
            series={[{ key: 'discount', label: '할인액', color: S(2) }]}
            height={200}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card title="파트너 · 비파트너 티켓 매출" meta={`${gl} · 원 · 할인 후`} right={<Legend items={PARTNER} />}>
          <TimeChart
            data={series}
            xKey="x"
            xFormat={(v) => String(v)}
            tipTitle={tip}
            kind="stack"
            valueFormat={won}
            series={PARTNER}
            height={240}
          />
        </Card>
        <Card title="개최 공간별 티켓" metricId="M08">
          <DataTable cols={cols} rows={partnerRows} sortKey="net" rowKey={(r) => r.key} minW="min-w-[420px]" />
        </Card>
      </div>
    </div>
  )
}

function usePartnerRows(rows: DailyRevenue[], range: Range): PartnerRow[] {
  return useMemo(() => {
    const z: Record<string, PartnerRow> = {
      partner: { key: 'partner', label: '파트너 공간', count: 0, net: 0, gross: 0 },
      other: { key: 'other', label: '비파트너 공간', count: 0, net: 0, gross: 0 },
    }
    for (const r of rows) {
      if (r.kind !== 'ticket' || r.kst_date < range.from || r.kst_date > range.to) continue
      const t = z[r.partner_flag ? 'partner' : 'other']
      t.count += r.pay_count
      t.net += r.net_amount
      t.gross += r.gross_amount
    }
    return [z.partner, z.other]
  }, [rows, range.from, range.to])
}
