import { diffDays } from './date'
import type { PersonDay } from './types'

export const F = {
  visited: 1,
  explored: 2,
  event_detail: 4,
  detail_any: 8,
  signed_up: 16,
  logged_in: 32,
  apply_view: 64,
  applied: 128,
  paid: 256,
  cancelled: 512,
  searched: 1024,
  banner: 2048,
  shared: 4096,
  multi_session: 8192,
  first_visit: 16384,
} as const

export interface SegState {
  ch: string
  pf: string
  ms: string
}

export interface PersonRow {
  off: number
  channel1: string
  device_platform: string
  member_seg: string
}

/**
 * person_day.bin 한 행의 비트 배치(extract.py PD_BITS 와 같다).
 * w0 = pk(0..19) | d(20..28) | c(29) | p(30..31), w1 = m(0) | f(1..15).
 */
export const pdKey = (w0: number) => w0 & 0xfffff
export const pdDay = (w0: number) => (w0 >>> 20) & 0x1ff
export const pdCh = (w0: number) => (w0 >>> 29) & 1
export const pdPf = (w0: number) => w0 >>> 30
export const pdMs = (w1: number) => w1 & 1
export const pdFlags = (w1: number) => w1 >>> 1

/** 날짜 오프셋 [lo, hi] 에 드는 행 구간 [start, end). 행은 날짜 순. */
export function pdSpan(pd: PersonDay, lo: number, hi: number): [number, number] {
  const bound = (d: number) => {
    let a = 0
    let b = pd.n
    while (a < b) {
      const m = (a + b) >>> 1
      if (pdDay(pd.w[2 * m]) < d) a = m + 1
      else b = m
    }
    return a
  }
  return [bound(lo), bound(hi + 1)]
}

/**
 * 기간·세그먼트 안에서 flag 를 가진 고유 사람 수를 그룹별로 센다.
 *
 * Args:
 *   pd: person_day.bin 을 읽은 것.
 *   from: 기간 시작일(YYYY-MM-DD).
 *   to: 기간 끝일.
 *   flag: 비트 플래그(F 의 값).
 *   seg: 세그먼트 필터 상태('all' 이면 미적용).
 *   groups: 행 → 그룹 키 목록. off 는 from 기준 일수. 기본은 '' 하나(기간 전체).
 *
 * Returns:
 *   그룹 키 → 고유 사람 수.
 */
export function uniquePersons(
  pd: PersonDay,
  from: string,
  to: string,
  flag: number,
  seg: SegState,
  groups: (r: PersonRow) => string[] = () => [''],
): Map<string, number> {
  const lo = diffDays(pd.base_date, from)
  const hi = diffDays(pd.base_date, to)
  const [i0, i1] = pdSpan(pd, lo, hi)
  const w = pd.w
  const sets = new Map<string, Set<number>>()
  const row: PersonRow = { off: 0, channel1: '', device_platform: '', member_seg: '' }
  for (let i = i0; i < i1; i++) {
    const a = w[2 * i]
    const b = w[2 * i + 1]
    if ((pdFlags(b) & flag) === 0) continue
    row.channel1 = pd.codes.c[pdCh(a)]
    row.device_platform = pd.codes.p[pdPf(a)]
    row.member_seg = pd.codes.m[pdMs(b)]
    if (seg.ch !== 'all' && row.channel1 !== seg.ch) continue
    if (seg.pf !== 'all' && row.device_platform !== seg.pf) continue
    if (seg.ms !== 'all' && row.member_seg !== seg.ms) continue
    row.off = pdDay(a) - lo
    for (const g of groups(row)) {
      let s = sets.get(g)
      if (!s) sets.set(g, (s = new Set()))
      s.add(pdKey(a))
    }
  }
  const out = new Map<string, number>()
  for (const [g, s] of sets) out.set(g, s.size)
  return out
}
