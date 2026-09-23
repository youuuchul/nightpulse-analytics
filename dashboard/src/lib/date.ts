const DAY = 86_400_000

export function parse(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
}

export function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export function addDays(d: string, n: number): string {
  return iso(parse(d) + n * DAY)
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / DAY)
}

export function mondayOf(d: string): string {
  const wd = (new Date(parse(d)).getUTCDay() + 6) % 7
  return addDays(d, -wd)
}

export function weekday(d: string): number {
  return (new Date(parse(d)).getUTCDay() + 6) % 7
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = parse(from); t <= parse(to); t += DAY) out.push(iso(t))
  return out
}

export function addMonths(m: string, n: number): string {
  const y = +m.slice(0, 4)
  const mo = +m.slice(5, 7) - 1 + n
  const yy = y + Math.floor(mo / 12)
  const mm = ((mo % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

export function md(d: string): string {
  return `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
}

export function mdPad(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`
}

export function ym(m: string): string {
  return `${m.slice(2, 4)}.${m.slice(5, 7)}`
}

export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']
