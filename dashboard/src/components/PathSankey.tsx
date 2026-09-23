import { useEffect, useMemo, useRef, useState } from 'react'
import { num, pct } from '../lib/format'
import { EXIT_NODE, OTHER_NODE, screenColor, screenLabel } from '../lib/labels'

export interface PathLink {
  step: number
  from: string
  to: string
  value: number
}

interface Node {
  id: string
  col: number
  screen: string
  value: number
  y: number
  h: number
}

interface Link {
  id: string
  col: number
  src: Node
  dst: Node
  value: number
  sy: number
  ty: number
  h: number
}

const NODE_W = 10
const PAD = 8
const HEAD = 22
const COL_LABEL = ['랜딩', '2번째 화면', '3번째 화면', '4번째 화면', '5번째 화면']

function orderKey(n: { screen: string; value: number }): number {
  if (n.screen === EXIT_NODE) return 2
  if (n.screen === OTHER_NODE) return 1
  return 0
}

function layout(links: PathLink[], width: number, height: number) {
  const cols = Math.max(0, ...links.map((l) => l.step)) + 1
  const vals: Map<string, number>[] = Array.from({ length: cols }, () => new Map())
  for (const l of links) {
    if (l.step === 1) vals[0].set(l.from, (vals[0].get(l.from) ?? 0) + l.value)
    vals[l.step].set(l.to, (vals[l.step].get(l.to) ?? 0) + l.value)
  }
  const inner = height - HEAD
  let k = Infinity
  for (const m of vals) {
    const tot = [...m.values()].reduce((a, b) => a + b, 0)
    if (tot > 0) k = Math.min(k, (inner - PAD * (m.size - 1)) / tot)
  }
  if (!Number.isFinite(k)) k = 0
  const nodes = new Map<string, Node>()
  vals.forEach((m, col) => {
    const list = [...m.entries()]
      .map(([screen, value]) => ({ screen, value }))
      .filter((n) => n.value > 0)
      .sort((a, b) => orderKey(a) - orderKey(b) || b.value - a.value)
    let y = HEAD
    for (const n of list) {
      const h = Math.max(1, n.value * k)
      nodes.set(`${col}|${n.screen}`, { id: `${col}|${n.screen}`, col, screen: n.screen, value: n.value, y, h })
      y += h + PAD
    }
  })
  const out: Link[] = []
  for (const l of links) {
    const src = nodes.get(`${l.step - 1}|${l.from}`)
    const dst = nodes.get(`${l.step}|${l.to}`)
    if (!src || !dst || l.value <= 0) continue
    out.push({ id: `${l.step}|${l.from}|${l.to}`, col: l.step - 1, src, dst, value: l.value, sy: 0, ty: 0, h: l.value * k })
  }
  const bySrc = new Map<string, Link[]>()
  const byDst = new Map<string, Link[]>()
  for (const l of out) {
    bySrc.set(l.src.id, [...(bySrc.get(l.src.id) ?? []), l])
    byDst.set(l.dst.id, [...(byDst.get(l.dst.id) ?? []), l])
  }
  for (const [id, ls] of bySrc) {
    let y = nodes.get(id)!.y
    for (const l of ls.sort((a, b) => a.dst.y - b.dst.y)) {
      l.sy = y
      y += l.h
    }
  }
  for (const [id, ls] of byDst) {
    let y = nodes.get(id)!.y
    for (const l of ls.sort((a, b) => a.src.y - b.src.y)) {
      l.ty = y
      y += l.h
    }
  }
  const span = Math.max(1, width - NODE_W)
  const x = (c: number) => (cols > 1 ? (c * span) / (cols - 1) : 0)
  const total = [...vals[0]?.values() ?? []].reduce((a, b) => a + b, 0)
  return { nodes: [...nodes.values()], links: out, x, cols, total }
}

function band(l: Link, x: (c: number) => number): string {
  const x0 = x(l.col) + NODE_W
  const x1 = x(l.col + 1)
  const xm = (x0 + x1) / 2
  const h = Math.max(l.h, 0.8)
  return `M${x0},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty}L${x1},${l.ty + h}C${xm},${l.ty + h} ${xm},${l.sy + h} ${x0},${l.sy + h}Z`
}

type Hover = { kind: 'link'; link: Link } | { kind: 'node'; node: Node }

function Detail({ h, total, outOf }: { h: Hover; total: number; outOf: (n: Node) => number }) {
  if (h.kind === 'node') {
    const n = h.node
    return (
      <>
        <div className="mb-1 font-medium text-ink">
          {screenLabel(n.screen)} <span className="font-normal text-muted">· {COL_LABEL[n.col]}</span>
        </div>
        <div className="tnum flex justify-between gap-4">
          <span className="text-ink2">세션</span>
          <span className="text-ink">{num(n.value)}</span>
        </div>
        <div className="tnum flex justify-between gap-4">
          <span className="text-ink2">전체 세션 대비</span>
          <span className="text-ink">{pct(total ? n.value / total : null)}</span>
        </div>
      </>
    )
  }
  const l = h.link
  return (
    <>
      <div className="mb-1 font-medium text-ink">
        {screenLabel(l.src.screen)} → {screenLabel(l.dst.screen)}{' '}
        <span className="font-normal text-muted">
          · {COL_LABEL[l.col]} → {COL_LABEL[l.col + 1]}
        </span>
      </div>
      <div className="tnum flex justify-between gap-4">
        <span className="text-ink2">세션</span>
        <span className="text-ink">{num(l.value)}</span>
      </div>
      <div className="tnum flex justify-between gap-4">
        <span className="text-ink2">{screenLabel(l.src.screen)} 세션 중</span>
        <span className="text-ink">{pct(outOf(l.src) ? l.value / outOf(l.src) : null)}</span>
      </div>
      <div className="tnum flex justify-between gap-4">
        <span className="text-ink2">전체 세션 대비</span>
        <span className="text-ink">{pct(total ? l.value / total : null)}</span>
      </div>
    </>
  )
}

export function PathSankey({ links, height = 440 }: { links: PathLink[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState<(Hover & { x: number; y: number }) | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(720, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const g = useMemo(() => layout(links, width, height), [links, width, height])
  useEffect(() => setPinned(null), [links])
  const outOf = (n: Node) => g.links.filter((l) => l.src.id === n.id).reduce((a, l) => a + l.value, 0) || n.value
  const pinnedLink = g.links.find((l) => l.id === pinned)
  const active = hover?.kind === 'link' ? hover.link.id : hover?.kind === 'node' ? null : pinned
  const activeNode = hover?.kind === 'node' ? hover.node.id : null
  const lit = (l: Link) =>
    active ? l.id === active : activeNode ? l.src.id === activeNode || l.dst.id === activeNode : true
  const lastCol = g.cols - 1

  const onMove = (e: React.MouseEvent, h: Hover) => {
    const r = ref.current!.getBoundingClientRect()
    setHover({ ...h, x: e.clientX - r.left + ref.current!.scrollLeft, y: e.clientY - r.top })
  }

  return (
    <div>
      <div ref={ref} className="relative -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} className="block" role="img" aria-label="세션 화면 경로">
          <g>
            {[...Array(g.cols).keys()].map((c) => (
              <text
                key={c}
                x={c === lastCol ? g.x(c) + NODE_W : g.x(c)}
                y={12}
                textAnchor={c === lastCol ? 'end' : 'start'}
                className="fill-[var(--muted)] text-[11px]"
              >
                {COL_LABEL[c]}
              </text>
            ))}
            {g.links.map((l) => {
              const exit = l.dst.screen === EXIT_NODE
              const on = lit(l)
              const strong = l.id === active
              return (
                <path
                  key={l.id}
                  d={band(l, g.x)}
                  fill={exit ? 'var(--exit)' : screenColor(l.src.screen)}
                  fillOpacity={strong ? 0.62 : on ? (active || activeNode ? 0.45 : 0.24) : 0.07}
                  className="cursor-pointer"
                  onMouseMove={(e) => onMove(e, { kind: 'link', link: l })}
                  onClick={() => setPinned(pinned === l.id ? null : l.id)}
                />
              )
            })}
            {g.nodes.map((n) => (
              <rect
                key={n.id}
                x={g.x(n.col)}
                y={n.y}
                width={NODE_W}
                height={n.h}
                rx={2}
                fill={screenColor(n.screen)}
                onMouseMove={(e) => onMove(e, { kind: 'node', node: n })}
              />
            ))}
            {g.nodes
              .filter((n) => n.h >= 11)
              .map((n) => {
                const right = n.col !== lastCol
                return (
                  <text
                    key={`t${n.id}`}
                    x={right ? g.x(n.col) + NODE_W + 5 : g.x(n.col) - 5}
                    y={n.y + n.h / 2}
                    dy="0.35em"
                    textAnchor={right ? 'start' : 'end'}
                    className="pointer-events-none text-[11px]"
                    style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' }}
                  >
                    <tspan className="fill-[var(--ink-2)]">{screenLabel(n.screen)}</tspan>
                    <tspan className="tnum fill-[var(--muted)]"> {num(n.value)}</tspan>
                  </text>
                )
              })}
          </g>
        </svg>
        {hover && (
          <div
            className="card pointer-events-none absolute z-10 min-w-[190px] px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(hover.x + 14, width - 200), top: Math.max(0, hover.y - 10) }}
          >
            <Detail h={hover} total={g.total} outOf={outOf} />
          </div>
        )}
      </div>
      <div className="mt-2 min-h-[18px] text-xs text-ink2">
        {pinnedLink && (
          <span className="tnum">
            {screenLabel(pinnedLink.src.screen)} → {screenLabel(pinnedLink.dst.screen)} · {COL_LABEL[pinnedLink.col]} →{' '}
            {COL_LABEL[pinnedLink.col + 1]} · 세션 {num(pinnedLink.value)} · {screenLabel(pinnedLink.src.screen)} 세션 중{' '}
            {pct(pinnedLink.value / outOf(pinnedLink.src))} · 전체 대비 {pct(g.total ? pinnedLink.value / g.total : null)}
          </span>
        )}
      </div>
    </div>
  )
}
