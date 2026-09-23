import { useMemo, useRef, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Range } from '../lib/agg'
import { addDays, addMonths, diffDays, eachDay, md, WEEKDAYS, weekday, ym } from '../lib/date'
import { compact, num } from '../lib/format'
import { S } from '../lib/labels'
import { type SegState, uniquePersons } from '../lib/persons'
import type { PersonDay, Seg } from '../lib/types'
import type { Wait } from '../lib/source'
import { Pending } from './ui'

export interface TrendMetric<D, H> {
  label: string
  unit: string
  flag?: number
  value: (r: D) => number
  hour?: (r: H) => number
  format?: (v: number) => string
}

type Grain = 'auto' | 'hour' | 'day' | 'week' | 'month'
type Axis = 'ms' | 'ch' | 'pf'

const AXES: { id: Axis; label: string; field: keyof Seg; values: { v: string; label: string }[] }[] = [
  { id: 'ms', label: '회원', field: 'member_seg', values: [{ v: 'member', label: '회원' }, { v: 'guest', label: '비회원' }] },
  { id: 'ch', label: '채널', field: 'channel1', values: [{ v: 'paid', label: '유료' }, { v: 'non_paid', label: '비유료' }] },
  {
    id: 'pf',
    label: '플랫폼',
    field: 'device_platform',
    values: [
      { v: 'ios', label: 'iOS' },
      { v: 'android', label: 'Android' },
      { v: 'web', label: '웹' },
    ],
  },
]

export const GRAIN_LABEL: Record<Exclude<Grain, 'auto'>, string> = { hour: '시간별', day: '일별', week: '주별', month: '월별' }

export interface Bucket {
  from: string
  to: string
  label: string
  title: string
  prevTitle: string
}

function dayTitle(d: string): string {
  return `${md(d)} (${WEEKDAYS[weekday(d)]})`
}

function spanTitle(a: string, b: string): string {
  return a === b ? dayTitle(a) : `${md(a)}~${md(b)}`
}

export function autoGrain(range: Range): Exclude<Grain, 'auto'> {
  if (range.oneDay) return 'hour'
  if (range.days <= 14) return 'day'
  if (range.days <= 120) return 'week'
  return 'month'
}

export function buckets(range: Range, g: 'day' | 'week' | 'month'): Bucket[] {
  const shift = (d: string) => addDays(d, -range.days)
  if (g === 'day')
    return eachDay(range.from, range.to).map((d) => ({
      from: d,
      to: d,
      label: md(d),
      title: dayTitle(d),
      prevTitle: dayTitle(shift(d)),
    }))
  const out: Bucket[] = []
  if (g === 'week') {
    for (let a = range.from; a <= range.to; a = addDays(a, 7)) {
      const b = addDays(a, 6) < range.to ? addDays(a, 6) : range.to
      out.push({ from: a, to: b, label: md(a), title: spanTitle(a, b), prevTitle: spanTitle(shift(a), shift(b)) })
    }
    return out
  }
  for (let m = range.from.slice(0, 7); m <= range.to.slice(0, 7); m = addMonths(m, 1)) {
    const start = `${m}-01`
    const end = addDays(`${addMonths(m, 1)}-01`, -1)
    const a = start < range.from ? range.from : start
    const b = end > range.to ? range.to : end
    const title = a === start && b === end ? m : `${m} (${md(a)}~${md(b)})`
    out.push({ from: a, to: b, label: ym(m), title, prevTitle: spanTitle(shift(a), shift(b)) })
  }
  return out
}

export function change(cur: number, prev: number | null): number | null {
  return prev == null || prev === 0 ? null : cur / prev - 1
}

export function DeltaMark({ v, suffix }: { v: number | null; suffix?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-muted">—{suffix ? ` ${suffix}` : ''}</span>
  const flat = Math.abs(v) < 0.0005
  const color = flat ? 'var(--muted)' : v > 0 ? 'var(--good)' : 'var(--bad)'
  return (
    <span className="tnum whitespace-nowrap">
      <span style={{ color }} className="font-medium">
        {flat ? '' : v > 0 ? '▲ ' : '▼ '}
        {(Math.abs(v) * 100).toFixed(1)}%
      </span>
      {suffix && <span className="text-muted"> {suffix}</span>}
    </span>
  )
}

export function MiniSeg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 items-center rounded-md bg-wash p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`h-6 whitespace-nowrap rounded px-2 text-xs transition-colors disabled:cursor-default disabled:opacity-35 ${
              on ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--ring)]' : 'text-ink2 enabled:hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

interface Point {
  i: number
  x: string
  cur: number
  prev: number | null
  cur2?: number
  prev2?: number | null
}

export default function TrendCard<D extends Seg & { kst_date: string }, H extends Seg & { kst_date: string; kst_hour: number }>({
  title,
  metrics,
  daily,
  hourly,
  persons,
  seg,
  range,
  dataFrom,
  dataTo,
  onDrill,
  personWait = null,
  hourWait = null,
}: {
  title: string
  metrics: [TrendMetric<D, H>] | [TrendMetric<D, H>, TrendMetric<D, H>]
  daily: D[]
  hourly: H[]
  persons?: PersonDay
  seg: SegState
  range: Range
  dataFrom: string
  dataTo: string
  onDrill: (p: { p: '1'; d: string } | { p: 'custom'; from: string; to: string }) => void
  personWait?: Wait
  hourWait?: Wait
}) {
  const [pick, setPick] = useState<Grain>('auto')
  const [axisPick, setAxis] = useState<Axis>('ms')
  const hoverIdx = useRef<number | null>(null)
  const [main, second] = metrics
  const fmt = main.format ?? num
  const pd = main.flag != null ? persons : undefined
  const hasPrev = range.prevFrom >= dataFrom

  const fixed: Record<Axis, boolean> = { ms: seg.ms !== 'all', ch: seg.ch !== 'all', pf: seg.pf !== 'all' }
  const axis = fixed[axisPick] ? AXES.find((a) => !fixed[a.id])?.id : axisPick

  const segOk = (r: Seg) =>
    (seg.ch === 'all' || r.channel1 === seg.ch) &&
    (seg.pf === 'all' || r.device_platform === seg.pf) &&
    (seg.ms === 'all' || r.member_seg === seg.ms)

  const byDay = useMemo(() => {
    const m = new Map<string, { a: number; b: number; parts: Record<string, number> }>()
    for (const r of daily) {
      if (r.kst_date < range.prevFrom || r.kst_date > range.to || !segOk(r)) continue
      let z = m.get(r.kst_date)
      if (!z) m.set(r.kst_date, (z = { a: 0, b: 0, parts: {} }))
      const v = main.value(r)
      z.a += v
      if (second) z.b += second.value(r)
      for (const ax of AXES) {
        const k = `${ax.id}:${r[ax.field]}`
        z.parts[k] = (z.parts[k] ?? 0) + v
      }
    }
    return m
  }, [daily, range.prevFrom, range.to, seg.ch, seg.pf, seg.ms, main, second])

  const auto = autoGrain(range)
  const monthCount = range.oneDay ? 1 : buckets(range, 'month').length
  const grainOk: Record<Exclude<Grain, 'auto' | 'hour'>, boolean> = {
    day: !range.oneDay,
    week: range.days >= 8,
    month: monthCount >= 2,
  }
  const grain: Exclude<Grain, 'auto'> = pick === 'auto' || pick === 'hour' || !grainOk[pick] ? auto : pick
  const chartable = grain !== 'hour' || !!main.hour

  const series = useMemo((): { points: Point[]; bks: Bucket[] | null } => {
    if (grain === 'hour') {
      if (!main.hour) return { points: [], bks: null }
      const cur = Array.from({ length: 24 }, () => [0, 0])
      const prev = Array.from({ length: 24 }, () => [0, 0])
      for (const r of hourly) {
        const t = r.kst_date === range.from ? cur : r.kst_date === range.prevFrom ? prev : null
        if (!t || !segOk(r)) continue
        t[r.kst_hour][0] += main.hour(r)
        if (second?.hour) t[r.kst_hour][1] += second.hour(r)
      }
      return {
        points: cur.map((c, h) => ({
          i: h,
          x: `${h}시`,
          cur: c[0],
          prev: hasPrev ? prev[h][0] : null,
          cur2: second?.hour ? c[1] : undefined,
          prev2: second?.hour && hasPrev ? prev[h][1] : null,
        })),
        bks: null,
      }
    }
    const bks = buckets(range, grain)
    let uniq: Map<string, number> | null = null
    if (pd && grain !== 'day') {
      const at: number[] = []
      bks.forEach((b, i) => {
        for (let k = diffDays(range.from, b.from); k <= diffDays(range.from, b.to); k++) at[k] = i
      })
      uniq = uniquePersons(pd, range.prevFrom, range.to, main.flag!, seg, (r) =>
        r.off < range.days ? [`p${at[r.off]}`] : [`c${at[r.off - range.days]}`],
      )
    }
    const points = bks.map((b, i) => {
      let a = 0
      let b2 = 0
      let pa = 0
      let pb = 0
      for (const d of eachDay(b.from, b.to)) {
        const z = byDay.get(d)
        const pz = byDay.get(addDays(d, -range.days))
        if (z) {
          a += z.a
          b2 += z.b
        }
        if (pz) {
          pa += pz.a
          pb += pz.b
        }
      }
      if (uniq) {
        a = uniq.get(`c${i}`) ?? 0
        pa = uniq.get(`p${i}`) ?? 0
      }
      return {
        i,
        x: b.label,
        cur: a,
        prev: hasPrev ? pa : null,
        cur2: second ? b2 : undefined,
        prev2: second && hasPrev ? pb : null,
      }
    })
    return { points, bks }
  }, [grain, byDay, hourly, range.from, range.to, range.days, range.prevFrom, hasPrev, seg.ch, seg.pf, seg.ms, main, second, pd])

  const tiles = useMemo(() => {
    const total = (k: string | null, shift: number) => {
      let v = 0
      for (const d of eachDay(addDays(range.from, -shift), addDays(range.to, -shift))) {
        const z = byDay.get(d)
        if (z) v += k ? z.parts[k] ?? 0 : z.a
      }
      return v
    }
    const ax = AXES.find((a) => a.id === axis)
    const keys: { label: string; k: string | null }[] = [
      { label: '전체', k: null },
      ...(ax ? ax.values.map((v) => ({ label: v.label, k: `${ax.id}:${v.v}` })) : []),
    ]
    const uniq = (from: string, to: string) =>
      pd
        ? uniquePersons(pd, from, to, main.flag!, seg, (r) =>
            ax ? ['all', `${ax.id}:${r[ax.field]}`] : ['all'],
          )
        : null
    const uc = uniq(range.from, range.to)
    const up = hasPrev ? uniq(range.prevFrom, range.prevTo) : null
    return keys.map(({ label, k }) => {
      const cur = uc ? uc.get(k ?? 'all') ?? 0 : total(k, 0)
      const prev = !hasPrev ? null : up ? up.get(k ?? 'all') ?? 0 : total(k, range.days)
      return { label, cur, delta: change(cur, prev) }
    })
  }, [byDay, axis, range.from, range.to, range.days, range.prevFrom, range.prevTo, hasPrev, pd, seg.ch, seg.pf, seg.ms])

  const unit = main.unit
  const spanOf = (a: string, b: string) =>
    a === b ? md(a) : a.slice(0, 4) === b.slice(0, 4) ? `${md(a)}~${md(b)}` : `${a}~${b}`
  const span = spanOf(range.from, range.to)
  const prevSpan = hasPrev ? spanOf(range.prevFrom, range.prevTo) : null
  const meta = `${chartable ? GRAIN_LABEL[grain] + ' · ' : ''}${span} · ${prevSpan ? `전기 ${prevSpan}` : '전기 없음'}`

  const drill = (i: number) => {
    const bks = series.bks
    if (!bks || !bks[i]) return
    const b = bks[i]
    if (grain === 'day') onDrill({ p: '1', d: b.from })
    else if (grain === 'week') onDrill({ p: 'custom', from: b.from, to: b.to })
    else {
      const m = b.from.slice(0, 7)
      const start = `${m}-01`
      const end = addDays(`${addMonths(m, 1)}-01`, -1)
      onDrill({ p: 'custom', from: start < dataFrom ? dataFrom : start, to: end > dataTo ? dataTo : end })
    }
  }

  const wait = (main.flag != null ? personWait : null) ?? (grain === 'hour' && main.hour ? hourWait : null)
  const clickable = grain !== 'hour'
  const dots = series.points.length <= 31
  const secondOn = !!second && (grain !== 'hour' || !!second.hour)

  const grainOptions: { value: Grain; label: string; disabled?: boolean }[] = [
    { value: 'auto', label: '자동' },
    { value: 'day', label: '일', disabled: !grainOk.day },
    { value: 'week', label: '주', disabled: !grainOk.week },
    { value: 'month', label: '월', disabled: !grainOk.month },
  ]

  return (
    <section className="card flex min-w-0 flex-col p-4 sm:p-5">
      <header className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <span className="tnum truncate text-xs text-muted">{meta}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!range.oneDay && (
            <MiniSeg
              label="단위"
              value={pick === 'auto' || !grainOk[pick as 'day'] ? 'auto' : pick}
              onChange={setPick}
              options={grainOptions}
            />
          )}
          <MiniSeg
            label="분해"
            value={(axis ?? 'ms') as Axis}
            onChange={setAxis}
            options={AXES.map((a) => ({ value: a.id, label: a.label, disabled: fixed[a.id] }))}
          />
        </div>
      </header>

      {wait ? (
        <Pending wait={wait} h={260} />
      ) : (
      <div className={chartable ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_188px]' : ''}>
        {chartable && (
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: S(1) }} />
                {main.label}
              </span>
              {secondOn && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: S(2) }} />
                  {second!.label}
                </span>
              )}
              {hasPrev && (
                <span className="inline-flex items-center gap-1.5">
                  <svg width="14" height="2" aria-hidden>
                    <line x1="0" y1="1" x2="14" y2="1" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />
                  </svg>
                  전기 {main.label}
                </span>
              )}
            </div>
            <div className={`-ml-2 h-[260px] ${clickable ? 'cursor-pointer' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={series.points}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  onMouseMove={(st) => {
                    hoverIdx.current = st?.activeTooltipIndex == null ? null : Number(st.activeTooltipIndex)
                  }}
                  onMouseLeave={() => {
                    hoverIdx.current = null
                  }}
                  onClick={(st) => {
                    const i = st?.activeTooltipIndex == null ? hoverIdx.current : Number(st.activeTooltipIndex)
                    if (clickable && i != null) drill(i)
                  }}
                >
                  <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                  <XAxis
                    dataKey="x"
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--axis)' }}
                    minTickGap={18}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 'auto']}
                    tickFormatter={compact}
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                    allowEscapeViewBox={{ x: false, y: false }}
                    wrapperStyle={{ zIndex: 10 }}
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as Point
                      const b = series.bks?.[p.i]
                      const head = b ? b.title : `${md(range.from)} ${p.x}`
                      const prevHead = b ? b.prevTitle : `${md(range.prevFrom)} ${p.x}`
                      const f2 = second?.format ?? num
                      return (
                        <div className="card pointer-events-none min-w-[170px] px-3 py-2 text-xs shadow-lg">
                          <div className="tnum mb-1.5 font-medium text-ink">{head}</div>
                          <div className="flex items-center justify-between gap-4 py-0.5">
                            <span className="inline-flex items-center gap-1.5 text-ink2">
                              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: S(1) }} />
                              {main.label}
                            </span>
                            <span className="tnum font-medium text-ink">{fmt(p.cur)}</span>
                          </div>
                          {hasPrev && (
                            <>
                              <div className="py-0.5">
                                <DeltaMark v={change(p.cur, p.prev)} suffix="전기 대비" />
                              </div>
                              <div className="tnum py-0.5 text-muted">
                                전기 {prevHead}: {p.prev == null ? '—' : fmt(p.prev)}
                              </div>
                            </>
                          )}
                          {secondOn && p.cur2 != null && (
                            <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1">
                              <span className="inline-flex items-center gap-1.5 text-ink2">
                                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: S(2) }} />
                                {second!.label}
                              </span>
                              <span className="tnum text-ink">
                                <span className="font-medium">{f2(p.cur2)}</span>
                                {hasPrev && (
                                  <span className="ml-1.5 text-[11px]">
                                    <DeltaMark v={change(p.cur2, p.prev2 ?? null)} />
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  {hasPrev && (
                    <Line
                      dataKey="prev"
                      stroke="var(--muted)"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={{ r: 3, fill: 'var(--muted)', stroke: 'var(--surface)', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  )}
                  {secondOn && (
                    <Line
                      dataKey="cur2"
                      stroke={S(2)}
                      strokeWidth={2}
                      dot={dots ? { r: 3, fill: S(2), stroke: 'var(--surface)', strokeWidth: 2 } : false}
                      activeDot={{ r: 5, fill: S(2), stroke: 'var(--surface)', strokeWidth: 2 }}
                      isAnimationActive={false}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  <Line
                    dataKey="cur"
                    stroke={S(1)}
                    strokeWidth={2}
                    dot={dots ? { r: 4, fill: S(1), stroke: 'var(--surface)', strokeWidth: 2 } : false}
                    activeDot={{ r: 7, fill: S(1), stroke: 'var(--surface)', strokeWidth: 2 }}
                    isAnimationActive={false}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="self-start overflow-hidden rounded-lg border border-line">
          <div
            className={`-mb-px -mr-px grid [&>*]:border-b [&>*]:border-r [&>*]:border-line ${
              chartable ? 'grid-cols-2 lg:grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'
            }`}
          >
          {tiles.map((t) => (
            <div key={t.label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <div className="truncate text-xs text-ink2">{t.label}</div>
              <div className="flex items-baseline gap-1">
                <span className="tnum text-lg font-semibold leading-tight text-ink">{fmt(t.cur)}</span>
                <span className="text-[11px] text-muted">{unit}</span>
              </div>
              {hasPrev && (
                <div className="text-[11px]">
                  <DeltaMark v={t.delta} />
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
      )}
    </section>
  )
}
