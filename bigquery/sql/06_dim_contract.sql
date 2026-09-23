-- 표: staging.dim_contract — 공간 파트너 계약 차원
-- 1행: 계약 1건
-- 키: contract_id
-- 파티션·클러스터: 없음 / venue_id
-- 원천: raw.db_venue_contracts
-- 소비: staging.dim_venue, marts.daily_revenue·daily_venue_registry
--
-- 활성 규칙은 dim_subscription 과 같다: 날짜 d 에 활성 = start_date <= d AND (end_date IS NULL OR end_date > d) (KST).
-- end_date 당일 = 해지. 진행 중 계약은 스냅샷 기준일까지만 펼친다.
-- B2B 매출은 결제 원장이 아니라 이 표에서 계산한다: 활성일마다 monthly_fee ÷ 그 달 일수 (marts.daily_revenue kind = b2b).

CREATE OR REPLACE TABLE staging.dim_contract (
  contract_id STRING OPTIONS(description='계약 ID'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  plan STRING OPTIONS(description='요금제 basic / pro'),
  monthly_fee INT64 OPTIONS(description='월 이용료 (원)'),
  started_at TIMESTAMP OPTIONS(description='계약 시작 시각 (UTC)'),
  ended_at TIMESTAMP OPTIONS(description='계약 종료 시각 (UTC). NULL = 진행 중'),
  start_date DATE OPTIONS(description='계약 시작일 (KST)'),
  end_date DATE OPTIONS(description='계약 종료일 (KST). 이날부터 비활성. NULL = 진행 중'),
  status STRING OPTIONS(description='계약 상태 active / ended'),
  snapshot_date DATE OPTIONS(description='원장 스냅샷 기준일')
)
CLUSTER BY venue_id
OPTIONS(description='공간 파트너 계약 차원. 1행 = 계약 1건. 키 contract_id. 원천 raw.db_venue_contracts. 활성 = start_date <= d < end_date')
AS
SELECT
  contract_id,
  venue_id,
  plan,
  monthly_fee,
  started_at,
  ended_at,
  DATE(started_at, 'Asia/Seoul') AS start_date,
  DATE(ended_at, 'Asia/Seoul') AS end_date,
  status,
  snapshot_date
FROM raw.db_venue_contracts;
