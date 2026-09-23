-- 표: marts.monthly_summary — 월간 브리핑 표
-- 1행: 월(KST)
-- 키: month
-- 파티션·클러스터: DATE_TRUNC(month, MONTH) / 없음
-- 원천: staging.int_person_day (방문), staging.int_session (세션·채널), staging.dim_member (가입), staging.fct_order (원장),
--       marts.weekly_cohort (W1 리텐션 — 같은 층 마트를 재사용해 정의를 한 곳에 둔다. 먼저 생성돼야 한다)
-- 소비: 주간·월간 탭 월간 보기의 브리핑 표. 비율은 분자·분모 열로 둔다.
--       예외: w1_retention 은 화면 계약상 비율(0~1)로도 둔다. 분자·분모는 w1_retained·w1_cohort_size
--
-- 원장 열(applies·pay_count·pay_amount·cancels)은 신청일이 속한 달 기준. W1 은 첫 방문 주(월요일)가 그 달에 속한 코호트의 합.
-- top_channel = 방문 세션이 가장 많은 세션 채널 2단계 값.

CREATE OR REPLACE TABLE marts.monthly_summary (
  month DATE OPTIONS(description='월 (1일). 월 파티션'),
  persons INT64 OPTIONS(description='월간 방문 사람 수 (MAU)'),
  new_persons INT64 OPTIONS(description='그 달 첫 방문 사람 수'),
  signups INT64 OPTIONS(description='가입 회원 수 (원장, 가입일 기준)'),
  applies INT64 OPTIONS(description='신청 건수 (원장)'),
  pay_count INT64 OPTIONS(description='결제 완료 건수 (원장)'),
  pay_amount INT64 OPTIONS(description='결제 금액 (원)'),
  cancels INT64 OPTIONS(description='취소된 신청 건수 (원장)'),
  w1_retention FLOAT64 OPTIONS(description='W1 리텐션 = w1_retained / w1_cohort_size (0~1). 관측 완료 코호트가 없으면 NULL'),
  top_channel STRING OPTIONS(description='방문 세션이 가장 많은 세션 채널 2단계'),
  observed_days INT64 OPTIONS(description='관측 일수'),
  sessions INT64 OPTIONS(description='방문 세션 수 (자동 로드 제외)'),
  auto_load_sessions INT64 OPTIONS(description='자동 로드 세션 수'),
  paid_tier_applies INT64 OPTIONS(description='유료 행사 신청 건수 (원장)'),
  refund_amount INT64 OPTIONS(description='환불액 (원)'),
  net_amount INT64 OPTIONS(description='순매출 (원)'),
  w1_cohort_size INT64 OPTIONS(description='W1 분모: 그 달 시작 주 코호트 크기 합 (W1 관측 완료분)'),
  w1_retained INT64 OPTIONS(description='W1 분자: 그 코호트 중 다음 주 방문자 합'),
  top_channel_sessions INT64 OPTIONS(description='top_channel 의 방문 세션 수')
)
PARTITION BY DATE_TRUNC(month, MONTH)
OPTIONS(description='월간 브리핑 표. 1행 = 월. 원천 staging.int_person_day·int_session·dim_member·fct_order, marts.weekly_cohort')
AS
WITH pd AS (
  SELECT person_id, kst_date, is_visit, is_first_visit_day
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
visit AS (
  SELECT
    DATE_TRUNC(kst_date, MONTH) AS month,
    COUNT(DISTINCT kst_date) AS observed_days,
    COUNT(DISTINCT IF(is_visit, person_id, NULL)) AS mau,
    COUNTIF(is_visit AND is_first_visit_day) AS new_visitors
  FROM pd
  GROUP BY 1
),
sess AS (
  SELECT
    DATE_TRUNC(session_date, MONTH) AS month,
    COUNTIF(NOT is_auto_load) AS sessions,
    COUNTIF(is_auto_load) AS auto_load_sessions
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY 1
),
chan AS (
  SELECT month, session_channel2 AS top_channel, n AS top_channel_sessions
  FROM (
    SELECT DATE_TRUNC(session_date, MONTH) AS month, session_channel2, COUNT(*) AS n
    FROM staging.int_session
    WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND NOT is_auto_load
    GROUP BY 1, 2
  )
  QUALIFY ROW_NUMBER() OVER (PARTITION BY month ORDER BY n DESC, session_channel2) = 1
),
signup AS (
  SELECT DATE_TRUNC(signup_date, MONTH) AS month, COUNT(*) AS signups
  FROM staging.dim_member
  GROUP BY 1
),
orders AS (
  SELECT
    DATE_TRUNC(applied_date, MONTH) AS month,
    COUNT(*) AS applications,
    COUNTIF(is_paid_tier) AS paid_tier_applications,
    COUNTIF(is_paid) AS paid_orders,
    COUNTIF(is_canceled) AS canceled,
    SUM(paid_amount) AS gross_amount,
    SUM(refund_amount) AS refund_amount,
    SUM(net_amount) AS net_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY 1
),
w1 AS (
  SELECT
    DATE_TRUNC(cohort_week, MONTH) AS month,
    SUM(cohort_size) AS w1_cohort_size,
    SUM(retained) AS w1_retained
  FROM marts.weekly_cohort
  WHERE week_offset = 1 AND is_complete_week
  GROUP BY 1
)
SELECT
  v.month,
  v.mau AS persons,
  v.new_visitors AS new_persons,
  COALESCE(su.signups, 0) AS signups,
  COALESCE(o.applications, 0) AS applies,
  COALESCE(o.paid_orders, 0) AS pay_count,
  COALESCE(o.gross_amount, 0) AS pay_amount,
  COALESCE(o.canceled, 0) AS cancels,
  SAFE_DIVIDE(w.w1_retained, w.w1_cohort_size) AS w1_retention,
  c.top_channel,
  v.observed_days,
  COALESCE(s.sessions, 0) AS sessions,
  COALESCE(s.auto_load_sessions, 0) AS auto_load_sessions,
  COALESCE(o.paid_tier_applications, 0) AS paid_tier_applies,
  COALESCE(o.refund_amount, 0) AS refund_amount,
  COALESCE(o.net_amount, 0) AS net_amount,
  COALESCE(w.w1_cohort_size, 0) AS w1_cohort_size,
  COALESCE(w.w1_retained, 0) AS w1_retained,
  c.top_channel_sessions
FROM visit AS v
LEFT JOIN sess AS s USING (month)
LEFT JOIN chan AS c USING (month)
LEFT JOIN signup AS su USING (month)
LEFT JOIN orders AS o USING (month)
LEFT JOIN w1 AS w USING (month);
