import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { campaignSpans, resolveRange } from './lib/agg'
import { md } from './lib/date'
import { type State, type TabId, useUrlState } from './lib/state'
import type { Data } from './lib/types'
import { MonthLine, PeriodLine, SegmentControls, SegmentLine, WeekLine } from './components/FilterBar'
import { Segmented, Select } from './components/ui'
import Overview from './tabs/Overview'
import Explore from './tabs/Explore'
import Events from './tabs/Events'
import Members from './tabs/Members'
import Acquisition from './tabs/Acquisition'
import Periodic, { completeWeeks, defaultMonth, summaryMonths } from './tabs/Periodic'
import { PRICE_TIER } from './lib/labels'
import type { TabProps } from './tabs/common'

interface TabDef {
  id: TabId
  label: string
  views?: { value: string; label: string }[]
  el: ComponentType<TabProps>
}

const TABS: TabDef[] = [
  { id: 'overview', label: '개요', el: Overview },
  {
    id: 'explore',
    label: '탐색',
    el: Explore,
    views: [
      { value: 'flow', label: '흐름' },
      { value: 'venue', label: '공간별' },
    ],
  },
  {
    id: 'events',
    label: '행사·결제',
    el: Events,
    views: [
      { value: 'flow', label: '흐름' },
      { value: 'event', label: '행사별' },
    ],
  },
  { id: 'members', label: '회원', el: Members },
  {
    id: 'acquisition',
    label: '유입·광고',
    el: Acquisition,
    views: [
      { value: 'channel', label: '채널' },
      { value: 'campaign', label: '캠페인' },
    ],
  },
  {
    id: 'periodic',
    label: '주간·월간',
    el: Periodic,
    views: [
      { value: 'week', label: '주간' },
      { value: 'month', label: '월간' },
    ],
  },
]

function uniq(v: string[]): { value: string; label: string }[] {
  return [...new Set(v)].sort((a, b) => a.localeCompare(b, 'ko')).map((x) => ({ value: x, label: x }))
}

type Theme = 'light' | 'dark' | null

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem('np-theme')
      return v === 'light' || v === 'dark' ? v : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme) root.setAttribute('data-theme', theme)
    else root.removeAttribute('data-theme')
    try {
      if (theme) localStorage.setItem('np-theme', theme)
      else localStorage.removeItem('np-theme')
    } catch {
      /* 저장 불가 환경: 이번 세션만 적용 */
    }
  }, [theme])
  const toggle = () => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const now = theme ?? (sysDark ? 'dark' : 'light')
    setTheme(now === 'dark' ? 'light' : 'dark')
  }
  return [theme, toggle]
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState(false)
  const [s, set] = useUrlState()
  const [, toggleTheme] = useTheme()

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr(true))
  }, [])

  const tab = TABS.find((t) => t.id === s.tab) ?? TABS[0]
  const view = tab.views ? (tab.views.some((v) => v.value === s.view) ? s.view : tab.views[0].value) : ''
  const p = s.p === '' || (s.p === 'target' && view !== 'campaign') ? (view === 'campaign' ? 'target' : '28') : s.p
  const st: State = { ...s, tab: tab.id, view, p }
  const range = useMemo(() => (data ? resolveRange(st, data) : null), [data, st.p, st.d, st.from, st.to, st.camp])

  const go = (patch: Partial<State>) => {
    const next = { ...st, ...patch }
    if (next.view === 'campaign' && st.view !== 'campaign') patch = { ...patch, p: '' }
    else if (next.view !== 'campaign' && st.p === 'target') patch = { ...patch, p: '' }
    set(patch)
  }

  if (err)
    return <div className="flex h-screen items-center justify-center text-sm text-muted">데이터를 불러오지 못했습니다</div>
  if (!data || !range) return <div className="h-screen" />

  const { from_date: min, to_date: max } = data.meta
  const El = tab.el

  let periodLine
  let segLine
  const views = tab.views
  if (tab.id === 'periodic') {
    if (view === 'month') {
      const months = summaryMonths(data)
      const mo = months.includes(st.mo) ? st.mo : defaultMonth(data)
      periodLine = <MonthLine months={months} value={mo} onChange={(m) => set({ mo: m })} partialTo={max} />
      segLine = (
        <SegmentLine views={views} view={view} onView={(v) => go({ view: v })}>
          <Segmented
            label="범위"
            value={st.mr}
            onChange={(mr) => set({ mr })}
            options={[
              { value: '6', label: '6개월' },
              { value: '12', label: '12개월' },
            ]}
          />
        </SegmentLine>
      )
    } else {
      const weeks = completeWeeks(data)
      const wk = weeks.includes(st.wk) ? st.wk : weeks[weeks.length - 1]
      periodLine = <WeekLine weeks={weeks} value={wk} onChange={(w) => set({ wk: w })} />
      segLine = (
        <SegmentLine views={views} view={view} onView={(v) => go({ view: v })}>
          <SegmentControls s={st} set={set} />
        </SegmentLine>
      )
    }
  } else {
    const spans = campaignSpans(data)
    periodLine = (
      <PeriodLine
        s={st}
        set={set}
        range={range}
        min={min}
        max={max}
        extra={view === 'campaign' ? { value: 'target', label: '캠페인 기간' } : undefined}
      />
    )
    let controls = <SegmentControls s={st} set={set} />
    if (view === 'venue')
      controls = (
        <>
          <Select
            label="지역"
            value={st.rg}
            width="w-32"
            onChange={(rg) => set({ rg })}
            options={[{ value: 'all', label: '전체' }, ...uniq(data.daily_venue.map((r) => r.region))]}
          />
          <Select
            label="장르"
            value={st.gn}
            width="w-32"
            onChange={(gn) => set({ gn })}
            options={[{ value: 'all', label: '전체' }, ...uniq(data.daily_venue.map((r) => r.genre))]}
          />
        </>
      )
    else if (view === 'event')
      controls = (
        <>
          <Select
            label="유형"
            value={st.et}
            width="w-36"
            onChange={(et) => set({ et })}
            options={[{ value: 'all', label: '전체' }, ...uniq(data.daily_event.map((r) => r.event_type))]}
          />
          <Select
            label="가격대"
            value={st.pt}
            width="w-32"
            onChange={(pt) => set({ pt })}
            options={[
              { value: 'all', label: '전체' },
              ...Object.entries(PRICE_TIER).map(([value, label]) => ({ value, label })),
            ]}
          />
        </>
      )
    else if (view === 'campaign')
      controls = (
        <Select
          label="캠페인"
          value={spans.has(st.camp) ? st.camp : ''}
          width="w-64"
          onChange={(camp) => set({ camp, p: 'target' })}
          options={[
            { value: '', label: '전체 캠페인' },
            ...[...spans.entries()]
              .sort((a, b) => b[1].from.localeCompare(a[1].from))
              .map(([id, c]) => ({ value: id, label: `${c.name} · ${md(c.from)}~${md(c.to)}` })),
          ]}
        />
      )
    segLine = (
      <SegmentLine views={views} view={view} onView={(v) => go({ view: v })}>
        {controls}
      </SegmentLine>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 pb-2 pt-5 sm:px-6">
        <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden className="shrink-0">
          <path
            d="M1 9h3l2-6 3 10 2-6h4"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h1 className="text-lg font-semibold tracking-tight">
          NightPulse <span className="font-normal text-ink2">KPI</span>
        </h1>
        <span className="rounded-md bg-wash px-1.5 py-0.5 text-[11px] font-medium text-ink2">합성 데이터</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="tnum hidden text-xs text-muted sm:inline">기준일 {max}</span>
          <span className="tnum text-xs text-muted sm:hidden">{md(max)}</span>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="테마 전환"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-ink2 hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <div className="sticky top-0 z-20 bg-page">
        <nav className="scrollbar-none mx-auto flex max-w-[1280px] gap-1 overflow-x-auto border-b border-line px-4 sm:px-6">
          {TABS.map((t) => {
            const on = t.id === tab.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go({ tab: t.id, view: t.views?.[0].value ?? '' })}
                className={`relative h-11 shrink-0 whitespace-nowrap px-3 text-sm transition-colors ${
                  on ? 'font-semibold text-ink' : 'text-ink2 hover:text-ink'
                }`}
              >
                {t.label}
                {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--ink)]" />}
              </button>
            )
          })}
        </nav>
        <div className="mx-auto max-w-[1280px] border-b border-line">
          {periodLine}
          <div className="mx-4 h-px bg-line sm:mx-6" />
          {segLine}
        </div>
      </div>

      <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-4 sm:px-6">
        <El data={data} s={st} set={set} range={range} />
      </main>
    </div>
  )
}
