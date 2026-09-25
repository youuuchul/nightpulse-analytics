-- 표: staging.dim_contract — 공간 파트너 계약 차원
-- 1행: 계약 1건
-- 키: contract_id
-- 파티션·클러스터: 없음 / venue_id
-- 원천: raw.db_venue_contracts
-- 소비: staging.dim_contract_change·int_contract_day·dim_venue, marts.daily_venue_registry·monthly_contract·contract_cohort,
--       ops.reconciliation
--
-- 활성 규칙은 dim_subscription 과 같다: 날짜 d 에 활성 = start_date <= d AND (end_date IS NULL OR end_date > d) (KST).
-- end_date 당일 = 해지. 진행 중 계약은 스냅샷 기준일까지만 펼친다.
-- plan·monthly_fee 는 원장 값 그대로다. 요금제 변경(staging.dim_contract_change)을 반영한 날짜별 요금제·요금은
-- staging.int_contract_day 에서 읽는다. 파트너 플랜 매출 = 활성일마다 그날 monthly_fee ÷ 그 달 일수 (marts.daily_revenue kind = partner_plan).

CREATE OR REPLACE TABLE staging.dim_contract (
  contract_id STRING OPTIONS(description='계약 ID'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  plan STRING OPTIONS(description='요금제 basic / pro (원장 값, 변경 반영 전)'),
  monthly_fee INT64 OPTIONS(description='월 이용료 (원, 원장 값, 변경 반영 전)'),
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
