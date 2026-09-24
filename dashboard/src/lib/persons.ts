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
  subscribed: 32768,
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
 * w0 = pk(0..19) | d(20..28) | c(29) | p(30..31), w1 = m(0) | f(1..16).
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
 * 세그먼트 귀속(`by`):
 *   - 'last'(기본): 사람마다 기간 안에서 flag 를 가진 마지막 날의 세그먼트 값 하나로 귀속한다.
 *     세그먼트 필터와 groups 에 넘기는 row 의 channel1·device_platform·member_seg 가 그 값이다
 *     (off 는 각 행의 실제 날짜). 그래서 세그먼트 값별 수를 더하면 전체와 같다(분할).
 *     기간 중 가입한 사람은 회원으로 센다.
 *   - 'day': 그날 행의 값. 한 사람이 기간 중 여러 값을 가지면 양쪽에 모두 세어진다.
 *
 * Args:
 *   pd: person_day.bin 을 읽은 것.
 *   from: 기간 시작일(YYYY-MM-DD).
 *   to: 기간 끝일.
 *   flag: 비트 플래그(F 의 값).
 *   seg: 세그먼트 필터 상태('all' 이면 미적용).
 *   groups: 행 → 그룹 키 목록. off 는 from 기준 일수. 기본은 '' 하나(기간 전체).
 *   by: 세그먼트 귀속 규칙.
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
  by: 'last' | 'day' = 'last',
): Map<string, number> {
  const lo = diffDays(pd.base_date, from)
  const hi = diffDays(pd.base_date, to)
  const [i0, i1] = pdSpan(pd, lo, hi)
  const w = pd.w
  const last = new Map<number, number>()
  if (by === 'last')
    for (let i = i0; i < i1; i++) if (pdFlags(w[2 * i + 1]) & flag) last.set(pdKey(w[2 * i]), i)
  const sets = new Map<string, Set<number>>()
  const row: PersonRow = { off: 0, channel1: '', device_platform: '', member_seg: '' }
  for (let i = i0; i < i1; i++) {
    const a = w[2 * i]
    if ((pdFlags(w[2 * i + 1]) & flag) === 0) continue
    const j = by === 'last' ? last.get(pdKey(a))! : i
    const sa = w[2 * j]
    row.channel1 = pd.codes.c[pdCh(sa)]
    row.device_platform = pd.codes.p[pdPf(sa)]
    row.member_seg = pd.codes.m[pdMs(w[2 * j + 1])]
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
