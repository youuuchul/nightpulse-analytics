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
 * 기간·세그먼트 안에서 flag 를 가진 고유 사람 수를 그룹별로 센다.
 *
 * Args:
 *   pd: data.json 의 person_day (열 배열 형식).
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
  const ix = (k: string) => pd.cols.indexOf(k)
  const [iK, iD, iC, iP, iM, iF] = ['pk', 'd', 'c', 'p', 'm', 'f'].map(ix)
  const lo = diffDays(pd.base_date, from)
  const hi = diffDays(pd.base_date, to)
  const sets = new Map<string, Set<number>>()
  const row: PersonRow = { off: 0, channel1: '', device_platform: '', member_seg: '' }
  for (const r of pd.rows) {
    const d = r[iD]
    if (d < lo || d > hi || (r[iF] & flag) === 0) continue
    row.channel1 = pd.codes.c[r[iC]]
    row.device_platform = pd.codes.p[r[iP]]
    row.member_seg = pd.codes.m[r[iM]]
    if (seg.ch !== 'all' && row.channel1 !== seg.ch) continue
    if (seg.pf !== 'all' && row.device_platform !== seg.pf) continue
    if (seg.ms !== 'all' && row.member_seg !== seg.ms) continue
    row.off = d - lo
    for (const g of groups(row)) {
      let s = sets.get(g)
      if (!s) sets.set(g, (s = new Set()))
      s.add(r[iK])
    }
  }
  const out = new Map<string, number>()
  for (const [g, s] of sets) out.set(g, s.size)
  return out
}
