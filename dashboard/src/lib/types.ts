export type Channel1 = 'paid' | 'non_paid'
export type Platform = 'ios' | 'android' | 'web'
export type MemberSeg = 'member' | 'guest'

export interface Seg {
  channel1: Channel1
  device_platform: Platform
  member_seg: MemberSeg
}

export interface DailyMetric extends Seg {
  kst_date: string
  persons: number
  new_persons: number
  sessions: number
  engaged_sessions: number
  explorers: number
  detail_viewers: number
  signups: number
  apply_viewers: number
  applies: number
  payers: number
  pay_count: number
  pay_amount: number
  cancels: number
}

export interface HourlyMetric extends Seg {
  kst_date: string
  kst_hour: number
  persons: number
  sessions: number
  applies: number
  pay_count: number
}

export interface DailyChannel extends Seg {
  kst_date: string
  channel2: string
  channel3: string
  sessions: number
  persons: number
  new_persons: number
  signups: number
  applies: number
  payers: number
  pay_amount: number
}

export interface DailyAd {
  kst_date: string
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  sessions: number
  persons: number
  active_persons: number
  signups: number
  applies: number
  payers: number
  pay_amount: number
  new_persons?: number
}

export interface DailyEvent {
  kst_date: string
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

export interface DailyVenue {
  kst_date: string
  venue_id: number
  venue_name: string
  region: string
  genre: string
  detail_viewers: number
  applies: number
  pay_count: number
}

export type FunnelStep = 'landing' | 'detail' | 'signup' | 'apply_view' | 'payment'

export interface FunnelDaily extends Seg {
  kst_date: string
  step: FunnelStep
  persons: number
}

export interface WeeklyCohort extends Seg {
  cohort_week: string
  week_offset: number
  cohort_size: number
  retained: number
}

export interface MonthlyCohort {
  cohort_month: string
  month_offset: number
  member_seg: MemberSeg
  cohort_size: number
  retained: number
}

export interface WeeklyActivity extends Seg {
  week_start: string
  wau: number
  new_persons: number
  returning_persons: number
  two_plus_days: number
}

export interface MonthlySummary {
  month: string
  persons: number
  new_persons: number
  signups: number
  applies: number
  pay_count: number
  pay_amount: number
  cancels: number
  w1_retention: number | null
  top_channel: string | null
}

export type AudienceId = 'new' | 'returning' | 'paid_inflow' | 'past_payer' | 'apply_no_pay' | 'explorer_only'

export interface WeeklyAudienceFunnel extends Seg {
  week_start: string
  audience_id: AudienceId
  step: FunnelStep
  persons: number
}

export interface WeeklyPath extends Seg {
  week_start: string
  step: number
  from_screen: string
  to_screen: string
  sessions: number
}

export interface Meta {
  to_date: string
  from_date: string
  built_at: string
  source?: string
  tables: Record<string, number>
}

export interface Data {
  meta: Meta
  files: Partial<Record<LazyKey | 'person_day_meta', string>>
  daily_metrics: DailyMetric[]
  daily_ad: DailyAd[]
  daily_event: DailyEvent[]
  funnel_daily: FunnelDaily[]
  weekly_cohort: WeeklyCohort[]
  monthly_cohort: MonthlyCohort[]
  weekly_activity: WeeklyActivity[]
  monthly_summary: MonthlySummary[]
  weekly_audience_funnel?: WeeklyAudienceFunnel[]
}

export interface LazyTables {
  hourly_metrics: HourlyMetric[]
  daily_channel: DailyChannel[]
  daily_venue: DailyVenue[]
  weekly_path: WeeklyPath[]
  person_day: PersonDay
}

export type LazyKey = keyof LazyTables

/** person_day.bin 을 읽은 그대로. 행 i = w[2i], w[2i+1] (비트 배치는 persons.ts). 날짜 순 정렬. */
export interface PersonDay {
  base_date: string
  codes: { c: string[]; p: string[]; m: string[] }
  n: number
  w: Uint32Array
}
