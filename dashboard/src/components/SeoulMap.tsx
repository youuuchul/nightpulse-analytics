import { type MouseEvent, useMemo, useRef, useState } from 'react'
import { num, won } from '../lib/format'
import { PLAN_LABEL, S } from '../lib/labels'
import type { VenueRegistry } from '../lib/types'

// 서울 경계·한강 중심선 근사(위도, 경도). 공개 지도의 윤곽을 손으로 줄인 값이라 구 경계 수준의 정확도는 없다.
const OUTLINE: [number, number][] = [
  [37.585, 126.765], [37.603, 126.795], [37.628, 126.858], [37.652, 126.902], [37.676, 126.93],
  [37.662, 126.965], [37.69, 126.99], [37.715, 127.013], [37.702, 127.05], [37.69, 127.087],
  [37.66, 127.103], [37.62, 127.117], [37.585, 127.12], [37.562, 127.116], [37.556, 127.142],
  [37.571, 127.176], [37.556, 127.186], [37.53, 127.17], [37.5, 127.157], [37.47, 127.146],
  [37.455, 127.122], [37.43, 127.09], [37.428, 127.05], [37.455, 127.022], [37.44, 126.99],
  [37.45, 126.946], [37.44, 126.905], [37.463, 126.88], [37.47, 126.845], [37.49, 126.825],
  [37.51, 126.815], [37.53, 126.8], [37.55, 126.78], [37.57, 126.77],
]
const RIVER: [number, number][] = [
  [37.588, 126.79], [37.568, 126.845], [37.556, 126.875], [37.548, 126.895], [37.54, 126.915],
  [37.532, 126.935], [37.524, 126.955], [37.517, 126.975], [37.515, 126.99], [37.519, 127.005],
  [37.527, 127.015], [37.535, 127.025], [37.538, 127.04], [37.535, 127.06], [37.527, 127.075],
  [37.522, 127.09], [37.527, 127.105], [37.54, 127.12], [37.555, 127.13], [37.568, 127.15], [37.578, 127.18],
]

const LAT0 = 37.55
const KX = Math.cos((LAT0 * Math.PI) / 180)
const W = 1000
const minLng = Math.min(...OUTLINE.map((p) => p[1]))
const maxLng = Math.max(...OUTLINE.map((p) => p[1]))
const minLat = Math.min(...OUTLINE.map((p) => p[0]))
const maxLat = Math.max(...OUTLINE.map((p) => p[0]))
const K = W / ((maxLng - minLng) * KX)
const H = Math.round((maxLat - minLat) * K)
const PAD = 16

/** 위경도 → SVG 좌표(등장방형 근사: 경도에 cos(위도) 보정). */
export function project(lat: number, lng: number): [number, number] {
  return [(lng - minLng) * KX * K, (maxLat - lat) * K]
}

const path = (pts: [number, number][], close: boolean) =>
  pts.map(([la, ln], i) => `${i ? 'L' : 'M'}${project(la, ln).map((v) => v.toFixed(1)).join(',')}`).join('') + (close ? 'Z' : '')

export const PARTNER_COLOR = S(7)
const RIVER_LABEL = project(37.508, 126.96)

interface Dot {
  v: VenueRegistry
  x: number
  y: number
  r: number
}

/**
 * 서울 공간 분포 지도 — 점 = 공간, 크기 = 28일 상세 조회, 색 = 파트너 여부. hover 시 가장 가까운 점의 정보.
 */
export default function SeoulMap({ venues }: { venues: VenueRegistry[] }) {
  const svg = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Dot | null>(null)

  const { dots, labels } = useMemo(() => {
    const max = Math.max(1, ...venues.map((v) => v.detail_viewers_28d))
    const ds: Dot[] = venues
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
      .map((v) => {
        const [x, y] = project(v.lat, v.lng)
        return { v, x, y, r: 3 + 9 * Math.sqrt(v.detail_viewers_28d / max) }
      })
      .sort((a, b) => Number(a.v.is_partner) - Number(b.v.is_partner) || b.r - a.r)
    const agg = new Map<string, Dot[]>()
    for (const d of ds) {
      if (d.v.region === '기타') continue
      const z = agg.get(d.v.region) ?? []
      z.push(d)
      agg.set(d.v.region, z)
    }
    // 라벨은 상권 점 무리의 위(막히면 아래) 가장자리 바깥에 둔다. 가장자리는 외곽 5% 를 뺀 분위로 잡는다.
    const q = (v: number[], p: number) => v.sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))]
    const placed: { name: string; x: number; y: number; w: number }[] = []
    for (const [name, z] of [...agg.entries()].filter(([, z]) => z.length >= 5).sort((a, b) => b[1].length - a[1].length)) {
      const short = name.split('·')[0]
      const w = short.length * 17 + 8
      const x = z.reduce((a, d) => a + d.x, 0) / z.length
      const top = q(z.map((d) => d.y - d.r), 0.05) - 8
      const bottom = q(z.map((d) => d.y + d.r), 0.95) + 20
      const y = [top, bottom].find((yy) => placed.every((p) => Math.abs(p.x - x) > (p.w + w) / 2 || Math.abs(p.y - yy) > 22))
      if (y != null) placed.push({ name: short, x, y, w })
    }
    return { dots: ds, labels: placed }
  }, [venues])

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const tol = 14 / m.a
    let best: Dot | null = null
    let bd = Infinity
    for (const d of dots) {
      const dd = Math.hypot(d.x - pt.x, d.y - pt.y) - d.r
      if (dd < bd) {
        bd = dd
        best = d
      }
    }
    setHover(best && bd <= tol ? best : null)
  }

  const tip = hover
    ? {
        left: `${((hover.x + PAD) / (W + 2 * PAD)) * 100}%`,
        top: `${((hover.y + PAD) / (H + 2 * PAD)) * 100}%`,
        right: hover.x > W * 0.62,
      }
    : null

  return (
    <div className="relative">
      <svg
        ref={svg}
        viewBox={`${-PAD} ${-PAD} ${W + 2 * PAD} ${H + 2 * PAD}`}
        className="block h-auto w-full touch-none select-none"
        role="img"
        aria-label={`서울 공간 분포 ${num(dots.length)}곳`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <path d={path(OUTLINE, true)} fill="var(--wash)" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" />
        <path
          d={path(RIVER, false)}
          fill="none"
          stroke="color-mix(in oklab, var(--s1) 22%, var(--surface))"
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x={RIVER_LABEL[0]}
          y={RIVER_LABEL[1]}
          fontSize={15}
          fill="var(--muted)"
          fontStyle="italic"
        >
          한강
        </text>
        {dots.map((d) => (
          <circle
            key={d.v.venue_id}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={d.v.is_partner ? PARTNER_COLOR : 'var(--muted)'}
            fillOpacity={d.v.is_partner ? 0.82 : 0.38}
            stroke="var(--surface)"
            strokeWidth={d.v.is_partner ? 1 : 0.6}
          />
        ))}
        {labels.map((l) => (
          <text
            key={l.name}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fontSize={17}
            fontWeight={600}
            fill="var(--ink)"
            stroke="var(--surface)"
            strokeWidth={4}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {l.name}
          </text>
        ))}
        {hover && (
          <circle
            cx={hover.x}
            cy={hover.y}
            r={hover.r + 3}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            pointerEvents="none"
          />
        )}
      </svg>
      {hover && tip && (
        <div
          className="card pointer-events-none absolute z-10 min-w-[180px] px-3 py-2 text-xs shadow-lg"
          style={{
            left: tip.left,
            top: tip.top,
            transform: `translate(${tip.right ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
          }}
        >
          <div className="mb-1 font-medium text-ink">{hover.v.name}</div>
          <div className="text-ink2">
            {hover.v.region} · {hover.v.genre} · {hover.v.venue_type}
          </div>
          <div className="mt-1 flex items-center gap-1.5 border-t border-line pt-1 text-ink2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: hover.v.is_partner ? PARTNER_COLOR : 'var(--muted)' }}
            />
            {hover.v.is_partner ? `파트너 · ${PLAN_LABEL[hover.v.plan ?? ''] ?? hover.v.plan ?? '—'}` : '비파트너'}
          </div>
          <div className="tnum mt-0.5 flex justify-between gap-4 text-ink2">
            <span>28일 조회</span>
            <span className="font-medium text-ink">{num(hover.v.detail_viewers_28d)}</span>
          </div>
          {hover.v.ticket_amount_365d > 0 && (
            <div className="tnum flex justify-between gap-4 text-ink2">
              <span>티켓 매출 · 365일</span>
              <span className="font-medium text-ink">{won(hover.v.ticket_amount_365d)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
