import type { ReactNode } from 'react'

const REPO = 'https://github.com/youuuchul/nightpulse-analytics'

const B = { fill: 'var(--wash)' }
const LINE = 'var(--axis)'

function Phone({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 140 272" className="w-full max-w-[150px]" role="img" aria-hidden>
      <rect x="1" y="1" width="138" height="270" rx="20" fill="var(--surface)" stroke={LINE} strokeWidth="1.5" />
      <rect x="52" y="9" width="36" height="6" rx="3" fill={LINE} />
      <g transform="translate(12,24)">{children}</g>
    </svg>
  )
}

function Lines({ y, ws }: { y: number; ws: number[] }) {
  return (
    <>
      {ws.map((w, i) => (
        <rect key={i} x="0" y={y + i * 10} width={w} height="5" rx="2.5" {...B} />
      ))}
    </>
  )
}

function Cta({ y, label }: { y: number; label: string }) {
  return (
    <>
      <rect x="0" y={y} width="116" height="22" rx="7" fill="var(--accent)" />
      <text x="58" y={y + 14.5} textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">
        {label}
      </text>
    </>
  )
}

const SCREENS: { title: string; step: string; events: string[]; art: ReactNode }[] = [
  {
    title: '홈·지도',
    step: '랜딩',
    events: ['screen_view', 'view_promotion', 'select_promotion', 'search'],
    art: (
      <>
        <rect x="0" y="0" width="116" height="16" rx="8" {...B} />
        <rect x="0" y="24" width="116" height="56" rx="8" fill="var(--accent)" fillOpacity="0.18" />
        <rect x="8" y="58" width="50" height="6" rx="3" fill="var(--accent)" fillOpacity="0.6" />
        {[0, 1, 2].map((i) => (
          <rect key={i} x={i * 40} y="88" width="34" height="12" rx="6" {...B} />
        ))}
        <rect x="0" y="108" width="116" height="60" rx="8" {...B} />
        {[
          [30, 125],
          [70, 140],
          [92, 118],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="4" fill="var(--accent)" />
        ))}
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(0,${176 + i * 22})`}>
            <rect x="0" y="0" width="18" height="18" rx="4" {...B} />
            <Lines y={2} ws={[70, 44]} />
          </g>
        ))}
      </>
    ),
  },
  {
    title: '행사 상세',
    step: '행사 상세',
    events: ['screen_view', 'share'],
    art: (
      <>
        <rect x="0" y="0" width="116" height="84" rx="8" {...B} />
        <Lines y={94} ws={[96, 64]} />
        <rect x="0" y="120" width="116" height="1" fill={LINE} />
        <Lines y={130} ws={[80, 72, 88, 50]} />
        <rect x="0" y="176" width="116" height="28" rx="6" {...B} />
        <Cta y={214} label="신청하기" />
      </>
    ),
  },
  {
    title: '로그인·가입',
    step: '로그인·가입',
    events: ['login', 'sign_up'],
    art: (
      <>
        <circle cx="58" cy="30" r="16" fill="var(--accent)" fillOpacity="0.18" />
        <rect x="28" y="58" width="60" height="6" rx="3" {...B} />
        <rect x="0" y="84" width="116" height="20" rx="6" fill="none" stroke={LINE} />
        <rect x="0" y="110" width="116" height="20" rx="6" fill="none" stroke={LINE} />
        <Cta y={140} label="로그인" />
        <rect x="0" y="176" width="116" height="1" fill={LINE} />
        <rect x="0" y="188" width="116" height="20" rx="6" {...B} />
        <rect x="0" y="214" width="116" height="20" rx="6" {...B} />
      </>
    ),
  },
  {
    title: '신청 화면',
    step: '신청 화면',
    events: ['screen_view', 'apply_event'],
    art: (
      <>
        <Lines y={0} ws={[84, 52]} />
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0,${28 + i * 30})`}>
            <rect x="0" y="0" width="116" height="24" rx="6" fill="none" stroke={i === 1 ? 'var(--accent)' : LINE} />
            <circle cx="12" cy="12" r="4" fill={i === 1 ? 'var(--accent)' : 'none'} stroke={i === 1 ? 'var(--accent)' : LINE} />
            <rect x="24" y="9" width="50" height="6" rx="3" {...B} />
          </g>
        ))}
        <rect x="0" y="128" width="116" height="1" fill={LINE} />
        <rect x="0" y="138" width="40" height="6" rx="3" {...B} />
        <rect x="76" y="136" width="40" height="10" rx="3" fill="var(--ink)" fillOpacity="0.7" />
        <Cta y={214} label="결제하기" />
      </>
    ),
  },
  {
    title: '결제 완료',
    step: '결제',
    events: ['purchase', 'screen_view'],
    art: (
      <>
        <circle cx="58" cy="40" r="20" fill="var(--good)" fillOpacity="0.16" />
        <path d="M48 40l7 7 13-14" fill="none" stroke="var(--good)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="23" y="72" width="70" height="7" rx="3.5" {...B} />
        <rect x="0" y="96" width="116" height="84" rx="8" fill="none" stroke={LINE} strokeDasharray="3 3" />
        <rect x="10" y="108" width="70" height="6" rx="3" {...B} />
        <rect x="10" y="120" width="50" height="6" rx="3" {...B} />
        <rect x="10" y="146" width="96" height="22" rx="4" {...B} />
        <rect x="0" y="214" width="116" height="22" rx="7" {...B} />
      </>
    ),
  },
]

interface FlowNode {
  id: string
  label: string
  sub: string
  tone?: 'accent'
}

const SOURCES: FlowNode[] = [
  { id: 'log', label: '행동 로그', sub: 'GA4형 이벤트' },
  { id: 'db', label: '서비스 DB', sub: '야간 스냅샷' },
  { id: 'ad', label: '광고 리포트', sub: '일별 집행' },
]
const LAYERS: FlowNode[] = [
  { id: 'raw', label: 'raw', sub: '원천 그대로' },
  { id: 'staging', label: 'staging', sub: '정제·세션·사람×일' },
  { id: 'marts', label: 'marts', sub: '화면용 집계' },
]
const OUT: FlowNode[] = [
  { id: 'json', label: 'JSON 추출', sub: '마트 → 파일 1개' },
  { id: 'web', label: '정적 웹', sub: '이 대시보드', tone: 'accent' },
]
const OPS: FlowNode = { id: 'ops', label: 'ops', sub: '실행 기록·대조' }

function Box({ x, y, w, h, n }: { x: number; y: number; w: number; h: number; n: FlowNode }) {
  const accent = n.tone === 'accent'
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="8"
        fill={accent ? 'var(--accent)' : 'var(--surface)'}
        fillOpacity={accent ? 0.14 : 1}
        stroke={accent ? 'var(--accent)' : LINE}
      />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
        {n.label}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize="11" fill="var(--muted)">
        {n.sub}
      </text>
    </g>
  )
}

function Arrow({ d, dashed, m }: { d: string; dashed?: boolean; m: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--muted)"
      strokeWidth="1.25"
      strokeDasharray={dashed ? '4 4' : undefined}
      markerEnd={`url(#${m})`}
    />
  )
}

function Marker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
      </marker>
    </defs>
  )
}

function FlowWide() {
  const W = 118
  const H = 50
  const xs = [0, 170, 318, 466, 640, 788]
  const mid = 95
  return (
    <svg viewBox="-2 -2 910 250" className="hidden w-full md:block" role="img" aria-label="데이터 흐름">
      <Marker id="np-arrow-w" />
      <rect x={xs[1] - 16} y="-1" width={xs[3] + W - xs[1] + 32} height="246" rx="12" fill="var(--wash)" />
      <text x={xs[1] - 4} y="18" fontSize="11" fill="var(--muted)">
        BigQuery
      </text>
      {SOURCES.map((n, i) => (
        <g key={n.id}>
          <Box x={xs[0]} y={30 + i * 60} w={W} h={H} n={n} />
          <Arrow m="np-arrow-w" d={`M${xs[0] + W},${55 + i * 60} C${xs[0] + W + 26},${55 + i * 60} ${xs[1] - 26},${mid + 25} ${xs[1] - 2},${mid + 25}`} />
        </g>
      ))}
      {LAYERS.map((n, i) => (
        <g key={n.id}>
          <Box x={xs[1 + i]} y={mid} w={W} h={H} n={n} />
          {i < LAYERS.length - 1 && <Arrow m="np-arrow-w" d={`M${xs[1 + i] + W},${mid + 25} L${xs[2 + i] - 2},${mid + 25}`} />}
        </g>
      ))}
      <Box x={(xs[2] + xs[3]) / 2} y={184} w={W} h={H} n={OPS} />
      <Arrow m="np-arrow-w" d={`M${xs[2] + W / 2},${mid + H} L${xs[2] + W / 2},${184 + H / 2} L${(xs[2] + xs[3]) / 2 - 2},${184 + H / 2}`} dashed />
      <Arrow m="np-arrow-w" d={`M${xs[3] + W / 2},${mid + H} L${xs[3] + W / 2},${184 + H / 2} L${(xs[2] + xs[3]) / 2 + W + 2},${184 + H / 2}`} dashed />
      {OUT.map((n, i) => (
        <Box key={n.id} x={xs[4 + i]} y={mid} w={W} h={H} n={n} />
      ))}
      <Arrow m="np-arrow-w" d={`M${xs[3] + W},${mid + 25} L${xs[4] - 2},${mid + 25}`} />
      <Arrow m="np-arrow-w" d={`M${xs[4] + W},${mid + 25} L${xs[5] - 2},${mid + 25}`} />
    </svg>
  )
}

function FlowTall() {
  const W = 150
  const H = 46
  const cx = 120
  const x = cx - W / 2
  const ys = [0, 60, 120]
  const chain = [...LAYERS, ...OUT]
  const top = 200
  return (
    <svg viewBox="0 0 340 600" className="mx-auto w-full max-w-[360px] md:hidden" role="img" aria-label="데이터 흐름">
      <Marker id="np-arrow-t" />
      {SOURCES.map((n, i) => (
        <g key={n.id}>
          <Box x={i * 114} y={ys[0]} w={104} h={H} n={n} />
          <Arrow m="np-arrow-t" d={`M${i * 114 + 52},${H} C${i * 114 + 52},${H + 40} ${cx},${top - 50} ${cx},${top - 2}`} />
        </g>
      ))}
      <rect x={x - 14} y={top - 14} width={W + 150} height={3 * 70 + 6} rx="12" fill="var(--wash)" />
      <text x={x + W + 118} y={top + 2} textAnchor="end" fontSize="11" fill="var(--muted)">
        BigQuery
      </text>
      {chain.map((n, i) => (
        <g key={n.id}>
          <Box x={x} y={top + i * 70} w={W} h={H} n={n} />
          {i < chain.length - 1 && <Arrow m="np-arrow-t" d={`M${cx},${top + i * 70 + H} L${cx},${top + (i + 1) * 70 - 2}`} />}
        </g>
      ))}
      <Box x={x + W + 22} y={top + 105} w={100} h={H} n={OPS} />
      <Arrow m="np-arrow-t" d={`M${x + W},${top + 70 + H / 2} L${x + W + 72},${top + 70 + H / 2} L${x + W + 72},${top + 103}`} dashed />
      <Arrow m="np-arrow-t" d={`M${x + W},${top + 140 + H / 2} L${x + W + 20},${top + 140 + H / 2}`} dashed />
    </svg>
  )
}

const DOCS: { label: string; sub: string; href: string }[] = [
  { label: '데이터 아키텍처', sub: '층·표·그레인·파이프라인', href: `${REPO}/blob/main/docs/architecture.md` },
  { label: '지표 정의', sub: '산식·단위·분모', href: `${REPO}/blob/main/docs/metrics.md` },
  { label: '대시보드 설계', sub: '탭·필터·데이터 계약', href: `${REPO}/blob/main/docs/dashboard.md` },
  { label: '저장소', sub: '생성기·SQL·대시보드 코드', href: REPO },
]

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
        <span className="tnum text-xs font-medium text-muted">{String(n).padStart(2, '0')}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export default function About() {
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-12 px-4 pb-20 pt-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">
          나이트라이프 플랫폼의 로그를
          <br className="hidden sm:block" /> 퍼널·코호트·광고 지표로
        </h2>
        <p className="max-w-[640px] text-[15px] leading-relaxed text-ink2">
          가상 서비스 NightPulse의 행동 로그·서비스 DB·광고 리포트를 BigQuery 네 층으로 정리하고, 마트에서 뽑은 집계로 이
          대시보드를 만든 데이터 분석 포트폴리오입니다.
        </p>
        <div>
          <span className="rounded-md bg-wash px-2 py-1 text-xs font-medium text-ink2">모든 수치는 합성 데이터</span>
        </div>
      </div>

      <Section n={1} title="가상 프로덕트">
        <p className="max-w-[720px] text-[14px] leading-relaxed text-ink2">
          NightPulse는 클럽·바·라운지 같은 공간과 그곳에서 열리는 행사를 찾아보고, 신청하고, 결제하는 서비스입니다. 탐색은
          비회원도 할 수 있지만 신청부터는 로그인이 필요합니다. iOS·Android 앱과 웹으로 들어오고, 일부 방문은 SNS 광고
          캠페인에서 옵니다. 분석의 질문은 두 가지입니다 — 어느 단계에서 사람이 빠지는가, 어떤 유입이 결제까지 이어지는가.
        </p>
      </Section>

      <Section n={2} title="핵심 퍼널 5화면">
        <ol className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {SCREENS.map((sc, i) => (
            <li key={sc.title} className="flex min-w-0 flex-col items-center gap-3">
              <div className="flex w-full items-baseline justify-center gap-1.5 text-[13px]">
                <span className="tnum text-xs text-muted">{i + 1}</span>
                <span className="font-medium text-ink">{sc.title}</span>
              </div>
              <Phone>{sc.art}</Phone>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-muted">퍼널 단계 · {sc.step}</span>
                <div className="flex flex-wrap justify-center gap-1">
                  {sc.events.map((e) => (
                    <code key={e} className="rounded bg-wash px-1.5 py-0.5 font-mono text-[11px] text-ink2">
                      {e}
                    </code>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n={3} title="데이터 흐름">
        <div className="card p-4 sm:p-6">
          <FlowWide />
          <FlowTall />
        </div>
      </Section>

      <Section n={4} title="문서">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DOCS.map((d) => (
            <li key={d.label}>
              <a
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="card flex h-full flex-col gap-1 px-4 py-3 transition-shadow hover:shadow-[0_0_0_1px_var(--axis)]"
              >
                <span className="flex items-center justify-between text-[14px] font-medium text-ink">
                  {d.label}
                  <span aria-hidden className="text-muted">
                    ↗
                  </span>
                </span>
                <span className="text-xs text-muted">{d.sub}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}
