import { useMemo } from 'react'
import RevenueCard from '../components/RevenueCard'
import { buckets } from '../components/TrendCard'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Tile, TileRow } from '../components/ui'
import type { Range } from '../lib/agg'
import { addDays } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { FEE_TIERS, S } from '../lib/labels'
import { sumRevenue } from '../lib/revenue'
import type { DailyRevenue, FeeTier } from '../lib/types'
import { delta, ptDelta, type TabProps, vsLabel } from './common'

function grainOf(range: Range): { g: 'day' | 'week' | 'month'; label: string } {
  if (range.days > 120) return { g: 'month', label: '월별' }
  if (range.days > 31) return { g: 'week', label: '주별' }
  return { g: 'day', label: '일별' }
}

/** 버킷별 멤버 할인액(티켓 행 discount_amount). */
function discountSeries(rows: DailyRevenue[], range: Range) {
  const bks = buckets(range, grainOf(range).g)
  const at = new Map<string, number>()
  bks.forEach((b, i) => {
    for (let d = b.from; d <= b.to; d = addDays(d, 1)) at.set(d, i)
  })
  const out = bks.map((b) => ({ x: b.label, title: b.title, discount: 0 }))
  for (const r of rows) {
    const i = at.get(r.kst_date)
    if (i != null && r.kind === 'ticket') out[i].discount += r.discount_amount
  }
  return out
}

interface TierRow {
  key: FeeTier
  label: string
  color: string
  rate: number
  count: number
  gmv: number
  fee: number
  discount: number
}

export default function Revenue({ data, set, range }: TabProps) {
  const rows = data.daily_revenue
  const cur = useMemo(() => (rows ? sumRevenue(rows, range.from, range.to) : null), [rows, range.from, range.to])
  const prev = useMemo(() => (rows ? sumRevenue(rows, range.prevFrom, range.prevTo) : null), [rows, range.prevFrom, range.prevTo])
  const disc = useMemo(() => (rows ? discountSeries(rows, range) : []), [rows, range.from, range.to, range.days])

  if (!rows || !cur || !prev)
    return (
      <Card title="매출 구성" metricId="M05">
        <div className="text-sm text-muted">데이터 없음</div>
      </Card>
    )

  const take = ratio(cur.fee, cur.gmv)
  const aov = ratio(cur.gmv, cur.payCount - cur.refundCount)
  const refund = ratio(cur.refundCount, cur.payCount)
  const partnerShare = ratio(cur.tier.basic.gmv + cur.tier.pro.gmv, cur.gmv)
  const tiers: TierRow[] = FEE_TIERS.map((t) => ({
    key: t.key,
    label: t.label,
    color: t.color,
    rate: t.rate,
    count: cur.tier[t.key].count - cur.tier[t.key].refunds,
    gmv: cur.tier[t.key].gmv,
    fee: cur.tier[t.key].fee,
    discount: cur.tier[t.key].discount,
  }))
  const cols: Col<TierRow>[] = [
    {
      key: 'label',
      label: '공간 등급',
      value: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-ink">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
          {r.label}
        </span>
      ),
    },
    { key: 'rate', label: '수수료율', value: (r) => r.rate, render: (r) => pct(r.rate, 0), num: true },
    { key: 'count', label: '결제', value: (r) => r.count, render: (r) => num(r.count), num: true },
    { key: 'gmv', label: '거래액', value: (r) => r.gmv, render: (r) => won(r.gmv), num: true },
    { key: 'share', label: '거래액 비중', value: (r) => ratio(r.gmv, cur.gmv), render: (r) => pct(ratio(r.gmv, cur.gmv)), num: true },
    { key: 'fee', label: '수수료', value: (r) => r.fee, render: (r) => won(r.fee), num: true },
    { key: 'discount', label: '멤버 할인', value: (r) => r.discount, render: (r) => won(r.discount), num: true },
  ]
  const { label: gl } = grainOf(range)
  const tip = (x: string | number) => disc.find((r) => r.x === x)?.title ?? String(x)

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-5" title={`거래·매출 · ${vsLabel(data, range)}`}>
        <Tile
          metricId="M09"
          label="거래액"
          value={won(cur.gmv)}
          unit="원"
          sub={`결제 ${num(cur.payCount - cur.refundCount)}건`}
          delta={delta(data, range, cur.gmv, prev.gmv)}
        />
        <Tile metricId="M01" label="플랫폼 매출" value={won(cur.total)} unit="원" delta={delta(data, range, cur.total, prev.total)} />
        <Tile
          metricId="M11"
          label="실효 수수료율"
          value={pct(take)}
          sub={`수수료 ${won(cur.fee)}원`}
          delta={ptDelta(data, range, take, ratio(prev.fee, prev.gmv), null)}
        />
        <Tile
          metricId="M06"
          label="객단가"
          value={won(aov)}
          unit="원"
          delta={delta(data, range, aov, ratio(prev.gmv, prev.payCount - prev.refundCount))}
        />
        <Tile
          metricId="M12"
          label="환불률"
          value={pct(refund)}
          sub={`환불 ${num(cur.refundCount)}건 · ${won(cur.refundAmount)}원`}
          delta={ptDelta(data, range, refund, ratio(prev.refundCount, prev.payCount), false)}
        />
      </TileRow>

      <RevenueCard
        rows={rows}
        range={range}
        dataFrom={data.meta.from_date}
        dataTo={data.meta.to_date}
        onDrill={(p) => set(p, true)}
        tiles={false}
      />

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card title="수수료 등급별 거래" metricId="M08" meta={`파트너 거래액 비중 ${pct(partnerShare)}`}>
          <DataTable cols={cols} rows={tiers} sortKey="rate" rowKey={(r) => r.key} minW="min-w-[560px]" />
        </Card>
        <Card title="멤버 할인 부담액" metricId="M07" meta={`${gl} · 원`}>
          <TimeChart
            data={disc}
            xKey="x"
            xFormat={(v) => String(v)}
            tipTitle={tip}
            kind="bar"
            valueFormat={won}
            series={[{ key: 'discount', label: '멤버 할인', color: S(2) }]}
            height={220}
          />
        </Card>
      </div>
    </div>
  )
}
