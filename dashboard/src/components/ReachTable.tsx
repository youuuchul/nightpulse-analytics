import { Fragment } from 'react'
import { num, pct } from '../lib/format'

export interface ReachRow {
  key: string
  label: string
  group?: string
  color?: string
  base: number
  counts: number[]
}

export function ReachTable({
  rows,
  steps,
  baseLabel,
  unit,
}: {
  rows: ReachRow[]
  steps: string[]
  baseLabel: string
  unit: string
}) {
  const rates = rows.map((r) => r.counts.map((c) => (r.base > 0 ? c / r.base : null)))
  const bounds = steps.map((_, ci) => {
    const vs = rates.map((r) => r[ci]).filter((v): v is number => v != null)
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 0]
  })
  const hasGroup = rows.some((r) => r.group)
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-axis text-muted">
            <th className="py-2 pr-3 text-left font-medium" colSpan={hasGroup ? 2 : 1} />
            <th className="py-2 pr-3 text-right font-medium">{baseLabel}</th>
            {steps.map((s) => (
              <th key={s} className="whitespace-nowrap px-0.5 py-2 text-center font-medium">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const first = hasGroup && (ri === 0 || rows[ri - 1].group !== r.group)
            return (
              <Fragment key={r.key}>
                <tr className={first && ri > 0 ? 'border-t border-line' : ''}>
                  {hasGroup && (
                    <td className="w-14 whitespace-nowrap py-1 pr-2 align-middle text-xs text-muted">{first ? r.group : ''}</td>
                  )}
                  <td className="whitespace-nowrap py-1 pr-3 text-ink2">
                    <span className="inline-flex items-center gap-1.5">
                      {r.color && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />}
                      {r.label}
                    </span>
                  </td>
                  <td className="tnum whitespace-nowrap py-1 pr-3 text-right text-ink">{num(r.base)}</td>
                  {rates[ri].map((v, ci) => {
                    const [lo, hi] = bounds[ci]
                    const t = v == null ? 0 : hi > lo ? (v - lo) / (hi - lo) : hi > 0 ? 0.5 : 0
                    const p = Math.round(12 + t * 88)
                    return (
                      <td key={ci} className="px-0.5 py-0.5">
                        <div
                          title={`${r.label} · ${steps[ci]} ${num(r.counts[ci])}${unit} / ${baseLabel} ${num(r.base)}${unit}`}
                          className="tnum flex h-7 min-w-[64px] items-center justify-center rounded-[3px] text-xs"
                          style={
                            v == null
                              ? { color: 'var(--muted)' }
                              : {
                                  background: `color-mix(in oklab, var(--seq-hi) ${p}%, var(--seq-lo))`,
                                  color: p > 55 ? 'var(--seq-ink-hi)' : 'var(--seq-ink-lo)',
                                }
                          }
                        >
                          {pct(v)}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
