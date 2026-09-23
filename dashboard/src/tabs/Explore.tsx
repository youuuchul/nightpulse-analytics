import { useMemo } from 'react'
import { bucketed, groupSum, inRange, segFilter, sum } from '../lib/agg'
import { eachDay, weekday, WEEKDAYS } from '../lib/date'
import { dec, num, pct, ratio } from '../lib/format'
import { FUNNEL_LABEL, S } from '../lib/labels'
import type { FunnelStep } from '../lib/types'
import { Funnel, Heatmap, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Tile, TileRow } from '../components/ui'
import { delta, grain, hourTip, hourX, ptDelta, type TabProps, weekTip } from './common'

const STEPS: FunnelStep[] = ['landing', 'detail', 'signup', 'apply_view', 'payment']

function Flow({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const keys = ['persons', 'explorers', 'detail_viewers', 'apply_viewers'] as const
  const cur = sum(inRange(m, range.from, range.to), [...keys])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), [...keys])
  const rate = (o: typeof cur, k: (typeof keys)[number]) => ratio(o[k], o.persons)
  const denom = `방문자 ${num(cur.persons)}명·일 중`

  const funnel = useMemo(() => {
    const t: Record<string, number> = {}
    for (const r of data.funnel_daily)
      if (r.kst_date >= range.from && r.kst_date <= range.to && seg(r)) t[r.step] = (t[r.step] ?? 0) + r.persons
    return STEPS.map((k) => ({ label: FUNNEL_LABEL[k], value: t[k] ?? 0 }))
  }, [data, range.from, range.to, s.ch, s.pf, s.ms])

  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    for (const r of data.hourly_metrics)
      if (r.kst_date >= range.from && r.kst_date <= range.to && seg(r)) grid[weekday(r.kst_date)][r.kst_hour] += r.sessions
    const cnt = Array<number>(7).fill(0)
    for (const d of eachDay(range.from, range.to)) cnt[weekday(d)] += 1
    return grid.map((row, i) => row.map((v) => (cnt[i] ? v / cnt[i] : 0)))
  }, [data, range.from, range.to, s.ch, s.pf, s.ms])

  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }))
    for (const r of data.hourly_metrics) if (r.kst_date === range.from && seg(r)) out[r.kst_hour].sessions += r.sessions
    return out
  }, [data, range.from, s.ch, s.pf, s.ms])

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-4">
        <Tile
          label={range.oneDay ? '방문자' : '방문자 · 일평균'}
          value={num(cur.persons / range.days)}
          unit="명"
          delta={delta(data, range, cur.persons, prev.persons)}
        />
        <Tile
          label="탐색 도달률"
          value={pct(rate(cur, 'explorers'))}
          sub={denom}
          delta={ptDelta(data, range, rate(cur, 'explorers'), rate(prev, 'explorers'))}
        />
        <Tile
          label="행사 상세 조회율"
          value={pct(rate(cur, 'detail_viewers'))}
          sub={denom}
          delta={ptDelta(data, range, rate(cur, 'detail_viewers'), rate(prev, 'detail_viewers'))}
        />
        <Tile
          label="신청 화면 도달률"
          value={pct(rate(cur, 'apply_viewers'))}
          sub={denom}
          delta={ptDelta(data, range, rate(cur, 'apply_viewers'), rate(prev, 'apply_viewers'))}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[5fr_7fr]">
        <Card title="방문 퍼널" meta="사람·일">
          <Funnel steps={funnel} />
        </Card>
        {range.oneDay ? (
          <Card title="시간별 세션" meta={range.from}>
            <TimeChart
              data={hourly}
              xKey="hour"
              xFormat={hourX}
              tipTitle={hourTip}
              kind="bar"
              series={[{ key: 'sessions', label: '세션', color: S(1) }]}
              height={232}
            />
          </Card>
        ) : (
          <Card title="요일 × 시간대 세션" meta="하루 평균">
            <Heatmap
              cols={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h) : ''))}
              rows={heat.map((cells, i) => ({ label: WEEKDAYS[i], cells }))}
              format={() => ''}
              rowLabelWidth={20}
              minCell={12}
              tip={(r, c, v) => `${WEEKDAYS[r]} ${c}시 · 세션 ${dec(v)}`}
            />
          </Card>
        )}
      </div>
    </div>
  )
}

interface VenueRow {
  venue_id: number
  venue_name: string
  region: string
  genre: string
  detail_viewers: number
  applies: number
  pay_count: number
}

function Venues({ data, s, range }: TabProps) {
  const rows = useMemo(
    () =>
      inRange(data.daily_venue, range.from, range.to).filter(
        (r) => (s.rg === 'all' || r.region === s.rg) && (s.gn === 'all' || r.genre === s.gn),
      ),
    [data, range.from, range.to, s.rg, s.gn],
  )
  const keys = ['detail_viewers', 'applies', 'pay_count'] as const
  const tot = sum(rows, [...keys])
  const g = groupSum(rows, (r) => String(r.venue_id), [...keys])
  const meta = new Map(data.daily_venue.map((r) => [String(r.venue_id), r]))
  const list: VenueRow[] = [...g.entries()].map(([id, v]) => {
    const x = meta.get(id)!
    return { venue_id: x.venue_id, venue_name: x.venue_name, region: x.region, genre: x.genre, ...v }
  })
  const trend = bucketed(rows, ['detail_viewers'], range)

  const cols: Col<VenueRow>[] = [
    { key: 'venue_name', label: '공간', value: (r) => r.venue_name, render: (r) => <span className="text-ink">{r.venue_name}</span> },
    { key: 'region', label: '지역', value: (r) => r.region },
    { key: 'genre', label: '장르', value: (r) => r.genre },
    { key: 'detail_viewers', label: '상세 조회', value: (r) => r.detail_viewers, render: (r) => num(r.detail_viewers), num: true },
    { key: 'applies', label: '신청', value: (r) => r.applies, render: (r) => num(r.applies), num: true },
    { key: 'pay_count', label: '결제', value: (r) => r.pay_count, render: (r) => num(r.pay_count), num: true },
    {
      key: 'rate',
      label: '조회 대비 신청',
      value: (r) => ratio(r.applies, r.detail_viewers),
      render: (r) => pct(ratio(r.applies, r.detail_viewers)),
      num: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-4">
        <Tile label="조회된 공간" value={num(list.length)} unit="곳" />
        <Tile label="상세 조회" value={num(tot.detail_viewers)} unit="명·일" />
        <Tile label="신청" value={num(tot.applies)} unit="건" sub={`조회 대비 ${pct(ratio(tot.applies, tot.detail_viewers))}`} />
        <Tile label="결제" value={num(tot.pay_count)} unit="건" />
      </TileRow>
      {!range.oneDay && (
        <Card title="공간 상세 조회 추이" meta={`${grain(trend.weekly)} · 사람·일`}>
          <TimeChart
            data={trend.rows}
            kind="bar"
            tipTitle={weekTip(trend.weekly)}
            series={[{ key: 'detail_viewers', label: '상세 조회', color: S(1) }]}
            height={220}
          />
        </Card>
      )}
      <Card title="공간 순위" meta={`${list.length}곳`}>
        <DataTable cols={cols} rows={list} sortKey="detail_viewers" rowKey={(r) => String(r.venue_id)} />
      </Card>
    </div>
  )
}

export default function Explore(p: TabProps) {
  return p.s.view === 'venue' ? <Venues {...p} /> : <Flow {...p} />
}
