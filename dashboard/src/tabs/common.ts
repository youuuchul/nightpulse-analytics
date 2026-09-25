import type { Range } from '../lib/agg'
import type { State } from '../lib/state'
import type { Data } from '../lib/types'
import type { Delta } from '../components/ui'

export interface TabProps {
  data: Data
  s: State
  set: (p: Partial<State>, push?: boolean) => void
  range: Range
}

/** 스코어보드 소제목의 비교 기준. 직전 기간이 데이터 범위 밖이면 '전기 없음'. */
export function vsLabel(data: Data, range: Range): string {
  if (range.prevFrom < data.meta.from_date) return '전기 없음'
  return range.oneDay ? '전일 대비' : `직전 ${range.days}일 대비`
}

export function delta(
  data: Data,
  range: Range,
  cur: number | null,
  prev: number | null,
  goodUp = true,
): Delta | undefined {
  if (range.prevFrom < data.meta.from_date) return undefined
  const v = cur != null && prev != null && prev !== 0 ? cur / prev - 1 : null
  return { value: v, goodUp }
}

export function ptDelta(
  data: Data,
  range: Range,
  cur: number | null,
  prev: number | null,
  goodUp: boolean | null = true,
): Delta | undefined {
  if (range.prevFrom < data.meta.from_date) return undefined
  const v = cur != null && prev != null ? cur - prev : null
  return { value: v, goodUp, points: true }
}

export function grain(weekly: boolean): string {
  return weekly ? '주별' : '일별'
}

export function weekTip(weekly: boolean) {
  return (d: string | number) => (weekly ? `${d} 주` : String(d))
}

export const hourX = (h: string | number) => `${h}시`
export const hourTip = (h: string | number) => `${h}시`
