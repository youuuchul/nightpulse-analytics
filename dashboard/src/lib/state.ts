import { useCallback, useEffect, useState } from 'react'

export type TabId = 'overview' | 'explore' | 'events' | 'members' | 'acquisition' | 'periodic'
export type Preset = '' | '1' | '7' | '28' | '90' | '365' | 'custom' | 'target'

export interface State {
  tab: TabId
  view: string
  p: Preset
  d: string
  from: string
  to: string
  ch: 'all' | 'paid' | 'non_paid'
  pf: 'all' | 'ios' | 'android' | 'web'
  ms: 'all' | 'member' | 'guest'
  rg: string
  gn: string
  et: string
  pt: string
  camp: string
  wk: string
  mo: string
  mr: '6' | '12'
}

export const DEFAULTS: State = {
  tab: 'overview',
  view: '',
  p: '',
  d: '',
  from: '',
  to: '',
  ch: 'all',
  pf: 'all',
  ms: 'all',
  rg: 'all',
  gn: 'all',
  et: 'all',
  pt: 'all',
  camp: '',
  wk: '',
  mo: '',
  mr: '6',
}

function read(): State {
  const q = new URLSearchParams(window.location.search)
  const s = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    const v = q.get(k)
    if (v != null) (s as Record<string, string>)[k] = v
  }
  return s
}

function write(s: State) {
  const q = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    if (s[k] !== DEFAULTS[k]) q.set(k, String(s[k]))
  }
  const qs = q.toString()
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}

export function useUrlState(): [State, (patch: Partial<State>) => void] {
  const [state, setState] = useState<State>(read)
  useEffect(() => write(state), [state])
  useEffect(() => {
    const onPop = () => setState(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const update = useCallback((patch: Partial<State>) => setState((s) => ({ ...s, ...patch })), [])
  return [state, update]
}
