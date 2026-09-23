import type { DailyRevenue, RevenueKind } from './types'

export interface RevenueSum {
  ticket: number
  subscription: number
  b2b: number
  total: number
  ticketGross: number
  ticketCount: number
  discount: number
  partner: number
  nonPartner: number
}

/** 기간 [from, to] 의 매출을 종류별 순매출로 합산한다. */
export function sumRevenue(rows: DailyRevenue[], from: string, to: string): RevenueSum {
  const z: RevenueSum = {
    ticket: 0,
    subscription: 0,
    b2b: 0,
    total: 0,
    ticketGross: 0,
    ticketCount: 0,
    discount: 0,
    partner: 0,
    nonPartner: 0,
  }
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to) continue
    z[r.kind as RevenueKind] += r.net_amount
    z.total += r.net_amount
    if (r.kind === 'ticket') {
      z.ticketGross += r.gross_amount
      z.ticketCount += r.pay_count
      z.discount += r.discount_amount
      if (r.partner_flag) z.partner += r.net_amount
      else z.nonPartner += r.net_amount
    }
  }
  return z
}

/** 날짜 → 종류별 순매출. */
export function revenueByDay(rows: DailyRevenue[]): Map<string, Record<RevenueKind, number>> {
  const m = new Map<string, Record<RevenueKind, number>>()
  for (const r of rows) {
    let z = m.get(r.kst_date)
    if (!z) m.set(r.kst_date, (z = { ticket: 0, subscription: 0, b2b: 0 }))
    z[r.kind] += r.net_amount
  }
  return m
}
