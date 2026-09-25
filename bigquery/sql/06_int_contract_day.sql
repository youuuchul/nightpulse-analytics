-- 표: staging.int_contract_day — 파트너 계약 활성일 (요금제 변경 반영)
-- 1행: 계약 × 활성일(KST)
-- 키: (contract_id, kst_date)
-- 파티션·클러스터: kst_date / venue_id
-- 원천: staging.dim_contract (계약 기간), staging.dim_contract_change (요금제 변경)
-- 소비: staging.fct_order·dim_venue, marts.daily_revenue·daily_venue_registry·monthly_contract·contract_cohort
--
-- 계약의 날짜별 요금제·요금을 한 곳에서 펼친다. 활성 규칙은 staging.dim_contract 머리 주석(start_date <= d < end_date).
-- 그날 요금제 = change_date <= d 인 마지막 변경의 to_plan. 그런 변경이 없으면 첫 변경의 from_plan,
-- 변경 이력이 없으면 계약 원장의 plan. (원장 plan 이 최초·현재 어느 쪽이든 변경 이력이 우선한다.)
-- 파트너 플랜 매출·MRR·수수료 등급·기준일 요금제는 모두 이 표에서 읽는다.

CREATE OR REPLACE TABLE staging.int_contract_day (
  kst_date DATE OPTIONS(description='활성일 (KST). 일 파티션'),
  contract_id STRING OPTIONS(description='계약 ID'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  plan STRING OPTIONS(description='그날 요금제 basic / pro'),
  monthly_fee INT64 OPTIONS(description='그날 월 이용료 (원)'),
  day_fee FLOAT64 OPTIONS(description='그날 일할 요금 = monthly_fee ÷ 그 달 일수 (원, 반올림 전)')
)
PARTITION BY kst_date
CLUSTER BY venue_id
OPTIONS(description='파트너 계약 활성일. 1행 = 계약 × 활성일. 키 (contract_id, kst_date). 원천 staging.dim_contract·dim_contract_change. 요금제 변경 반영')
AS
WITH days AS (
  SELECT c.contract_id, c.venue_id, c.plan, c.monthly_fee, d AS kst_date
  FROM staging.dim_contract AS c,
    UNNEST(GENERATE_DATE_ARRAY(c.start_date, LEAST(COALESCE(DATE_SUB(c.end_date, INTERVAL 1 DAY), c.snapshot_date), c.snapshot_date))) AS d
),
first_change AS (
  SELECT contract_id, ARRAY_AGG(STRUCT(from_plan, from_fee) ORDER BY changed_at, change_id LIMIT 1)[OFFSET(0)] AS f
  FROM staging.dim_contract_change
  GROUP BY contract_id
),
applied AS (
  SELECT
    d.kst_date,
    d.contract_id,
    ch.to_plan,
    ch.to_fee
  FROM days AS d
  JOIN staging.dim_contract_change AS ch
    ON ch.contract_id = d.contract_id AND ch.change_date <= d.kst_date
  QUALIFY ROW_NUMBER() OVER (PARTITION BY d.contract_id, d.kst_date ORDER BY ch.changed_at DESC, ch.change_id DESC) = 1
),
resolved AS (
  SELECT
    d.kst_date,
    d.contract_id,
    d.venue_id,
    COALESCE(a.to_plan, fc.f.from_plan, d.plan) AS plan,
    COALESCE(a.to_fee, fc.f.from_fee, d.monthly_fee) AS monthly_fee
  FROM days AS d
  LEFT JOIN applied AS a USING (contract_id, kst_date)
  LEFT JOIN first_change AS fc USING (contract_id)
)
SELECT
  kst_date,
  contract_id,
  venue_id,
  plan,
  monthly_fee,
  monthly_fee / EXTRACT(DAY FROM LAST_DAY(kst_date, MONTH)) AS day_fee
FROM resolved;
