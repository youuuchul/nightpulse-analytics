-- 표: marts.daily_venue_registry — 상권별 공간 등록·파트너 계약 일 마트
-- 1행: 일(KST) × 상권
-- 키: (kst_date, region)
-- 파티션·클러스터: kst_date / region
-- 원천: staging.dim_venue (등록일·상권), staging.dim_contract (계약 시작·종료), staging.int_contract_day (활성일 요금제·요금)
-- 소비: 공간 탭 스코어보드·등록/파트너 누적 추이·상권별 표. marts.monthly_summary, ops.reconciliation
-- 검사: C11·C15
--
-- registered_total = 그날까지 등록된 공간 누적(폐업 상태 공간 포함 — 원장에 폐업일이 없다).
-- partner_total = 그날 활성 계약이 있는 고유 공간 수. 활성 규칙은 staging.dim_contract 머리 주석.
-- new_contracts·churned_contracts = 그날 시작·종료한 계약 건수. mrr_* = 그날 활성 계약의 월 이용료 합(안분 전 월 기준).
-- 요금제·요금은 그날 값(요금제 변경 반영, staging.int_contract_day). 변경 건수는 marts.monthly_contract.
-- 날짜 범위: 첫 등록일 ~ 스냅샷 기준일, 모든 날 × 모든 상권 행을 채운다(누적 선이 끊기지 않게).
-- 전체 값은 상권 행을 더한다(공간은 상권 1개라 합 = 전체).

CREATE OR REPLACE TABLE marts.daily_venue_registry (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  region STRING OPTIONS(description='상권'),
  registered_total INT64 OPTIONS(description='그날까지 등록 공간 누적'),
  partner_total INT64 OPTIONS(description='그날 활성 파트너 공간 수'),
  new_registered INT64 OPTIONS(description='그날 등록 공간 수'),
  new_contracts INT64 OPTIONS(description='그날 시작 계약 수'),
  churned_contracts INT64 OPTIONS(description='그날 종료 계약 수'),
  mrr_basic INT64 OPTIONS(description='그날 활성 basic 계약 월 이용료 합 (원)'),
  mrr_pro INT64 OPTIONS(description='그날 활성 pro 계약 월 이용료 합 (원)')
)
PARTITION BY kst_date
CLUSTER BY region
OPTIONS(description='상권별 공간 등록·파트너 계약 일 마트. 1행 = 일 × 상권. 원천 staging.dim_venue·dim_contract·int_contract_day. 누적·활성·요금제는 그날 기준')
AS
WITH v AS (
  SELECT venue_id, region, registered_date, snapshot_date
  FROM staging.dim_venue
),
bounds AS (
  SELECT MIN(registered_date) AS lo, MAX(snapshot_date) AS hi
  FROM v
),
spine AS (
  SELECT d AS kst_date, r.region
  FROM bounds, UNNEST(GENERATE_DATE_ARRAY(lo, hi)) AS d
  CROSS JOIN (SELECT DISTINCT region FROM v) AS r
),
reg AS (
  SELECT registered_date AS kst_date, region, COUNT(*) AS n
  FROM v
  GROUP BY 1, 2
),
ct AS (
  SELECT dc.venue_id, dc.start_date, dc.end_date, v.region
  FROM staging.dim_contract AS dc
  JOIN v USING (venue_id)
),
contract_day AS (
  SELECT
    cd.kst_date,
    v.region,
    COUNT(DISTINCT cd.venue_id) AS partner_total,
    SUM(IF(cd.plan = 'basic', cd.monthly_fee, 0)) AS mrr_basic,
    SUM(IF(cd.plan = 'pro', cd.monthly_fee, 0)) AS mrr_pro
  FROM staging.int_contract_day AS cd
  JOIN v USING (venue_id)
  WHERE cd.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY 1, 2
),
started AS (
  SELECT start_date AS kst_date, region, COUNT(*) AS n
  FROM ct
  GROUP BY 1, 2
),
ended AS (
  SELECT end_date AS kst_date, region, COUNT(*) AS n
  FROM ct
  WHERE end_date IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  sp.kst_date,
  sp.region,
  SUM(COALESCE(reg.n, 0)) OVER (PARTITION BY sp.region ORDER BY sp.kst_date) AS registered_total,
  COALESCE(cd.partner_total, 0) AS partner_total,
  COALESCE(reg.n, 0) AS new_registered,
  COALESCE(st.n, 0) AS new_contracts,
  COALESCE(en.n, 0) AS churned_contracts,
  COALESCE(cd.mrr_basic, 0) AS mrr_basic,
  COALESCE(cd.mrr_pro, 0) AS mrr_pro
FROM spine AS sp
LEFT JOIN reg USING (kst_date, region)
LEFT JOIN contract_day AS cd USING (kst_date, region)
LEFT JOIN started AS st USING (kst_date, region)
LEFT JOIN ended AS en USING (kst_date, region);
