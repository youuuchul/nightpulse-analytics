-- 표: marts.daily_revenue — 매출 종류별 일 마트
-- 1행: 일(KST) × 매출 종류 × 파트너 여부(티켓만)
-- 키: (kst_date, kind, partner_flag)
-- 파티션·클러스터: kst_date / kind
-- 원천: staging.fct_order (티켓·구독 결제, 결제일 기준), staging.dim_contract (B2B 계약)
-- 소비: 개요 매출 타일·매출 구성 추이, 행사·결제 탭 매출 구성 보기. marts.monthly_summary, ops.reconciliation
-- 검사: C9
--
-- kind
--   ticket        행사 티켓 결제. partner_flag = 개최 시점 파트너 공간 여부(TRUE/FALSE 두 행)
--   subscription  소비자 구독 결제. partner_flag NULL
--   b2b           파트너 계약 월 이용료를 일 단위로 안분: 활성일마다 monthly_fee ÷ 그 달 일수. partner_flag NULL
--                 한 달 내내 활성인 계약은 그 달 합이 monthly_fee 와 같다(일별 합을 원 단위로 반올림해 몇 원 차이 가능)
-- 금액: gross_amount = 정가(실결제액 + 할인액), net_amount = gross - discount - refund.
--       티켓 환불은 결제일 행에 붙인다(취소일이 아니다). b2b 는 할인·환불 0
-- 건수: pay_count = 결제 건수(b2b 는 그날 활성 계약 수), payers = 고유 회원 수(b2b 는 고유 공간 수)
-- 사람 세그먼트 축이 없다. 매출 비교는 기간 합으로 한다.

CREATE OR REPLACE TABLE marts.daily_revenue (
  kst_date DATE OPTIONS(description='날짜 (KST, 결제일·계약 활성일). 일 파티션'),
  kind STRING OPTIONS(description='매출 종류 ticket / subscription / b2b'),
  partner_flag BOOL OPTIONS(description='파트너 공간 행사 여부 (ticket 만, 나머지 NULL)'),
  pay_count INT64 OPTIONS(description='결제 건수 (b2b = 활성 계약 수)'),
  gross_amount INT64 OPTIONS(description='정가 합 = 실결제액 + 할인액 (원)'),
  discount_amount INT64 OPTIONS(description='할인액 합 (원)'),
  refund_amount INT64 OPTIONS(description='환불액 합 (원, 결제일 기준)'),
  net_amount INT64 OPTIONS(description='순매출 = gross - discount - refund (원)'),
  payers INT64 OPTIONS(description='고유 결제 회원 수 (b2b = 고유 공간 수)')
)
PARTITION BY kst_date
CLUSTER BY kind
OPTIONS(description='매출 종류별 일 마트. 1행 = 일 × kind(ticket/subscription/b2b) × partner_flag. 원천 staging.fct_order·dim_contract. B2B = 활성 계약 월 요금 ÷ 그 달 일수')
AS
WITH paid AS (
  SELECT
    paid_date AS kst_date,
    kind,
    IF(kind = 'ticket', COALESCE(is_partner_venue, FALSE), NULL) AS partner_flag,
    member_id,
    paid_amount,
    discount_amount,
    refund_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND is_paid
),
contract_day AS (
  SELECT
    d AS kst_date,
    venue_id,
    monthly_fee / EXTRACT(DAY FROM LAST_DAY(d, MONTH)) AS day_fee
  FROM staging.dim_contract,
    UNNEST(GENERATE_DATE_ARRAY(start_date, LEAST(COALESCE(DATE_SUB(end_date, INTERVAL 1 DAY), snapshot_date), snapshot_date))) AS d
)
SELECT
  kst_date,
  kind,
  partner_flag,
  COUNT(*) AS pay_count,
  SUM(paid_amount + discount_amount) AS gross_amount,
  SUM(discount_amount) AS discount_amount,
  SUM(refund_amount) AS refund_amount,
  SUM(paid_amount - refund_amount) AS net_amount,
  COUNT(DISTINCT member_id) AS payers
FROM paid
GROUP BY kst_date, kind, partner_flag
UNION ALL
SELECT
  kst_date,
  'b2b' AS kind,
  CAST(NULL AS BOOL) AS partner_flag,
  COUNT(*) AS pay_count,
  CAST(ROUND(SUM(day_fee)) AS INT64) AS gross_amount,
  0 AS discount_amount,
  0 AS refund_amount,
  CAST(ROUND(SUM(day_fee)) AS INT64) AS net_amount,
  COUNT(DISTINCT venue_id) AS payers
FROM contract_day
GROUP BY kst_date;
