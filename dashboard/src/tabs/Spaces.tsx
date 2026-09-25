import { useMemo, useState } from 'react'
import { Heatmap, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import SeoulMap, { PARTNER_COLOR } from '../components/SeoulMap'
import { Card, type Delta, Legend, Segmented, Select, Tile, TileRow } from '../components/ui'
import { cohortHeat, monthEnd } from '../lib/cohort'
import { addDays, md, mondayOf, ym } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { FEE_TIERS, PLAN_LABEL, S } from '../lib/labels'
import type { Data, DailyVenueRegistry, MonthlyContract, VenueRegistry } from '../lib/types'
import { delta, ptDelta, type TabProps, vsLabel } from './common'

const PLAN_SERIES = FEE_TIERS.filter((t) => t.key !== 'none').map((t) => ({ key: t.key, label: t.label, color: t.color }))

interface ContractSum {
  months: string[]
  bom: number
  churned: number
  mrrBom: number
  churn: number
  contraction: number
  expansion: number
  upgrades: number
  downgrades: number
  last: MonthlyContract | undefined
  burden: number | null
  partnerGmv: number
}

/**
 * 끝난 달(말일 ≤ 기준일) 중 기간과 겹치는 달. 없으면 기간 끝 이전의 마지막 끝난 달 하나.
 * 비율은 달마다 나누지 않고 분자·분모를 각각 더한 뒤 나눈다(월 평균).
 */
function contractMonths(data: Data, from: string, to: string): string[] {
  const done = [...new Set((data.monthly_contract ?? []).map((r) => r.month))]
    .filter((m) => monthEnd(m) <= data.meta.to_date)
    .sort()
  const hit = done.filter((m) => `${m}-01` <= to && monthEnd(m) >= from)
  if (hit.length) return hit
  const before = done.filter((m) => monthEnd(m) <= to)
  return before.length ? [before[before.length - 1]] : []
}

function contractSum(data: Data, months: string[]): ContractSum {
  const set = new Set(months)
  const z: ContractSum = {
    months,
    bom: 0,
    churned: 0,
    mrrBom: 0,
    churn: 0,
    contraction: 0,
    expansion: 0,
    upgrades: 0,
    downgrades: 0,
    last: undefined,
    burden: null,
    partnerGmv: 0,
  }
  for (const r of data.monthly_contract ?? []) {
    if (r.plan !== 'all' || !set.has(r.month)) continue
    z.bom += r.contracts_bom
    z.churned += r.churned_contracts
    z.mrrBom += r.mrr_bom
    z.churn += r.mrr_churn
    z.contraction += r.mrr_contraction
    z.expansion += r.mrr_expansion
    z.upgrades += r.upgrades
    z.downgrades += r.downgrades
    if (!z.last || r.month > z.last.month) z.last = r
  }
  if (months.length && data.daily_revenue) {
    const a = `${months[0]}-01`
    const b = monthEnd(months[months.length - 1])
    let cost = 0
    for (const r of data.daily_revenue) {
      if (r.kst_date < a || r.kst_date > b) continue
      if (r.kind === 'partner_plan') cost += r.net_amount
      else if (r.kind === 'ticket' && (r.fee_tier === 'basic' || r.fee_tier === 'pro')) {
        cost += r.net_amount
        z.partnerGmv += r.gmv_amount ?? 0
      }
    }
    z.burden = ratio(cost, z.partnerGmv)
  }
  return z
}

const retention = (z: ContractSum, withExpansion: boolean) =>
  ratio(z.mrrBom - z.churn - z.contraction + (withExpansion ? z.expansion : 0), z.mrrBom)

function monthSpan(ms: string[]): string {
  if (!ms.length) return ''
  return ms.length === 1 ? ym(ms[0]) : `${ym(ms[0])}~${ym(ms[ms.length - 1])}`
}

interface Snap {
  registered: number
  partners: number
  mrr: number
}

/** 날짜 d 이하 마지막 날의 *_total·MRR(상권 합). 없으면 null. */
function snapAt(rows: DailyVenueRegistry[], d: string): Snap | null {
  let last = ''
  for (const r of rows) if (r.kst_date <= d && r.kst_date > last) last = r.kst_date
  if (!last) return null
  const z: Snap = { registered: 0, partners: 0, mrr: 0 }
  for (const r of rows)
    if (r.kst_date === last) {
      z.registered += r.registered_total
      z.partners += r.partner_total
      z.mrr += r.mrr_basic + r.mrr_pro
    }
  return z
}

function flows(rows: DailyVenueRegistry[], from: string, to: string) {
  let fresh = 0
  let churn = 0
  let reg = 0
  for (const r of rows)
    if (r.kst_date >= from && r.kst_date <= to) {
      fresh += r.new_contracts
      churn += r.churned_contracts
      reg += r.new_registered
    }
  return { fresh, churn, reg }
}

interface RegionRow {
  region: string
  registered: number
  partners: number
  amount: number
}

export default function Spaces({ data, s, set, range }: TabProps) {
  const [mixBy, setMixBy] = useState<'count' | 'mrr'>('count')
  const [cohortBy, setCohortBy] = useState<'count' | 'mrr'>('count')
  const contract = useMemo(() => {
    const months = contractMonths(data, range.from, range.to)
    const all = [...new Set((data.monthly_contract ?? []).map((r) => r.month))]
      .filter((m) => monthEnd(m) <= data.meta.to_date)
      .sort()
    const i = months.length ? all.indexOf(months[0]) : -1
    const prevMonths = i >= months.length ? all.slice(i - months.length, i) : []
    return { cur: contractSum(data, months), prev: prevMonths.length ? contractSum(data, prevMonths) : null }
  }, [data, range.from, range.to])
  const mix = useMemo(() => {
    const until = range.to.slice(0, 7)
    const by = new Map<string, { x: string; title: string; basic: number; pro: number }>()
    for (const r of data.monthly_contract ?? []) {
      if (r.plan === 'all' || r.month > until) continue
      const z = by.get(r.month) ?? { x: ym(r.month), title: r.month, basic: 0, pro: 0 }
      z[r.plan] = mixBy === 'count' ? r.contracts_eom : r.mrr_eom
      by.set(r.month, z)
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([, v]) => v)
  }, [data, range.to, mixBy])
  const heat = useMemo(
    () =>
      cohortHeat(
        data.contract_cohort ?? [],
        range.to,
        (r, f) => (cohortBy === 'count' ? ratio(r.retained, f.cohort_size) : ratio(r.mrr_retained, f.mrr_retained)),
        (f) => num(f.cohort_size),
      ),
    [data, range.to, cohortBy],
  )

  const reg = useMemo(
    () => (data.daily_venue_registry ?? []).filter((r) => s.sr === 'all' || r.region === s.sr),
    [data, s.sr],
  )
  const registered = useMemo(
    () => (data.venue_registry ?? []).filter((v) => s.sr === 'all' || v.region === s.sr),
    [data, s.sr],
  )
  const venues = useMemo(() => registered.filter((v) => v.status !== 'closed'), [registered])
  const mapVenues = useMemo(
    () =>
      venues.filter(
        (v) =>
          (s.sg === 'all' || v.genre === s.sg) &&
          (s.sp === 'all' || (s.sp === 'partner' ? v.is_partner : !v.is_partner)),
      ),
    [venues, s.sg, s.sp],
  )

  const trend = useMemo(() => {
    const weekly = range.days > 31
    const byDay = new Map<string, { date: string; registered: number; partners: number; fresh: number; churn: number }>()
    for (const r of reg) {
      if (r.kst_date < range.from || r.kst_date > range.to) continue
      const z = byDay.get(r.kst_date) ?? { date: r.kst_date, registered: 0, partners: 0, fresh: 0, churn: 0 }
      z.registered += r.registered_total
      z.partners += r.partner_total
      z.fresh += r.new_contracts
      z.churn += r.churned_contracts
      byDay.set(r.kst_date, z)
    }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
    if (!weekly) return { weekly, rows: days }
    const wk = new Map<string, { date: string; registered: number; partners: number; fresh: number; churn: number }>()
    for (const d of days) {
      const k = mondayOf(d.date)
      const z = wk.get(k) ?? { date: k, registered: 0, partners: 0, fresh: 0, churn: 0 }
      z.registered = d.registered
      z.partners = d.partners
      z.fresh += d.fresh
      z.churn += d.churn
      wk.set(k, z)
    }
    return { weekly, rows: [...wk.values()] }
  }, [reg, range.from, range.to, range.days])

  const regions = useMemo(() => {
    const m = new Map<string, RegionRow>()
    for (const v of registered) {
      const z = m.get(v.region) ?? { region: v.region, registered: 0, partners: 0, amount: 0 }
      z.registered++
      z.partners += v.is_partner ? 1 : 0
      z.amount += v.ticket_amount_365d
      m.set(v.region, z)
    }
    return [...m.values()]
  }, [registered])

  if (!data.daily_venue_registry && !data.venue_registry)
    return (
      <Card title="공간">
        <div className="text-sm text-muted">데이터 없음</div>
      </Card>
    )

  const cur = snapAt(reg, range.to)
  const prev = snapAt(reg, range.prevTo)
  const f = flows(reg, range.from, range.to)
  const fp = flows(reg, range.prevFrom, range.prevTo)
  const share = cur ? ratio(cur.partners, cur.registered) : null
  const asOf = data.venue_registry?.[0]?.as_of_date ?? data.meta.to_date
  const genres = [...new Set((data.venue_registry ?? []).map((v) => v.genre))].sort((a, b) => a.localeCompare(b, 'ko'))
  const partners = venues.filter((v) => v.is_partner)
  const weekTitle = (d: string | number) => (trend.weekly ? `${md(String(d))}~${md(addDays(String(d), 6))}` : String(d))

  const c = contract.cur
  const cp = contract.prev
  const showContract = s.sr === 'all' && !!data.monthly_contract?.length && c.months.length > 0
  const churnRate = ratio(c.churned, c.bom)
  const revChurn = ratio(c.churn + c.contraction, c.mrrBom)
  const contractTitle = `파트너 계약 · 월 기준 ${monthSpan(c.months)} · ${cp ? `직전 ${c.months.length}개월 대비` : '전기 없음'}`
  const cd = (v: number | null, p: number | null, points: boolean, goodUp: boolean): Delta | undefined => {
    if (!cp) return undefined
    const value = v == null || p == null ? null : points ? v - p : p !== 0 ? v / p - 1 : null
    return { value, goodUp, points }
  }

  const regionCols: Col<RegionRow>[] = [
    { key: 'region', label: '상권', value: (r) => r.region, render: (r) => <span className="text-ink">{r.region}</span> },
    { key: 'registered', label: '등록', value: (r) => r.registered, render: (r) => num(r.registered), num: true },
    { key: 'partners', label: '파트너', value: (r) => r.partners, render: (r) => num(r.partners), num: true },
    {
      key: 'share',
      label: '파트너 전환율',
      value: (r) => ratio(r.partners, r.registered),
      render: (r) => pct(ratio(r.partners, r.registered)),
      num: true,
    },
    { key: 'amount', label: '티켓 결제액 · 365일', value: (r) => r.amount, render: (r) => won(r.amount), num: true },
  ]
  const partnerCols: Col<VenueRegistry>[] = [
    {
      key: 'name',
      label: '상호',
      value: (r) => r.name,
      render: (r) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="truncate text-ink">{r.name}</div>
          <div className="truncate text-xs text-muted">{r.venue_type}</div>
        </div>
      ),
    },
    { key: 'region', label: '상권', value: (r) => r.region },
    { key: 'genre', label: '무드', value: (r) => r.genre },
    { key: 'plan', label: '플랜', value: (r) => PLAN_LABEL[r.plan ?? ''] ?? r.plan },
    { key: 'contract_started_at', label: '계약일', value: (r) => r.contract_started_at, render: (r) => <span className="tnum">{r.contract_started_at ?? '—'}</span> },
    { key: 'events_365d', label: '행사 · 365일', value: (r) => r.events_365d, render: (r) => num(r.events_365d), num: true },
    {
      key: 'ticket_amount_365d',
      label: '티켓 결제액 · 365일',
      value: (r) => r.ticket_amount_365d,
      render: (r) => won(r.ticket_amount_365d),
      num: true,
    },
    { key: 'detail_viewers_28d', label: '28일 조회', value: (r) => r.detail_viewers_28d, render: (r) => num(r.detail_viewers_28d), num: true },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow title={`공간 · ${vsLabel(data, range)}`}>
        <Tile
          metricId="P01"
          label="등록 공간"
          value={num(cur?.registered)}
          unit="곳"
          sub={`기간 신규 ${num(f.reg)}곳`}
          delta={delta(data, range, cur?.registered ?? null, prev?.registered ?? null)}
        />
        <Tile
          metricId="P02"
          label="파트너 공간"
          value={num(cur?.partners)}
          unit="곳"
          delta={delta(data, range, cur?.partners ?? null, prev?.partners ?? null)}
        />
        <Tile
          metricId="P06"
          label="파트너 전환율"
          value={pct(share)}
          sub={`등록 ${num(cur?.registered)}곳 중`}
          delta={ptDelta(data, range, share, prev ? ratio(prev.partners, prev.registered) : null)}
        />
        <Tile metricId="P03" label="신규 계약" value={num(f.fresh)} unit="건" delta={delta(data, range, f.fresh, fp.fresh)} />
        <Tile metricId="P04" label="계약 해지" value={num(f.churn)} unit="건" delta={delta(data, range, f.churn, fp.churn, false)} />
        <Tile
          metricId="P05"
          label="파트너 플랜 MRR"
          value={won(cur?.mrr)}
          unit="원"
          delta={delta(data, range, cur?.mrr ?? null, prev?.mrr ?? null)}
        />
      </TileRow>

      {showContract && (
        <TileRow cols="lg:grid-cols-5" title={contractTitle}>
          <Tile
            metricId="P11"
            label="계약 월 해지율"
            value={pct(churnRate)}
            sub={`매출 해지율 ${pct(revChurn)}`}
            delta={cd(churnRate, cp ? ratio(cp.churned, cp.bom) : null, true, false)}
          />
          <Tile
            metricId="P10"
            label="ARPA"
            value={won(c.last?.arpa)}
            unit="원"
            sub={c.last ? `${ym(c.last.month)} 말 · 계약 ${num(c.last.contracts_eom)}` : undefined}
            delta={cd(c.last?.arpa ?? null, cp?.last?.arpa ?? null, false, true)}
          />
          <Tile
            metricId="P13"
            label="GRR"
            value={pct(retention(c, false))}
            sub="해지·다운그레이드 반영"
            delta={cd(retention(c, false), cp ? retention(cp, false) : null, true, true)}
          />
          <Tile
            metricId="P14"
            label="NRR"
            value={pct(retention(c, true))}
            sub={`업그레이드 ${num(c.upgrades)} · 다운그레이드 ${num(c.downgrades)}`}
            delta={cd(retention(c, true), cp ? retention(cp, true) : null, true, true)}
          />
          <Tile
            metricId="P16"
            label="파트너 부담률"
            value={pct(c.burden)}
            sub={`파트너 거래액 ${won(c.partnerGmv)}원 대비`}
            delta={cd(c.burden, cp?.burden ?? null, true, false)}
          />
        </TileRow>
      )}

      {!range.oneDay && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="등록 공간" metricId="P01" meta={`${trend.weekly ? '주별 · 주 마지막 날' : '일별'} · 곳`}>
            <TimeChart
              data={trend.rows}
              kind="line"
              tipTitle={weekTitle}
              series={[{ key: 'registered', label: '등록 공간', color: S(1) }]}
              height={200}
            />
          </Card>
          <Card title="파트너 공간" metricId="P02" meta={`${trend.weekly ? '주별 · 주 마지막 날' : '일별'} · 곳`}>
            <TimeChart
              data={trend.rows}
              kind="line"
              tipTitle={weekTitle}
              series={[{ key: 'partners', label: '파트너 공간', color: PARTNER_COLOR }]}
              height={200}
            />
          </Card>
          <Card
            title="신규 계약 · 해지"
            metricId="P03"
            meta={`${trend.weekly ? '주별' : '일별'} · 건`}
            right={
              <Legend
                items={[
                  { label: '신규', color: PARTNER_COLOR },
                  { label: '해지', color: 'var(--exit)' },
                ]}
              />
            }
          >
            <TimeChart
              data={trend.rows}
              kind="bar"
              tipTitle={weekTitle}
              series={[
                { key: 'fresh', label: '신규', color: PARTNER_COLOR },
                { key: 'churn', label: '해지', color: 'var(--exit)' },
              ]}
              height={200}
            />
          </Card>
        </div>
      )}

      {showContract && (
        <div className="grid gap-4 xl:grid-cols-[5fr_7fr]">
          <Card
            title="플랜별 구성"
            meta={`월말 · ${mixBy === 'count' ? '계약' : '원'}`}
            right={
              <div className="flex flex-wrap items-center gap-3">
                <Legend items={PLAN_SERIES} />
                <Segmented
                  value={mixBy}
                  onChange={setMixBy}
                  options={[
                    { value: 'count', label: '계약' },
                    { value: 'mrr', label: 'MRR' },
                  ]}
                />
              </div>
            }
          >
            <TimeChart
              data={mix}
              xKey="x"
              xFormat={(v) => String(v)}
              tipTitle={(x) => mix.find((r) => r.x === x)?.title ?? String(x)}
              kind="stack"
              valueFormat={mixBy === 'count' ? num : won}
              series={PLAN_SERIES}
              height={240}
            />
          </Card>
          <Card
            title="계약 코호트 유지율"
            metricId="P15"
            meta={`계약 시작 월 · ${md(range.to)}까지 끝난 달 · %`}
            right={
              <Segmented
                value={cohortBy}
                onChange={setCohortBy}
                options={[
                  { value: 'count', label: '계약' },
                  { value: 'mrr', label: 'MRR' },
                ]}
              />
            }
          >
            {heat.rows.length ? (
              <Heatmap
                cols={heat.cols}
                rows={heat.rows}
                head
                headLabel="계약"
                format={(v) => `${Math.round(v * 100)}`}
                rowLabelWidth={48}
                tip={(r, col, v) => `${heat.rows[r].label} 코호트 M${col + 1} · ${pct(v)}`}
              />
            ) : (
              <div className="text-sm text-muted">데이터 없음</div>
            )}
          </Card>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card
          title="서울 분포"
          metricId="P07"
          meta={`${md(asOf)} 기준 · 영업 중 ${num(mapVenues.length)}곳 · 점 크기 28일 조회`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={s.sg}
                width="w-36"
                onChange={(sg) => set({ sg })}
                options={[{ value: 'all', label: '무드 전체' }, ...genres.map((g) => ({ value: g, label: g }))]}
              />
              <Segmented
                value={s.sp}
                onChange={(sp) => set({ sp })}
                options={[
                  { value: 'all', label: '전체' },
                  { value: 'partner', label: '파트너' },
                  { value: 'other', label: '비파트너' },
                ]}
              />
            </div>
          }
        >
          {data.venue_registry ? (
            <>
              <SeoulMap venues={mapVenues} />
              <div className="mt-2">
                <Legend
                  items={[
                    { label: '파트너', color: PARTNER_COLOR },
                    { label: '비파트너', color: 'var(--muted)' },
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">데이터 없음</div>
          )}
        </Card>
        <Card title="상권별" metricId="P06" meta={`${md(asOf)} 기준`}>
          {data.venue_registry ? (
            <DataTable
              cols={regionCols}
              rows={regions}
              sortKey="registered"
              rowKey={(r) => r.region}
              limit={12}
              minW="min-w-[440px]"
            />
          ) : (
            <div className="text-sm text-muted">데이터 없음</div>
          )}
        </Card>
      </div>

      <Card title="파트너 공간" metricId="P09" meta={`${num(partners.length)}곳`}>
        {data.venue_registry ? (
          <DataTable cols={partnerCols} rows={partners} sortKey="ticket_amount_365d" rowKey={(r) => String(r.venue_id)} limit={50} minW="min-w-[880px]" />
        ) : (
          <div className="text-sm text-muted">데이터 없음</div>
        )}
      </Card>
    </div>
  )
}
