import type { DailyRevenue, FeeTier } from './types'

export interface TierSum {
  count: number
  refunds: number
  gmv: number
  fee: number
  discount: number
}

export interface RevenueSum {
  fee: number
  membership: number
  plan: number
  total: number
  gmv: number
  paid: number
  discount: number
  payCount: number
  refundCount: number
  refundAmount: number
  tier: Record<FeeTier, TierSum>
}

const tierZero = (): TierSum => ({ count: 0, refunds: 0, gmv: 0, fee: 0, discount: 0 })

/** 기간 [from, to] 의 매출. 플랫폼 매출 = 수수료 + 멤버십 + 파트너 플랜, 거래액·결제액은 티켓 행만. */
export function sumRevenue(rows: DailyRevenue[], from: string, to: string): RevenueSum {
  const z: RevenueSum = {
    fee: 0,
    membership: 0,
    plan: 0,
    total: 0,
    gmv: 0,
    paid: 0,
    discount: 0,
    payCount: 0,
    refundCount: 0,
    refundAmount: 0,
    tier: { none: tierZero(), basic: tierZero(), pro: tierZero() },
  }
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to) continue
    z.total += r.net_amount
    if (r.kind === 'membership') z.membership += r.net_amount
    else if (r.kind === 'partner_plan') z.plan += r.net_amount
    else {
      z.fee += r.net_amount
      z.gmv += r.gmv_amount ?? 0
      z.paid += r.paid_amount
      z.discount += r.discount_amount
      z.payCount += r.pay_count
      z.refundCount += r.refund_count
      z.refundAmount += r.refund_amount
      const t = z.tier[r.fee_tier ?? 'none']
      t.count += r.pay_count
      t.refunds += r.refund_count
      t.gmv += r.gmv_amount ?? 0
      t.fee += r.net_amount
      t.discount += r.discount_amount
    }
  }
  return z
}

export interface DayRevenue {
  fee: number
  membership: number
  plan: number
  gmv: number
}

/** 날짜 → 수수료·멤버십·파트너 플랜 매출과 거래액. */
export function revenueByDay(rows: DailyRevenue[]): Map<string, DayRevenue> {
  const m = new Map<string, DayRevenue>()
  for (const r of rows) {
    let z = m.get(r.kst_date)
    if (!z) m.set(r.kst_date, (z = { fee: 0, membership: 0, plan: 0, gmv: 0 }))
    if (r.kind === 'membership') z.membership += r.net_amount
    else if (r.kind === 'partner_plan') z.plan += r.net_amount
    else {
      z.fee += r.net_amount
      z.gmv += r.gmv_amount ?? 0
    }
  }
  return m
}
