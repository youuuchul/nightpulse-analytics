import { useMemo } from 'react'
import { bucketed, groupSum, inRange, segFilter, sum, uniqueByMasks } from '../lib/agg'
import { num, pct, ratio, won } from '../lib/format'
import { PRICE_TIER, S } from '../lib/labels'
import { F } from '../lib/persons'
import { ready, useTable, waitOf } from '../lib/source'
import { Funnel, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, hourTip, hourX, ptDelta, type TabProps, weekTip } from './common'
import Venues from './Venues'
import Revenue from './Revenue'
import type { DailyEvent } from '../lib/types'

function Flow({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const keys = ['detail_viewers', 'apply_viewers', 'applies', 'payers', 'pay_count', 'pay_amount', 'cancels'] as const
  const cur = sum(inRange(m, range.from, range.to), [...keys])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), [...keys])
  const pdL = useTable(data, 'person_day')
  const hourL = useTable(data, 'hourly_metrics', range.oneDay)
  const pd = ready(pdL)
  const pw = waitOf(pdL)
  const people = (from: string, to: string, t: typeof cur) => {
    if (!pd) return { detail: t.detail_viewers, apply_view: t.apply_viewers, paid: t.payers, payers: t.payers }
    const d = F.event_detail
    const masks = [d, d | F.apply_view, d | F.apply_view | F.paid, F.paid]
    const u = uniqueByMasks(pd, from, to, masks, { ch: s.ch, pf: s.pf, ms: s.ms }).get('')
    return { detail: u?.[0] ?? 0, apply_view: u?.[1] ?? 0, paid: u?.[2] ?? 0, payers: u?.[3] ?? 0 }
  }
  const pCur = useMemo(() => people(range.from, range.to, cur), [data, pd, m, range.from, range.to])
  const pPrev = useMemo(() => people(range.prevFrom, range.prevTo, prev), [data, pd, m, range.prevFrom, range.prevTo])
  const arppu = ratio(cur.pay_amount, pCur.payers)
  const cancel = ratio(cur.cancels, cur.applies)

  const trend = bucketed(inRange(m, range.from, range.to), ['applies', 'pay_count'], range)
  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, applies: 0, pay_count: 0 }))
    for (const r of ready(hourL) ?? [])
      if (r.kst_date === range.from && seg(r)) {
        out[r.kst_hour].applies += r.applies
        out[r.kst_hour].pay_count += r.pay_count
      }
    return out
  }, [hourL, range.from, s.ch, s.pf, s.ms])

  const series = [
    { key: 'applies', label: '신청', color: S(1) },
    { key: 'pay_count', label: '결제', color: S(2) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-5">
        <Tile metricId="C11" label="신청" value={num(cur.applies)} unit="건" delta={delta(data, range, cur.applies, prev.applies)} />
        <Tile metricId="C12" label="결제" value={num(cur.pay_count)} unit="건" delta={delta(data, range, cur.pay_count, prev.pay_count)} />
        <Tile metricId="C13" label="결제 금액" value={won(cur.pay_amount)} unit="원" delta={delta(data, range, cur.pay_amount, prev.pay_amount)} />
        <Tile
          metricId="C07"
          label="결제자당 금액"
          value={won(arppu)}
          unit="원"
          sub={`결제자 ${num(pCur.payers)}명`}
          delta={delta(data, range, arppu, ratio(prev.pay_amount, pPrev.payers))}
          wait={pw}
        />
        <Tile
          metricId="C06"
          label="취소율"
          value={pct(cancel)}
          sub={`신청 ${num(cur.applies)}건 중`}
          delta={ptDelta(data, range, cancel, ratio(prev.cancels, prev.applies), false)}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Card
          title={range.oneDay ? '시간별 신청·결제' : '신청·결제 추이'}
          meta={range.oneDay ? range.from : `${grain(trend.weekly)} · 건`}
          right={<Legend items={series.map((x) => ({ ...x, kind: range.oneDay ? 'box' : 'line' }))} />}
          wait={range.oneDay ? waitOf(hourL) : null}
        >
          {range.oneDay ? (
            <TimeChart data={hourly} xKey="hour" xFormat={hourX} tipTitle={hourTip} kind="bar" series={series} height={240} />
          ) : (
            <TimeChart data={trend.rows} kind="line" tipTitle={weekTip(trend.weekly)} series={series} height={240} />
          )}
        </Card>
        <Card title="결제 퍼널" metricId="C14" wait={pw}>
          <Funnel
            steps={[
              { label: '행사 상세', value: pCur.detail },
              { label: '신청 화면', value: pCur.apply_view },
              { label: '결제', value: pCur.paid },
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

const NO_EVENTS: DailyEvent[] = []

interface EventRow {
  event_id: number
  event_name: string
  venue_name: string
  event_type: string
  price_tier: string
  detail_viewers: number
  applies: number
  pay_count: number
  pay_amount: number
  cancels: number
}

function EventList({ data, s, range }: TabProps) {
  const evL = useTable(data, 'daily_event')
  const ev = ready(evL) ?? NO_EVENTS
  const ew = waitOf(evL)
  const rows = useMemo(
    () =>
      inRange(ev, range.from, range.to).filter(
        (r) => (s.et === 'all' || r.event_type === s.et) && (s.pt === 'all' || r.price_tier === s.pt),
      ),
    [ev, range.from, range.to, s.et, s.pt],
  )
  const keys = ['detail_viewers', 'applies', 'pay_count', 'pay_amount', 'cancels'] as const
  const tot = sum(rows, [...keys])
  const g = groupSum(rows, (r) => String(r.event_id), [...keys])
  const meta = useMemo(() => new Map(ev.map((r) => [String(r.event_id), r])), [ev])
  const list: EventRow[] = [...g.entries()].map(([id, v]) => {
    const x = meta.get(id)!
    return {
      event_id: x.event_id,
      event_name: x.event_name,
      venue_name: x.venue_name,
      event_type: x.event_type,
      price_tier: x.price_tier,
      ...v,
    }
  })
  const trend = bucketed(rows, ['pay_amount'], range)

  const cols: Col<EventRow>[] = [
    {
      key: 'event_name',
      label: '행사',
      value: (r) => r.event_name,
      render: (r) => (
        <div className="min-w-0 max-w-[280px]">
          <div className="truncate text-ink">{r.event_name}</div>
          <div className="truncate text-xs text-muted">{r.venue_name}</div>
        </div>
      ),
    },
    { key: 'event_type', label: '유형', value: (r) => r.event_type },
    { key: 'price_tier', label: '가격대', value: (r) => PRICE_TIER[r.price_tier] ?? r.price_tier },
    { key: 'detail_viewers', label: '조회 사람(일 합)', value: (r) => r.detail_viewers, render: (r) => num(r.detail_viewers), num: true },
    { key: 'applies', label: '신청', value: (r) => r.applies, render: (r) => num(r.applies), num: true },
    {
      key: 'rate',
      label: '조회 대비 신청',
      value: (r) => ratio(r.applies, r.detail_viewers),
      render: (r) => pct(ratio(r.applies, r.detail_viewers)),
      num: true,
    },
    { key: 'pay_count', label: '결제', value: (r) => r.pay_count, render: (r) => num(r.pay_count), num: true },
    { key: 'pay_amount', label: '결제 금액', value: (r) => r.pay_amount, render: (r) => won(r.pay_amount), num: true },
    { key: 'cancels', label: '취소', value: (r) => r.cancels, render: (r) => num(r.cancels), num: true },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-4">
        <Tile metricId="E07" label="조회된 행사" value={num(list.length)} unit="건" wait={ew} />
        <Tile metricId="C11" label="신청" value={num(tot.applies)} unit="건" wait={ew} />
        <Tile metricId="C13" label="결제 금액" value={won(tot.pay_amount)} unit="원" sub={`결제 ${num(tot.pay_count)}건`} wait={ew} />
        <Tile metricId="C06" label="취소율" value={pct(ratio(tot.cancels, tot.applies))} sub={`신청 ${num(tot.applies)}건 중`} wait={ew} />
      </TileRow>
      {!range.oneDay && (
        <Card title="결제 금액 추이" meta={`${grain(trend.weekly)} · 원`} wait={ew} waitH={220}>
          <TimeChart
            data={trend.rows}
            kind="bar"
            tipTitle={weekTip(trend.weekly)}
            valueFormat={won}
            series={[{ key: 'pay_amount', label: '결제 금액', color: S(1) }]}
            height={220}
          />
        </Card>
      )}
      <Card title="행사별 성과" metricId="E04" meta={`${list.length}건`} wait={ew}>
        <DataTable cols={cols} rows={list} sortKey="applies" rowKey={(r) => String(r.event_id)} />
      </Card>
    </div>
  )
}

export default function Events(p: TabProps) {
  if (p.s.view === 'event') return <EventList {...p} />
  if (p.s.view === 'venue') return <Venues {...p} />
  if (p.s.view === 'revenue') return <Revenue {...p} />
  return <Flow {...p} />
}
