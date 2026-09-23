const nf = new Intl.NumberFormat('ko-KR')

export function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return nf.format(Math.round(v))
}

export function dec(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function won(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e8) return `${(v / 1e8).toFixed(a >= 1e9 ? 1 : 2)}억`
  if (a >= 1e4) return `${(v / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: a >= 1e6 ? 0 : 1 })}만`
  return nf.format(Math.round(v))
}

export function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e8) return `${+(v / 1e8).toFixed(1)}억`
  if (a >= 1e4) return `${+(v / 1e4).toFixed(1)}만`
  return nf.format(v)
}

export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null
}
