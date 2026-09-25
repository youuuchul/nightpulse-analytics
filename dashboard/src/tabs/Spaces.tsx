import { useMemo } from 'react'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import SeoulMap, { PARTNER_COLOR } from '../components/SeoulMap'
import { Card, Legend, Segmented, Select, Tile, TileRow } from '../components/ui'
import { addDays, md, mondayOf } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { PLAN_LABEL, S } from '../lib/labels'
import type { DailyVenueRegistry, VenueRegistry } from '../lib/types'
import { delta, ptDelta, type TabProps, vsLabel } from './common'

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

  const regionCols: Col<RegionRow>[] = [
    { key: 'region', label: '상권', value: (r) => r.region, render: (r) => <span className="text-ink">{r.region}</span> },
    { key: 'registered', label: '등록', value: (r) => r.registered, render: (r) => num(r.registered), num: true },
    { key: 'partners', label: '파트너', value: (r) => r.partners, render: (r) => num(r.partners), num: true },
    {
      key: 'share',
      label: '파트너 비중',
      value: (r) => ratio(r.partners, r.registered),
      render: (r) => pct(ratio(r.partners, r.registered)),
      num: true,
    },
    { key: 'amount', label: '티켓 매출 · 365일', value: (r) => r.amount, render: (r) => won(r.amount), num: true },
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
    { key: 'genre', label: '장르', value: (r) => r.genre },
    { key: 'plan', label: '플랜', value: (r) => PLAN_LABEL[r.plan ?? ''] ?? r.plan },
    { key: 'contract_started_at', label: '계약일', value: (r) => r.contract_started_at, render: (r) => <span className="tnum">{r.contract_started_at ?? '—'}</span> },
    { key: 'events_365d', label: '행사 · 365일', value: (r) => r.events_365d, render: (r) => num(r.events_365d), num: true },
    {
      key: 'ticket_amount_365d',
      label: '티켓 매출 · 365일',
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
          label="파트너 비중"
          value={pct(share)}
          sub={`등록 ${num(cur?.registered)}곳 중`}
          delta={ptDelta(data, range, share, prev ? ratio(prev.partners, prev.registered) : null)}
        />
        <Tile metricId="P03" label="신규 계약" value={num(f.fresh)} unit="건" delta={delta(data, range, f.fresh, fp.fresh)} />
        <Tile metricId="P04" label="계약 해지" value={num(f.churn)} unit="건" delta={delta(data, range, f.churn, fp.churn, false)} />
        <Tile
          metricId="P05"
          label="B2B MRR"
          value={won(cur?.mrr)}
          unit="원"
          delta={delta(data, range, cur?.mrr ?? null, prev?.mrr ?? null)}
        />
      </TileRow>

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
                options={[{ value: 'all', label: '장르 전체' }, ...genres.map((g) => ({ value: g, label: g }))]}
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
