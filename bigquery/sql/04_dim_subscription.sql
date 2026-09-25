-- 표: staging.dim_subscription — 소비자 구독 차원
-- 1행: 구독 1건
-- 키: subscription_id
-- 파티션·클러스터: 없음 / member_id
-- 원천: raw.db_subscriptions, raw.db_payments (구독 결제 집계)
-- 소비: staging.int_person_day, marts.daily_subscription·subscription_cohort
--
-- 활성 규칙(구독·계약 공통, 이 규칙은 여기와 06_dim_contract.sql 에만 적는다)
--   날짜 d 에 활성 = start_date <= d AND (end_date IS NULL OR end_date > d). 날짜는 KST
--   end_date 당일은 활성이 아니고 그날 해지(churn)로 센다. 시작일 = 신규
--   진행 중(end_date NULL)인 구독은 스냅샷 기준일(snapshot_date)까지만 펼친다

CREATE OR REPLACE TABLE staging.dim_subscription (
  subscription_id STRING OPTIONS(description='구독 ID'),
  member_id STRING OPTIONS(description='회원 ID (구독은 회원만)'),
  started_at TIMESTAMP OPTIONS(description='구독 시작 시각 (UTC)'),
  ended_at TIMESTAMP OPTIONS(description='구독 종료 시각 (UTC). NULL = 진행 중'),
  start_date DATE OPTIONS(description='구독 시작일 (KST)'),
  end_date DATE OPTIONS(description='구독 종료일 (KST). 이날부터 비활성. NULL = 진행 중'),
  status STRING OPTIONS(description='구독 상태 active / canceled'),
  price INT64 OPTIONS(description='월 구독료 (원)'),
  paid_count INT64 OPTIONS(description='구독 결제 건수 (원장, 환불 포함)'),
  paid_amount INT64 OPTIONS(description='구독 결제 금액 합 (원, 환불 포함)'),
  snapshot_date DATE OPTIONS(description='원장 스냅샷 기준일')
)
CLUSTER BY member_id
OPTIONS(description='소비자 구독 차원. 1행 = 구독 1건. 키 subscription_id. 원천 raw.db_subscriptions + raw.db_payments(구독 결제 집계). 활성 = start_date <= d < end_date')
AS
WITH pay AS (
  SELECT subscription_id, COUNT(*) AS paid_count, SUM(amount) AS paid_amount
  FROM raw.db_payments
  WHERE kind = 'subscription'
  GROUP BY subscription_id
)
SELECT
  s.subscription_id,
  s.member_id,
  s.started_at,
  s.ended_at,
  DATE(s.started_at, 'Asia/Seoul') AS start_date,
  DATE(s.ended_at, 'Asia/Seoul') AS end_date,
  s.status,
  s.price,
  COALESCE(p.paid_count, 0) AS paid_count,
  COALESCE(p.paid_amount, 0) AS paid_amount,
  s.snapshot_date
FROM raw.db_subscriptions AS s
LEFT JOIN pay AS p USING (subscription_id);
