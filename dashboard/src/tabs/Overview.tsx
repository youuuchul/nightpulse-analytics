import { useMemo } from 'react'
import { bucketed, inRange, segFilter, sum } from '../lib/agg'
import { num, pct, ratio, won } from '../lib/format'
import { S } from '../lib/labels'
import { TimeChart } from '../components/charts'
import { Card, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, ptDelta, hourTip, hourX, type TabProps, weekTip } from './common'

const KEYS = ['persons', 'new_persons', 'sessions', 'engaged_sessions', 'signups', 'pay_amount'] as const

export default function Overview({ data, s, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = sum(inRange(m, range.from, range.to), [...KEYS])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), [...KEYS])
  const d = (k: (typeof KEYS)[number], goodUp = true) => delta(data, range, cur[k], prev[k], goodUp)

  const trend = bucketed(inRange(m, range.from, range.to), ['persons', 'new_persons'], range)
  const hourly = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }))
    for (const r of data.hourly_metrics) if (r.kst_date === range.from && seg(r)) out[r.kst_hour].sessions += r.sessions
    return out
  }, [data, range.from, s.ch, s.pf, s.ms])

  const engaged = ratio(cur.engaged_sessions, cur.sessions)
  const engagedPrev = ratio(prev.engaged_sessions, prev.sessions)

  return (
    <div className="flex flex-col gap-4">
      <TileRow>
        <Tile
          label={range.oneDay ? '방문자' : '방문자 · 일평균'}
          value={num(cur.persons / range.days)}
          unit="명"
          delta={d('persons')}
        />
        <Tile label="신규 방문자" value={num(cur.new_persons)} unit="명" delta={d('new_persons')} />
        <Tile label="세션" value={num(cur.sessions)} delta={d('sessions')} />
        <Tile
          label="활성 세션 비율"
          value={pct(engaged)}
          sub={`세션 ${num(cur.sessions)} 중`}
          delta={ptDelta(data, range, engaged, engagedPrev)}
        />
        <Tile label="가입" value={num(cur.signups)} unit="명" delta={d('signups')} />
        <Tile label="결제 금액" value={won(cur.pay_amount)} unit="원" delta={d('pay_amount')} />
      </TileRow>

      {range.oneDay ? (
        <Card title="시간별 세션" meta={range.from}>
          <TimeChart
            data={hourly}
            xKey="hour"
            xFormat={hourX}
            tipTitle={hourTip}
            kind="bar"
            series={[{ key: 'sessions', label: '세션', color: S(1) }]}
            height={300}
          />
        </Card>
      ) : (
        <Card
          title="방문자 추이"
          meta={`${grain(trend.weekly)} · 사람`}
          right={
            <Legend
              items={[
                { label: '방문자', color: S(1), kind: 'line' },
                { label: '신규', color: S(2), kind: 'line' },
              ]}
            />
          }
        >
          <TimeChart
            data={trend.rows}
            kind="line"
            tipTitle={weekTip(trend.weekly)}
            series={[
              { key: 'persons', label: '방문자', color: S(1) },
              { key: 'new_persons', label: '신규', color: S(2) },
            ]}
            height={300}
          />
        </Card>
      )}
    </div>
  )
}
