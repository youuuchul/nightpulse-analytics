import { useMemo } from 'react'
import { bucketed, groupSum, inRange, sum } from '../lib/agg'
import { num, pct, ratio } from '../lib/format'
import { S } from '../lib/labels'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Tile, TileRow } from '../components/ui'
import { grain, type TabProps, weekTip } from './common'

interface VenueRow {
  venue_id: number
  venue_name: string
  region: string
  genre: string
  detail_viewers: number
  applies: number
  pay_count: number
}

export default function Venues({ data, s, range }: TabProps) {
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

