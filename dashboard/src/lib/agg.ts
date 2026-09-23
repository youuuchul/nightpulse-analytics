import { addDays, diffDays, eachDay, mondayOf } from './date'
import type { Data, Seg } from './types'
import type { State } from './state'

export interface Range {
  from: string
  to: string
  days: number
  oneDay: boolean
  prevFrom: string
  prevTo: string
}

export function clampDate(d: string, min: string, max: string): string {
  return d < min ? min : d > max ? max : d
}

export function campaignSpans(data: Data): Map<string, { name: string; from: string; to: string }> {
  const m = new Map<string, { name: string; from: string; to: string }>()
  for (const r of data.daily_ad) {
    const c = m.get(r.campaign_id)
    if (!c) m.set(r.campaign_id, { name: r.campaign_name, from: r.kst_date, to: r.kst_date })
    else {
      if (r.kst_date < c.from) c.from = r.kst_date
      if (r.kst_date > c.to) c.to = r.kst_date
    }
  }
  return m
}

export function resolveRange(s: State, data: Data): Range {
  const { from_date: min, to_date: max } = data.meta
  let from: string
  let to: string
  if (s.p === '1') {
    from = to = clampDate(s.d || max, min, max)
  } else if (s.p === 'custom' && s.from && s.to) {
    from = clampDate(s.from < s.to ? s.from : s.to, min, max)
    to = clampDate(s.from < s.to ? s.to : s.from, min, max)
  } else if (s.p === 'target') {
    const spans = campaignSpans(data)
    const c = spans.get(s.camp)
    if (c) {
      from = c.from
      to = c.to
    } else {
      const all = [...spans.values()]
      from = all.reduce((a, c2) => (c2.from < a ? c2.from : a), max)
      to = all.reduce((a, c2) => (c2.to > a ? c2.to : a), min)
    }
  } else {
    const n = s.p === 'custom' ? 28 : Number(s.p)
    to = max
    from = clampDate(addDays(max, -(n - 1)), min, max)
  }
  const days = diffDays(from, to) + 1
  return { from, to, days, oneDay: days === 1, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) }
}

export function segFilter(s: State) {
  return (r: Seg) =>
    (s.ch === 'all' || r.channel1 === s.ch) &&
    (s.pf === 'all' || r.device_platform === s.pf) &&
    (s.ms === 'all' || r.member_seg === s.ms)
}

export function inRange<T extends { kst_date: string }>(rows: T[], from: string, to: string): T[] {
  return rows.filter((r) => r.kst_date >= from && r.kst_date <= to)
}

export function sum<T, K extends keyof T>(rows: T[], keys: K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = 0
  for (const r of rows) for (const k of keys) out[k] += r[k] as unknown as number
  return out
}

export function byDate<T extends { kst_date: string }, K extends keyof T>(
  rows: T[],
  keys: K[],
  from: string,
  to: string,
): ({ date: string } & Record<K, number>)[] {
  const idx = new Map<string, Record<K, number>>()
  for (const d of eachDay(from, to)) {
    const z = {} as Record<K, number>
    for (const k of keys) z[k] = 0
    idx.set(d, z)
  }
  for (const r of rows) {
    const z = idx.get(r.kst_date)
    if (!z) continue
    for (const k of keys) z[k] += r[k] as unknown as number
  }
  return [...idx.entries()].map(([date, v]) => ({ date, ...v }))
}

export function groupSum<T, K extends keyof T>(
  rows: T[],
  keyOf: (r: T) => string,
  keys: K[],
): Map<string, Record<K, number>> {
  const m = new Map<string, Record<K, number>>()
  for (const r of rows) {
    const g = keyOf(r)
    let z = m.get(g)
    if (!z) {
      z = {} as Record<K, number>
      for (const k of keys) z[k] = 0
      m.set(g, z)
    }
    for (const k of keys) z[k] += r[k] as unknown as number
  }
  return m
}

export function bucketed<T extends { kst_date: string }, K extends keyof T>(
  rows: T[],
  keys: K[],
  range: Range,
): { weekly: boolean; rows: ({ date: string } & Record<K, number>)[] } {
  const daily = byDate(rows, keys, range.from, range.to)
  if (range.days <= 120) return { weekly: false, rows: daily }
  const m = new Map<string, { date: string } & Record<K, number>>()
  for (const r of daily) {
    const w = mondayOf(r.date)
    let z = m.get(w)
    if (!z) {
      z = { date: w } as { date: string } & Record<K, number>
      for (const k of keys) (z as Record<K, number>)[k] = 0
      m.set(w, z)
    }
    for (const k of keys) (z as Record<K, number>)[k] += r[k]
  }
  return { weekly: true, rows: [...m.values()] }
}
