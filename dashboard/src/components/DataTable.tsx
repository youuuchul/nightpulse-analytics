import { useMemo, useState, type ReactNode } from 'react'

export interface Col<T> {
  key: string
  label: string
  value: (r: T) => number | string | null
  render?: (r: T) => ReactNode
  num?: boolean
  width?: string
}

export function DataTable<T>({
  cols,
  rows,
  sortKey,
  rowKey,
  limit = 20,
  selected,
  onSelect,
  minW = 'min-w-[640px]',
}: {
  cols: Col<T>[]
  rows: T[]
  sortKey: string
  rowKey: (r: T) => string
  limit?: number
  selected?: string
  onSelect?: (r: T) => void
  minW?: string
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: sortKey, desc: true })
  const [all, setAll] = useState(false)
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === sort.key) ?? cols[0]
    const out = [...rows].sort((a, b) => {
      const va = c.value(a)
      const vb = c.value(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')
      return sort.desc ? -d : d
    })
    return out
  }, [rows, cols, sort])
  const shown = all ? sorted : sorted.slice(0, limit)
  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className={`w-full ${minW} border-collapse text-[13px]`}>
          <thead>
            <tr className="border-b border-axis">
              {cols.map((c) => {
                const on = sort.key === c.key
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width }}
                    className={`whitespace-nowrap py-2 font-medium ${c.num ? 'text-right' : 'text-left'} ${
                      on ? 'text-ink' : 'text-muted'
                    } pr-3 last:pr-0`}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-ink"
                      onClick={() => setSort({ key: c.key, desc: on ? !sort.desc : true })}
                    >
                      {c.label}
                      <span className={`text-[9px] ${on ? '' : 'invisible'}`}>{sort.desc ? '▼' : '▲'}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = rowKey(r)
              const sel = selected === k
              return (
                <tr
                  key={k}
                  onClick={onSelect ? () => onSelect(r) : undefined}
                  className={`border-b border-line ${onSelect ? 'cursor-pointer' : ''} ${
                    sel ? 'bg-[var(--bar-wash)]' : 'hover:bg-wash'
                  }`}
                >
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2 pr-3 last:pr-0 ${c.num ? 'tnum whitespace-nowrap text-right text-ink' : 'text-ink2'}`}
                    >
                      {c.render ? c.render(r) : (c.value(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 text-xs text-muted hover:text-ink">
          {all ? `상위 ${limit}개만` : `전체 ${sorted.length}개`}
        </button>
      )}
    </div>
  )
}
