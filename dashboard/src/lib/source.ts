import { useEffect, useReducer } from 'react'
import type { Data, LazyKey, LazyTables, PersonDay } from './types'

export type Lazy<T> = { state: 'loading' } | { state: 'error' } | { state: 'none' } | { state: 'ready'; value: T }
export type Wait = 'loading' | 'error' | null

const BASE = `${import.meta.env.BASE_URL}data/`
const LOADING: Lazy<never> = { state: 'loading' }
const NONE: Lazy<never> = { state: 'none' }

const RETRY_MS = [500, 1500]

const settled = new Map<string, Lazy<unknown>>()
const inflight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let gen = 0

async function get(file: string): Promise<Response> {
  const r = await fetch(BASE + file)
  if (!r.ok) throw new Error(`${file} ${r.status}`)
  return r
}

export async function loadIndex(): Promise<Data> {
  return (await get('index.json')).json()
}

/** gzip 머리(1f 8b)면 풀고, 아니면(서버가 이미 풀어 보냈으면) 그대로 돌려준다. */
async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const h = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  if (h[0] !== 0x1f || h[1] !== 0x8b) return buf
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

async function loadPersonDay(bin: string, gz: string | undefined, metaFile: string): Promise<PersonDay> {
  const body =
    gz && typeof DecompressionStream !== 'undefined'
      ? get(gz).then((r) => r.arrayBuffer()).then(gunzip)
      : get(bin).then((r) => r.arrayBuffer())
  const [buf, meta] = await Promise.all([body, get(metaFile).then((r) => r.json())])
  if (buf.byteLength !== meta.rows * 8) throw new Error(`person_day 크기 불일치 ${buf.byteLength} ≠ ${meta.rows * 8}`)
  return { base_date: meta.base_date, codes: meta.codes, n: meta.rows, w: new Uint32Array(buf) }
}

async function withRetry<T>(job: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await job()
    } catch (e) {
      if (i >= RETRY_MS.length) throw e
      await new Promise((r) => setTimeout(r, RETRY_MS[i]))
    }
  }
}

function start(data: Data, key: LazyKey, file: string): Promise<void> {
  let p = inflight.get(file)
  if (!p) {
    const meta = data.files.person_day_meta
    const job = withRetry<unknown>(() =>
      key === 'person_day' && meta ? loadPersonDay(file, data.files.person_day_gz, meta) : get(file).then((r) => r.json()),
    )
    p = job.then(
      (value) => void settled.set(file, { state: 'ready', value }),
      () => void settled.set(file, { state: 'error' }),
    )
    inflight.set(file, p)
  }
  return p
}

/**
 * 지연 표를 받아 온다. 같은 파일은 한 번만 받고(동시 요청 병합) 메모리에 둔다.
 *
 * Args:
 *   data: index.json (없으면 loading).
 *   key: 지연 표 이름.
 *   enabled: false 면 요청하지 않는다(loading 을 돌려준다).
 *
 * Returns:
 *   loading / error / none(index 에 파일이 없음) / ready.
 */
export function useTable<K extends LazyKey>(data: Data | null, key: K, enabled = true): Lazy<LazyTables[K]> {
  const file = data?.files[key]
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(bump)
    return () => void listeners.delete(bump)
  }, [])
  useEffect(() => {
    if (!data || !file || !enabled || settled.has(file)) return
    let live = true
    start(data, key, file).then(() => live && bump())
    return () => {
      live = false
    }
  }, [data, file, enabled, gen])
  if (!data) return LOADING
  if (!file) return NONE
  return (settled.get(file) as Lazy<LazyTables[K]> | undefined) ?? LOADING
}

/** 자동 재시도까지 실패한 표를 모두 지우고 다시 받게 한다(Pending 의 다시 시도 버튼). */
export function retryFailed(): void {
  for (const [file, l] of settled) {
    if (l.state !== 'error') continue
    settled.delete(file)
    inflight.delete(file)
  }
  gen++
  for (const f of listeners) f()
}

export function ready<T>(l: Lazy<T>): T | undefined {
  return l.state === 'ready' ? l.value : undefined
}

/** 여럿 중 하나라도 실패면 error, 받는 중이면 loading, 아니면 null. */
export function waitOf(...ls: Lazy<unknown>[]): Wait {
  if (ls.some((l) => l.state === 'error')) return 'error'
  if (ls.some((l) => l.state === 'loading')) return 'loading'
  return null
}
