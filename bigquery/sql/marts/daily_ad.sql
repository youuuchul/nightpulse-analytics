-- marts.daily_ad — 광고 성과 마트
-- 그레인: 일(KST) × 캠페인. 키: (kst_date, campaign_id)
-- 원천: staging.ad_spend (집행), staging.int_session (광고 세션 = 세션 라스트클릭 channel1 paid, campaign 일치)
-- 소비: 유입·광고 탭 캠페인 보기 — 집행(지출·노출·클릭) → 유입(세션·방문자·활성 방문자) → 행동(가입·신청·결제). CTR·CAC·ROAS 는 화면에서 나눈다
-- 귀속: 세션 라스트클릭. 광고 세션 안에서 일어난 가입·신청·결제만 캠페인에 붙인다(이후 재방문 전환은 제외)
-- 집행 없는 날의 광고 세션도 행으로 남긴다(spend 0). sessions 는 자동 로드 제외.

CREATE OR REPLACE TABLE marts.daily_ad (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  campaign_id STRING OPTIONS(description='캠페인 ID'),
  campaign_name STRING OPTIONS(description='캠페인명 (가상)'),
  spend INT64 OPTIONS(description='광고비 (원)'),
  impressions INT64 OPTIONS(description='노출'),
  clicks INT64 OPTIONS(description='클릭'),
  sessions INT64 OPTIONS(description='광고 방문 세션 수 (자동 로드 제외)'),
  persons INT64 OPTIONS(description='광고 방문 세션을 가진 고유 사람 수'),
  active_persons INT64 OPTIONS(description='광고 활성 세션을 가진 고유 사람 수'),
  signups INT64 OPTIONS(description='광고 세션 안 가입 수'),
  applies INT64 OPTIONS(description='광고 세션 안 신청 건수'),
  payers INT64 OPTIONS(description='광고 세션 안 결제한 고유 사람 수'),
  pay_amount INT64 OPTIONS(description='광고 세션 안 결제 금액 (원)'),
  new_persons INT64 OPTIONS(description='광고 세션이 첫 방문인 사람 수'),
  auto_load_sessions INT64 OPTIONS(description='광고 자동 로드 세션 수'),
  pay_count INT64 OPTIONS(description='광고 세션 안 결제 건수')
)
PARTITION BY kst_date
CLUSTER BY campaign_id
OPTIONS(description='광고 성과 마트. 1행 = 일 × 캠페인. 원천 staging.ad_spend·int_session (세션 라스트클릭 귀속)')
AS
WITH spend AS (
  SELECT kst_date, campaign_id, campaign_name, spend, impressions, clicks
  FROM staging.ad_spend
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
sess AS (
  SELECT
    session_date AS kst_date,
    campaign AS campaign_id,
    COUNTIF(NOT is_auto_load) AS sessions,
    COUNT(DISTINCT IF(is_auto_load, NULL, person_id)) AS persons,
    COUNT(DISTINCT IF(is_active, person_id, NULL)) AS active_persons,
    SUM(sign_ups) AS signups,
    SUM(applications) AS applies,
    COUNT(DISTINCT IF(purchases > 0, person_id, NULL)) AS payers,
    SUM(purchase_amount) AS pay_amount,
    COUNTIF(is_person_first_session) AS new_persons,
    COUNTIF(is_auto_load) AS auto_load_sessions,
    SUM(purchases) AS pay_count
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND session_channel1 = 'paid'
  GROUP BY 1, 2
),
names AS (
  SELECT campaign_id, ANY_VALUE(campaign_name) AS campaign_name
  FROM spend
  GROUP BY campaign_id
)
SELECT
  kst_date,
  campaign_id,
  COALESCE(sp.campaign_name, n.campaign_name) AS campaign_name,
  COALESCE(sp.spend, 0) AS spend,
  COALESCE(sp.impressions, 0) AS impressions,
  COALESCE(sp.clicks, 0) AS clicks,
  COALESCE(se.sessions, 0) AS sessions,
  COALESCE(se.persons, 0) AS persons,
  COALESCE(se.active_persons, 0) AS active_persons,
  COALESCE(se.signups, 0) AS signups,
  COALESCE(se.applies, 0) AS applies,
  COALESCE(se.payers, 0) AS payers,
  COALESCE(se.pay_amount, 0) AS pay_amount,
  COALESCE(se.new_persons, 0) AS new_persons,
  COALESCE(se.auto_load_sessions, 0) AS auto_load_sessions,
  COALESCE(se.pay_count, 0) AS pay_count
FROM spend AS sp
FULL OUTER JOIN sess AS se USING (kst_date, campaign_id)
LEFT JOIN names AS n USING (campaign_id);
