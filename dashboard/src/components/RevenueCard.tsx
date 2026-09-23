import { useMemo, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Range } from '../lib/agg'
import { addDays, addMonths, eachDay, md } from '../lib/date'
import { compact, won } from '../lib/format'
import { REVENUE_KINDS } from '../lib/labels'
import { revenueByDay } from '../lib/revenue'
import type { DailyRevenue, RevenueKind } from '../lib/types'
import MetricHelp from './MetricHelp'
import { type Bucket, DeltaMark, GRAIN_LABEL, MiniSeg, autoGrain, buckets, change } from './TrendCard'

type Grain = 'auto' | 'day' | 'week' | 'month'

interface Point {
  i: number
  x: string
  ticket: number
  subscription: number
  b2b: number
  total: number
  prev: number | null
}

/**
 * 매출 구성 추이 카드 — 종류별(티켓·구독·B2B) 누적 막대 + 전기 합계 점선 + 종류별 분해 타일.
 * 매출 마트에는 세그먼트 축이 없어 세그먼트 상태를 받지 않는다.
 */
export default function RevenueCard({
  rows,
  range,
  dataFrom,
  dataTo,
  onDrill,
}: {
  rows?: DailyRevenue[]
  range: Range
  dataFrom: string
  dataTo: string
  onDrill: (p: { p: '1'; d: string } | { p: 'custom'; from: string; to: string }) => void
}) {
  const [pick, setPick] = useState<Grain>('auto')
  const hoverIdx = useRef<number | null>(null)
  const byDay = useMemo(() => revenueByDay(rows ?? []), [rows])
  const hasPrev = range.prevFrom >= dataFrom

  const auto = autoGrain(range)
  const monthCount = range.oneDay ? 1 : buckets(range, 'month').length
  const grainOk = { day: !range.oneDay, week: range.days >= 8, month: monthCount >= 2 }
  const grain = pick === 'auto' || !grainOk[pick] ? auto : pick
  const chartable = grain !== 'hour'

  const sumSpan = (a: string, b: string) => {
    const z = { ticket: 0, subscription: 0, b2b: 0 }
    for (const d of eachDay(a, b)) {
      const v = byDay.get(d)
      if (v) for (const k of Object.keys(z) as RevenueKind[]) z[k] += v[k]
    }
    return z
  }

  const series = useMemo((): { points: Point[]; bks: Bucket[] } => {
    if (!chartable) return { points: [], bks: [] }
    const bks = buckets(range, grain as 'day' | 'week' | 'month')
    const points = bks.map((b, i) => {
      const c = sumSpan(b.from, b.to)
      const p = sumSpan(addDays(b.from, -range.days), addDays(b.to, -range.days))
      return {
        i,
        x: b.label,
        ...c,
        total: c.ticket + c.subscription + c.b2b,
        prev: hasPrev ? p.ticket + p.subscription + p.b2b : null,
      }
    })
    return { points, bks }
  }, [byDay, grain, range.from, range.to, range.days, hasPrev, chartable])

  const cur = sumSpan(range.from, range.to)
  const prev = hasPrev ? sumSpan(range.prevFrom, range.prevTo) : null
  const tiles = [
    { label: '전체', cur: cur.ticket + cur.subscription + cur.b2b, prev: prev ? prev.ticket + prev.subscription + prev.b2b : null, color: '' },
    ...REVENUE_KINDS.map((k) => ({ label: k.label, cur: cur[k.key], prev: prev ? prev[k.key] : null, color: k.color })),
  ]

  const spanOf = (a: string, b: string) =>
    a === b ? md(a) : a.slice(0, 4) === b.slice(0, 4) ? `${md(a)}~${md(b)}` : `${a}~${b}`
  const meta = `${chartable ? GRAIN_LABEL[grain] + ' · ' : ''}${spanOf(range.from, range.to)} · ${
    hasPrev ? `전기 ${spanOf(range.prevFrom, range.prevTo)}` : '전기 없음'
  }`

  const drill = (i: number) => {
    const b = series.bks[i]
    if (!b) return
    if (grain === 'day') onDrill({ p: '1', d: b.from })
    else if (grain === 'week') onDrill({ p: 'custom', from: b.from, to: b.to })
    else {
      const m = b.from.slice(0, 7)
      const start = `${m}-01`
      const end = addDays(`${addMonths(m, 1)}-01`, -1)
      onDrill({ p: 'custom', from: start < dataFrom ? dataFrom : start, to: end > dataTo ? dataTo : end })
    }
  }

  return (
    <section className="card flex min-w-0 flex-col p-4 sm:p-5">
      <header className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="flex items-center text-[15px] font-semibold text-ink">
            매출 구성
            <MetricHelp id="M05" />
          </h2>
          {rows && <span className="tnum truncate text-xs text-muted">{meta}</span>}
        </div>
        {rows && !range.oneDay && (
          <MiniSeg
            label="단위"
            value={pick === 'auto' || !grainOk[pick] ? 'auto' : pick}
            onChange={setPick}
            options={[
              { value: 'auto', label: '자동' },
              { value: 'day', label: '일', disabled: !grainOk.day },
              { value: 'week', label: '주', disabled: !grainOk.week },
              { value: 'month', label: '월', disabled: !grainOk.month },
            ]}
          />
        )}
      </header>

      {!rows ? (
        <div className="flex min-h-[22px] items-center text-sm text-muted">데이터 없음</div>
      ) : (
        <div className={chartable ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_188px]' : ''}>
          {chartable && (
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
                {REVENUE_KINDS.map((k) => (
                  <span key={k.key} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: k.color }} />
                    {k.label}
                  </span>
                ))}
                {hasPrev && (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="14" height="2" aria-hidden>
                      <line x1="0" y1="1" x2="14" y2="1" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />
                    </svg>
                    전기 합계
                  </span>
                )}
              </div>
              <div className="-ml-2 h-[260px] cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={series.points}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    barCategoryGap="22%"
                    onMouseMove={(st) => {
                      hoverIdx.current = st?.activeTooltipIndex == null ? null : Number(st.activeTooltipIndex)
                    }}
                    onMouseLeave={() => {
                      hoverIdx.current = null
                    }}
                    onClick={(st) => {
                      const i = st?.activeTooltipIndex == null ? hoverIdx.current : Number(st.activeTooltipIndex)
                      if (i != null) drill(i)
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
                      tickFormatter={compact}
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--wash)' }}
                      allowEscapeViewBox={{ x: false, y: false }}
                      wrapperStyle={{ zIndex: 10 }}
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const p = payload[0].payload as Point
                        const b = series.bks[p.i]
                        return (
                          <div className="card pointer-events-none min-w-[180px] px-3 py-2 text-xs shadow-lg">
                            <div className="tnum mb-1.5 font-medium text-ink">{b?.title}</div>
                            {[...REVENUE_KINDS].reverse().map((k) => (
                              <div key={k.key} className="flex items-center justify-between gap-4 py-0.5">
                                <span className="inline-flex items-center gap-1.5 text-ink2">
                                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: k.color }} />
                                  {k.label}
                                </span>
                                <span className="tnum font-medium text-ink">{won(p[k.key])}</span>
                              </div>
                            ))}
                            <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1">
                              <span className="text-ink2">합계</span>
                              <span className="tnum font-medium text-ink">{won(p.total)}</span>
                            </div>
                            {hasPrev && (
                              <>
                                <div className="py-0.5">
                                  <DeltaMark v={change(p.total, p.prev)} suffix="전기 대비" />
                                </div>
                                <div className="tnum py-0.5 text-muted">
                                  전기 {b?.prevTitle}: {p.prev == null ? '—' : won(p.prev)}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      }}
                    />
                    {REVENUE_KINDS.map((k, i) => (
                      <Bar
                        key={k.key}
                        dataKey={k.key}
                        stackId="r"
                        fill={k.color}
                        maxBarSize={28}
                        radius={i === REVENUE_KINDS.length - 1 ? [4, 4, 0, 0] : 0}
                        stroke="var(--surface)"
                        strokeWidth={1}
                        isAnimationActive={false}
                      />
                    ))}
                    {hasPrev && (
                      <Line
                        dataKey="prev"
                        stroke="var(--muted)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                      />
                    )}
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
                  <div className="inline-flex items-center gap-1.5 truncate text-xs text-ink2">
                    {t.color && <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: t.color }} />}
                    {t.label}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="tnum text-lg font-semibold leading-tight text-ink">{won(t.cur)}</span>
                    <span className="text-[11px] text-muted">원</span>
                  </div>
                  {hasPrev && (
                    <div className="text-[11px]">
                      <DeltaMark v={change(t.cur, t.prev)} />
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
