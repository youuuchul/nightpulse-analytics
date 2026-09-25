import { addDays, addMonths, ym } from './date'

/** 'YYYY-MM' 의 마지막 날. */
export function monthEnd(m: string): string {
  return addDays(`${addMonths(m, 1)}-01`, -1)
}

interface CohortRow {
  cohort_month: string
  month_offset: number
  cohort_size: number
}

/**
 * 월 코호트 히트맵 행. 시작 월이 until 이하인 최근 limit 개 코호트, 칸은 경과 1~max 개월 중
 * 그 월의 말일이 until 이하인 칸만 채운다(0개월 칸은 100% 라 그리지 않는다).
 *
 * @param value (경과 월 행, 0개월 행) → 유지율. 0개월 행이 없으면 null.
 * @param head 0개월 행 → 머리 칸 문자열.
 */
export function cohortHeat<T extends CohortRow>(
  rows: T[],
  until: string,
  value: (r: T, first: T) => number | null,
  head: (first: T) => string,
  max = 12,
  limit = 12,
): { cols: string[]; rows: { label: string; head: string; cells: (number | null)[] }[] } {
  const by = new Map<string, Map<number, T>>()
  for (const r of rows) {
    if (r.cohort_month > until.slice(0, 7)) continue
    let m = by.get(r.cohort_month)
    if (!m) by.set(r.cohort_month, (m = new Map()))
    m.set(r.month_offset, r)
  }
  const months = [...by.keys()].sort().slice(-limit)
  let span = 0
  const out = months.map((cm) => {
    const m = by.get(cm)!
    const first = m.get(0)
    const cells: (number | null)[] = []
    for (let k = 1; k <= max; k++) {
      const r = m.get(k)
      const ok = r && first && monthEnd(addMonths(cm, k)) <= until
      cells.push(ok ? value(r, first) : null)
      if (ok) span = Math.max(span, k)
    }
    return { label: ym(cm), head: first ? head(first) : '—', cells }
  })
  const n = Math.max(span, 1)
  return {
    cols: Array.from({ length: n }, (_, k) => `M${k + 1}`),
    rows: out.map((r) => ({ ...r, cells: r.cells.slice(0, n) })),
  }
}
