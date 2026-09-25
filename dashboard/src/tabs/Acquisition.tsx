import { useMemo } from 'react'
import { bucketed, campaignSpans, groupSum, inRange, segFilter, sum } from '../lib/agg'
import { md } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { CHANNEL2, channel2Color, channel2Label, S } from '../lib/labels'
import { BarList, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Legend, Stage, Tile, TileRow } from '../components/ui'
import { delta, grain, ptDelta, type TabProps, vsLabel, weekTip } from './common'
import { ready, useTable, waitOf } from '../lib/source'

interface ChannelRow {
  key: string
  channel2: string
  channel3: string
  sessions: number
  persons: number
  new_persons: number
  signups: number
  applies: number
  pay_amount: number
}

function Channels({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const cL = useTable(data, 'daily_channel')
  const w = waitOf(cL)
  const c = useMemo(() => (ready(cL) ?? []).filter(seg), [cL, s.ch, s.pf, s.ms])
  const keys = ['sessions', 'persons', 'new_persons', 'signups', 'applies', 'pay_amount'] as const
  const curRows = inRange(c, range.from, range.to)
  const prevRows = inRange(c, range.prevFrom, range.prevTo)
  const cur = sum(curRows, [...keys])
  const prev = sum(prevRows, [...keys])
  const paid = (rows: typeof c) => sum(rows.filter((r) => r.channel1 === 'paid'), ['sessions']).sessions
  const paidShare = ratio(paid(curRows), cur.sessions)

  const present = CHANNEL2.filter((x) => curRows.some((r) => r.channel2 === x.key && r.sessions > 0))
  const stack = useMemo(() => {
    const flat = curRows.map((r) => {
      const o: Record<string, number | string> = { kst_date: r.kst_date }
      for (const x of CHANNEL2) o[x.key] = r.channel2 === x.key ? r.sessions : 0
      return o as { kst_date: string } & Record<string, number>
    })
    return bucketed(flat, CHANNEL2.map((x) => x.key), range)
  }, [curRows, range])
  const series = present.map((x) => ({ key: x.key, label: x.label, color: channel2Color(x.key) }))

  const g = groupSum(curRows, (r) => `${r.channel2}|${r.channel3}`, [...keys])
  const list: ChannelRow[] = [...g.entries()].map(([k, v]) => {
    const [channel2, channel3] = k.split('|')
    return { key: k, channel2, channel3, ...v }
  })

  const cols: Col<ChannelRow>[] = [
    {
      key: 'channel2',
      label: '유입 유형',
      value: (r) => channel2Label(r.channel2),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-ink">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: channel2Color(r.channel2) }} />
          {channel2Label(r.channel2)}
        </span>
      ),
    },
    { key: 'channel3', label: '소스', value: (r) => r.channel3 },
    { key: 'sessions', label: '세션', value: (r) => r.sessions, render: (r) => num(r.sessions), num: true },
    {
      key: 'share',
      label: '세션 비중',
      value: (r) => ratio(r.sessions, cur.sessions),
      render: (r) => pct(ratio(r.sessions, cur.sessions)),
      num: true,
    },
    { key: 'new_persons', label: '신규', value: (r) => r.new_persons, render: (r) => num(r.new_persons), num: true },
    { key: 'signups', label: '가입', value: (r) => r.signups, render: (r) => num(r.signups), num: true },
    {
      key: 'signup_rate',
      label: '신규 대비 가입',
      value: (r) => ratio(r.signups, r.new_persons),
      render: (r) => pct(ratio(r.signups, r.new_persons)),
      num: true,
    },
    { key: 'applies', label: '신청', value: (r) => r.applies, render: (r) => num(r.applies), num: true },
    { key: 'pay_amount', label: '결제 금액', value: (r) => r.pay_amount, render: (r) => won(r.pay_amount), num: true },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow cols="lg:grid-cols-5" title={`유입 · ${vsLabel(data, range)}`}>
        <Tile metricId="A01" label="세션" value={num(cur.sessions)} delta={delta(data, range, cur.sessions, prev.sessions)} wait={w} />
        <Tile
          metricId="A02"
          label="광고 세션 비중"
          value={pct(paidShare)}
          sub={`세션 ${num(cur.sessions)} 중`}
          delta={ptDelta(data, range, paidShare, ratio(paid(prevRows), prev.sessions), null)}
          wait={w}
        />
        <Tile metricId="A03" label="신규 방문자" value={num(cur.new_persons)} unit="명" delta={delta(data, range, cur.new_persons, prev.new_persons)} wait={w} />
        <Tile metricId="C10" label="가입" value={num(cur.signups)} unit="명" delta={delta(data, range, cur.signups, prev.signups)} wait={w} />
        <Tile metricId="C13" label="결제 금액" value={won(cur.pay_amount)} unit="원" delta={delta(data, range, cur.pay_amount, prev.pay_amount)} wait={w} />
      </TileRow>

      <Card
        title="유입 유형별 세션"
        metricId="A01"
        meta={range.oneDay ? range.from : `${grain(stack.weekly)} · 세션 라스트클릭`}
        right={range.oneDay ? undefined : <Legend items={series} />}
        wait={w}
        waitH={280}
      >
        {range.oneDay ? (
          <BarList
            items={present
              .map((x) => ({
                label: x.label,
                color: channel2Color(x.key),
                value: sum(curRows.filter((r) => r.channel2 === x.key), ['sessions']).sessions,
              }))
              .sort((a, b) => b.value - a.value)}
          />
        ) : (
          <TimeChart data={stack.rows} kind="stack" tipTitle={weekTip(stack.weekly)} series={series} height={280} />
        )}
      </Card>

      <Card title="채널별 성과" metricId="A03" meta={`${list.length}개`} wait={w}>
        <DataTable cols={cols} rows={list} sortKey="sessions" rowKey={(r) => r.key} />
      </Card>
    </div>
  )
}

interface CampRow {
  campaign_id: string
  campaign_name: string
  from: string
  to: string
  spend: number
  impressions: number
  clicks: number
  sessions: number
  signups: number
  applies: number
  payers: number
  pay_amount: number
}

const AD_KEYS = [
  'spend',
  'impressions',
  'clicks',
  'sessions',
  'signups',
  'applies',
  'payers',
  'pay_amount',
] as const

function Campaigns({ data, s, set, range }: TabProps) {
  const spans = useMemo(() => campaignSpans(data), [data])
  const inR = inRange(data.daily_ad, range.from, range.to)
  const sel = s.camp && spans.has(s.camp) ? s.camp : ''
  const rows = sel ? inR.filter((r) => r.campaign_id === sel) : inR
  const t = sum(rows, [...AD_KEYS])
  const hasNew = rows.some((r) => r.new_persons != null)
  const newPersons = rows.reduce((a, r) => a + (r.new_persons ?? 0), 0)
  const trend = bucketed(rows, ['spend', 'sessions'], range)

  const g = groupSum(inR, (r) => r.campaign_id, [...AD_KEYS])
  const list: CampRow[] = [...g.entries()].map(([id, v]) => {
    const sp = spans.get(id)!
    return { campaign_id: id, campaign_name: sp.name, from: sp.from, to: sp.to, ...v }
  })

  const cols: Col<CampRow>[] = [
    {
      key: 'campaign_name',
      label: '캠페인',
      value: (r) => r.campaign_name,
      render: (r) => (
        <div>
          <div className="text-ink">{r.campaign_name}</div>
          <div className="tnum text-xs text-muted">
            {md(r.from)}~{md(r.to)}
          </div>
        </div>
      ),
    },
    { key: 'spend', label: '지출', value: (r) => r.spend, render: (r) => won(r.spend), num: true },
    { key: 'clicks', label: '클릭', value: (r) => r.clicks, render: (r) => num(r.clicks), num: true },
    {
      key: 'ctr',
      label: 'CTR',
      value: (r) => ratio(r.clicks, r.impressions),
      render: (r) => pct(ratio(r.clicks, r.impressions), 2),
      num: true,
    },
    { key: 'sessions', label: '세션', value: (r) => r.sessions, render: (r) => num(r.sessions), num: true },
    { key: 'signups', label: '가입', value: (r) => r.signups, render: (r) => num(r.signups), num: true },
    {
      key: 'cac',
      label: 'CAC',
      value: (r) => ratio(r.spend, r.signups),
      render: (r) => won(ratio(r.spend, r.signups)),
      num: true,
    },
    { key: 'pay_amount', label: '결제 금액', value: (r) => r.pay_amount, render: (r) => won(r.pay_amount), num: true },
    {
      key: 'roas',
      label: 'ROAS',
      value: (r) => ratio(r.pay_amount, r.spend),
      render: (r) => pct(ratio(r.pay_amount, r.spend), 0),
      num: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col divide-y divide-line overflow-hidden lg:flex-row lg:divide-x lg:divide-y-0">
        <Stage title="집행">
          <Tile metricId="A08" label="지출" value={won(t.spend)} unit="원" />
          <Tile metricId="A09" label="노출" value={won(t.impressions)} />
          <Tile metricId="A04" label="클릭" value={num(t.clicks)} sub={`CTR ${pct(ratio(t.clicks, t.impressions), 2)}`} />
        </Stage>
        <Stage title="유입">
          <Tile metricId="A10" label="세션" value={num(t.sessions)} sub={`클릭 대비 ${pct(ratio(t.sessions, t.clicks), 0)}`} />
          {hasNew && <Tile metricId="A11" label="신규 방문자" value={num(newPersons)} unit="명" />}
        </Stage>
        <Stage title="행동">
          <Tile metricId="A05" label="가입" value={num(t.signups)} unit="명" sub={`CAC ${won(ratio(t.spend, t.signups))}원`} />
          <Tile metricId="C11" label="신청" value={num(t.applies)} unit="건" />
          <Tile metricId="A06" label="결제 금액" value={won(t.pay_amount)} unit="원" sub={`ROAS ${pct(ratio(t.pay_amount, t.spend), 0)}`} />
        </Stage>
      </div>

      {!range.oneDay && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="지출" metricId="A08" meta={`${grain(trend.weekly)} · 원`}>
            <TimeChart
              data={trend.rows}
              kind="bar"
              tipTitle={weekTip(trend.weekly)}
              valueFormat={won}
              series={[{ key: 'spend', label: '지출', color: S(1) }]}
              height={200}
            />
          </Card>
          <Card title="광고 세션" metricId="A10" meta={`${grain(trend.weekly)} · 세션`}>
            <TimeChart
              data={trend.rows}
              kind="bar"
              tipTitle={weekTip(trend.weekly)}
              series={[{ key: 'sessions', label: '세션', color: S(1) }]}
              height={200}
            />
          </Card>
        </div>
      )}

      <Card title="캠페인 비교" metricId="A07" meta={`${list.length}개`}>
        <DataTable
          cols={cols}
          rows={list}
          sortKey="spend"
          rowKey={(r) => r.campaign_id}
          selected={sel}
          onSelect={(r) => set(sel === r.campaign_id ? { camp: '', p: 'target' } : { camp: r.campaign_id, p: 'target' })}
        />
      </Card>
    </div>
  )
}

export default function Acquisition(p: TabProps) {
  return p.s.view === 'campaign' ? <Campaigns {...p} /> : <Channels {...p} />
}
