-- 표: marts.contract_cohort — 파트너 계약 시작 월 코호트 유지
-- 1행: 코호트 월(계약 시작 월) × 경과 월(0~12)
-- 키: (cohort_month, month_offset)
-- 파티션·클러스터: DATE_TRUNC(cohort_month, MONTH) / 없음
-- 원천: staging.dim_contract (시작일·스냅샷 기준일), staging.int_contract_day (확인일 활성·요금)
-- 소비: 공간 탭 계약 코호트 히트맵
--
-- 계약마다 확인일 = 시작일 + n개월(월말을 넘으면 그 달 마지막 날). 그날 활성(int_contract_day 행 있음)이면 retained,
--   mrr_retained 는 그날 월 이용료 합(요금제 변경 반영 — 업그레이드로 100% 를 넘을 수 있다).
-- 0개월 확인일 = 시작일이라 retained = cohort_size.
-- 코호트 전원의 확인일이 관측된 칸만 둔다: (코호트 월 마지막 날 + n개월) <= 스냅샷 기준일. 채워지지 않은 칸은 행이 없다.
-- cohort_size 는 경과 월과 무관하게 같은 값이 반복된다.

CREATE OR REPLACE TABLE marts.contract_cohort (
  cohort_month DATE OPTIONS(description='코호트 월 = 계약 시작 월 (1일). 월 파티션'),
  month_offset INT64 OPTIONS(description='경과 월 0~12'),
  cohort_size INT64 OPTIONS(description='그 달 시작 계약 수'),
  retained INT64 OPTIONS(description='확인일(시작일 + n개월)에 활성인 계약 수'),
  mrr_retained INT64 OPTIONS(description='그 계약들의 확인일 월 이용료 합 (원)')
)
PARTITION BY DATE_TRUNC(cohort_month, MONTH)
OPTIONS(description='파트너 계약 시작 월 코호트 유지. 1행 = 코호트 월 × 경과 월(0~12). 원천 staging.dim_contract·int_contract_day. 전원 관측된 칸만')
AS
WITH c AS (
  SELECT contract_id, start_date, DATE_TRUNC(start_date, MONTH) AS cohort_month, snapshot_date
  FROM staging.dim_contract
),
size AS (
  SELECT cohort_month, COUNT(*) AS cohort_size
  FROM c
  GROUP BY 1
),
checks AS (
  SELECT c.contract_id, c.cohort_month, n AS month_offset, DATE_ADD(c.start_date, INTERVAL n MONTH) AS check_date
  FROM c, UNNEST(GENERATE_ARRAY(0, 12)) AS n
  WHERE DATE_ADD(LAST_DAY(c.cohort_month, MONTH), INTERVAL n MONTH) <= c.snapshot_date
)
SELECT
  k.cohort_month,
  k.month_offset,
  ANY_VALUE(s.cohort_size) AS cohort_size,
  COUNT(cd.contract_id) AS retained,
  COALESCE(SUM(cd.monthly_fee), 0) AS mrr_retained
FROM checks AS k
JOIN size AS s USING (cohort_month)
LEFT JOIN staging.int_contract_day AS cd
  ON cd.contract_id = k.contract_id
  AND cd.kst_date = k.check_date
  AND cd.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY 1, 2;
