import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMetricSpec } from '../lib/metrics'

/** 타일 이름 옆 `?` — 누르면 metrics.json 의 정의를 띄운다. */
export default function MetricHelp({ id }: { id: string }) {
  const spec = useMetricSpec()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const def = spec && spec !== 'error' ? spec.metrics.find((m) => m.id === id) : undefined

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const w = Math.min(300, window.innerWidth - 24)
    const left = Math.max(12, Math.min(r.left - 12, window.innerWidth - w - 12))
    const h = box.current?.offsetHeight ?? 0
    const below = r.bottom + 6
    const top = h && below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below
    setPos({ left, top })
  }, [open, def])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'mousedown' && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (!def) return null
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`${def.name} 정의`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none transition-colors ${
          open ? 'bg-[var(--ink)] text-[var(--surface)]' : 'bg-wash text-muted hover:text-ink'
        }`}
      >
        ?
      </button>
      {open && (
        <div
          ref={box}
          role="dialog"
          aria-label={def.name}
          className="card fixed z-50 w-[300px] max-w-[calc(100vw-24px)] px-3.5 py-3 text-xs shadow-lg"
          style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">{def.name}</span>
            <span className="tnum text-[11px] text-muted">{def.id}</span>
          </div>
          <p className="leading-relaxed text-ink2">{def.definition}</p>
          <dl className="mt-2 grid grid-cols-[44px_1fr] gap-x-2 gap-y-1 border-t border-line pt-2 leading-snug">
            <dt className="text-muted">산식</dt>
            <dd className="text-ink2">{def.formula}</dd>
            {def.denominator !== '—' && (
              <>
                <dt className="text-muted">분모</dt>
                <dd className="text-ink2">{def.denominator}</dd>
              </>
            )}
            <dt className="text-muted">단위</dt>
            <dd className="text-ink2">{def.unit}</dd>
          </dl>
        </div>
      )}
    </>
  )
}
