-- 표: marts.monthly_contract — 파트너 계약 월 흐름 (계약 수·플랜 MRR 다리)
-- 1행: 월(KST) × 요금제(basic / pro / all)
-- 키: (month, plan)
-- 파티션·클러스터: DATE_TRUNC(month, MONTH) / plan
-- 원천: staging.dim_contract (계약 시작·종료), staging.int_contract_day (날짜별 요금제·요금),
--       staging.dim_contract_change (요금제 변경)
-- 소비: 공간 탭 ARPA·계약 월 해지율·매출 해지율·GRR·NRR, ops.reconciliation
-- 검사: C15
--
-- 월 경계: 월초(bom) = 전월 마지막 날 상태, 월말(eom) = 그 달 마지막 날(진행 중인 달은 스냅샷 기준일) 상태.
--   그래서 이번 달 bom = 전월 eom 이고, 1일에 종료한 계약은 그 달 해지로 센다. 활성 규칙은 staging.dim_contract.
-- 신규 = 그 달 시작 계약(시작일 요금제·요금), 해지 = 그 달 종료 계약(마지막 활성일 요금제·요금),
--   변경 = 그 달 적용된 요금제 변경(staging.dim_contract_change, 계약 기간 안의 변경만).
-- plan = all 행: upgrades·downgrades = 변경 건수, mrr_expansion = 업그레이드 요금 증가분 합, mrr_contraction = 다운그레이드 감소분 합.
--   다리: contracts_eom = contracts_bom + new_contracts - churned_contracts
--         mrr_eom = mrr_bom + mrr_new + mrr_expansion - mrr_contraction - mrr_churn
--   GRR = (mrr_bom - mrr_churn - mrr_contraction) ÷ mrr_bom, NRR = GRR 분자 + mrr_expansion, ÷ mrr_bom. all 행에서만 계산한다.
-- plan = basic·pro 행: 요금제를 구간으로 보고 변경을 이동으로 센다. mrr_expansion = 이 요금제로 옮겨 온 계약의 새 요금 합,
--   mrr_contraction = 이 요금제에서 빠져나간 계약의 이전 요금 합, upgrades·downgrades = 이 요금제가 한쪽인 변경 건수.
--   MRR 다리는 요금제 행에서도 성립한다(계약 수 다리는 이동 방향이 요금제마다 달라 all 행만).
-- arpa = ROUND(mrr_eom ÷ contracts_eom) (원, 활성 계약 0 이면 NULL). 날짜 범위: 첫 계약 월 ~ 스냅샷 기준일이 속한 월.

CREATE OR REPLACE TABLE marts.monthly_contract (
  month DATE OPTIONS(description='월 (1일). 월 파티션'),
  plan STRING OPTIONS(description='요금제 basic / pro / all(전체)'),
  contracts_bom INT64 OPTIONS(description='월초 활성 계약 수 (전월 마지막 날)'),
  new_contracts INT64 OPTIONS(description='그 달 시작 계약 수'),
  churned_contracts INT64 OPTIONS(description='그 달 종료 계약 수'),
  upgrades INT64 OPTIONS(description='그 달 업그레이드 건수 (요금제 행은 그 요금제가 한쪽인 건)'),
  downgrades INT64 OPTIONS(description='그 달 다운그레이드 건수 (요금제 행은 그 요금제가 한쪽인 건)'),
  contracts_eom INT64 OPTIONS(description='월말 활성 계약 수 (그 달 마지막 날 또는 기준일)'),
  mrr_bom INT64 OPTIONS(description='월초 플랜 MRR (원)'),
  mrr_new INT64 OPTIONS(description='신규 계약 MRR (원, 시작일 요금)'),
  mrr_expansion INT64 OPTIONS(description='확장 MRR (원). all = 업그레이드 증가분, 요금제 행 = 옮겨 온 요금'),
  mrr_contraction INT64 OPTIONS(description='축소 MRR (원). all = 다운그레이드 감소분, 요금제 행 = 빠져나간 요금'),
  mrr_churn INT64 OPTIONS(description='해지 MRR (원, 마지막 활성일 요금)'),
  mrr_eom INT64 OPTIONS(description='월말 플랜 MRR (원)'),
  arpa INT64 OPTIONS(description='계약당 월 요금 = mrr_eom ÷ contracts_eom (원, 반올림)')
)
PARTITION BY DATE_TRUNC(month, MONTH)
CLUSTER BY plan
OPTIONS(description='파트너 계약 월 흐름. 1행 = 월 × 요금제(basic/pro/all). 원천 staging.dim_contract·int_contract_day·dim_contract_change. 계약 수·플랜 MRR 다리')
AS
WITH bounds AS (
  SELECT DATE_TRUNC(MIN(start_date), MONTH) AS lo, MAX(snapshot_date) AS hi
  FROM staging.dim_contract
),
months AS (
  SELECT
    m AS month,
    DATE_SUB(m, INTERVAL 1 DAY) AS bom_day,
    LEAST(LAST_DAY(m, MONTH), hi) AS eom_day
  FROM bounds, UNNEST(GENERATE_DATE_ARRAY(lo, DATE_TRUNC(hi, MONTH), INTERVAL 1 MONTH)) AS m
),
cday AS (
  SELECT kst_date, contract_id, plan, monthly_fee
  FROM staging.int_contract_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
plans AS (
  SELECT DISTINCT plan FROM cday
  UNION DISTINCT
  SELECT DISTINCT plan FROM staging.dim_contract
),
bom AS (
  SELECT m.month, c.plan, COUNT(*) AS n, SUM(c.monthly_fee) AS mrr
  FROM months AS m
  JOIN cday AS c ON c.kst_date = m.bom_day
  GROUP BY 1, 2
),
eom AS (
  SELECT m.month, c.plan, COUNT(*) AS n, SUM(c.monthly_fee) AS mrr
  FROM months AS m
  JOIN cday AS c ON c.kst_date = m.eom_day
  GROUP BY 1, 2
),
started AS (
  SELECT m.month, COALESCE(c.plan, dc.plan) AS plan, COUNT(*) AS n, SUM(COALESCE(c.monthly_fee, dc.monthly_fee)) AS mrr
  FROM staging.dim_contract AS dc
  JOIN months AS m ON dc.start_date BETWEEN m.month AND m.eom_day
  LEFT JOIN cday AS c ON c.contract_id = dc.contract_id AND c.kst_date = dc.start_date
  GROUP BY 1, 2
),
ended AS (
  SELECT m.month, COALESCE(c.plan, dc.plan) AS plan, COUNT(*) AS n, SUM(COALESCE(c.monthly_fee, dc.monthly_fee)) AS mrr
  FROM staging.dim_contract AS dc
  JOIN months AS m ON dc.end_date BETWEEN m.month AND m.eom_day
  LEFT JOIN cday AS c ON c.contract_id = dc.contract_id AND c.kst_date = DATE_SUB(dc.end_date, INTERVAL 1 DAY)
  GROUP BY 1, 2
),
chg AS (
  SELECT m.month, ch.from_plan, ch.to_plan, ch.from_fee, ch.to_fee, ch.direction
  FROM staging.dim_contract_change AS ch
  JOIN months AS m ON ch.change_date BETWEEN m.month AND m.eom_day
),
plan_moves AS (
  SELECT
    month,
    plan,
    COUNTIF(direction = 'upgrade') AS upgrades,
    COUNTIF(direction = 'downgrade') AS downgrades,
    SUM(mrr_in) AS mrr_in,
    SUM(mrr_out) AS mrr_out
  FROM (
    SELECT month, to_plan AS plan, direction, to_fee AS mrr_in, 0 AS mrr_out FROM chg
    UNION ALL
    SELECT month, from_plan AS plan, direction, 0 AS mrr_in, from_fee AS mrr_out FROM chg
  )
  GROUP BY 1, 2
),
all_moves AS (
  SELECT
    month,
    COUNTIF(direction = 'upgrade') AS upgrades,
    COUNTIF(direction = 'downgrade') AS downgrades,
    SUM(GREATEST(to_fee - from_fee, 0)) AS mrr_expansion,
    SUM(GREATEST(from_fee - to_fee, 0)) AS mrr_contraction
  FROM chg
  GROUP BY 1
),
by_plan AS (
  SELECT
    m.month,
    p.plan,
    COALESCE(b.n, 0) AS contracts_bom,
    COALESCE(s.n, 0) AS new_contracts,
    COALESCE(e.n, 0) AS churned_contracts,
    COALESCE(mv.upgrades, 0) AS upgrades,
    COALESCE(mv.downgrades, 0) AS downgrades,
    COALESCE(x.n, 0) AS contracts_eom,
    COALESCE(b.mrr, 0) AS mrr_bom,
    COALESCE(s.mrr, 0) AS mrr_new,
    COALESCE(mv.mrr_in, 0) AS mrr_expansion,
    COALESCE(mv.mrr_out, 0) AS mrr_contraction,
    COALESCE(e.mrr, 0) AS mrr_churn,
    COALESCE(x.mrr, 0) AS mrr_eom
  FROM months AS m
  CROSS JOIN plans AS p
  LEFT JOIN bom AS b ON b.month = m.month AND b.plan = p.plan
  LEFT JOIN started AS s ON s.month = m.month AND s.plan = p.plan
  LEFT JOIN ended AS e ON e.month = m.month AND e.plan = p.plan
  LEFT JOIN plan_moves AS mv ON mv.month = m.month AND mv.plan = p.plan
  LEFT JOIN eom AS x ON x.month = m.month AND x.plan = p.plan
),
all_plan AS (
  SELECT
    bp.month,
    'all' AS plan,
    SUM(bp.contracts_bom) AS contracts_bom,
    SUM(bp.new_contracts) AS new_contracts,
    SUM(bp.churned_contracts) AS churned_contracts,
    ANY_VALUE(COALESCE(am.upgrades, 0)) AS upgrades,
    ANY_VALUE(COALESCE(am.downgrades, 0)) AS downgrades,
    SUM(bp.contracts_eom) AS contracts_eom,
    SUM(bp.mrr_bom) AS mrr_bom,
    SUM(bp.mrr_new) AS mrr_new,
    ANY_VALUE(COALESCE(am.mrr_expansion, 0)) AS mrr_expansion,
    ANY_VALUE(COALESCE(am.mrr_contraction, 0)) AS mrr_contraction,
    SUM(bp.mrr_churn) AS mrr_churn,
    SUM(bp.mrr_eom) AS mrr_eom
  FROM by_plan AS bp
  LEFT JOIN all_moves AS am USING (month)
  GROUP BY bp.month
)
SELECT
  *,
  CAST(ROUND(SAFE_DIVIDE(mrr_eom, contracts_eom)) AS INT64) AS arpa
FROM (
  SELECT * FROM by_plan
  UNION ALL
  SELECT * FROM all_plan
);
