-- 표: marts.daily_subscription — 구독 일 마트
-- 1행: 일(KST)
-- 키: kst_date
-- 파티션·클러스터: kst_date / 없음
-- 원천: staging.dim_subscription (구독 원장), staging.fct_order (구독자의 티켓 결제, 결제일 기준)
-- 소비: 회원 탭 구독 보기 스코어보드·추이·구독자 결제 비교, 개요 기준일 구독자. marts.monthly_summary, ops.reconciliation
-- 검사: C10
--
-- 활성 규칙은 staging.dim_subscription 머리 주석(start_date <= d < end_date, KST).
-- active_subscribers = 그날 활성 구독이 있는 고유 회원 수. new·churned 는 구독 건수(그날 시작·그날 종료).
-- mrr = 그날 활성 구독의 월 구독료 합(안분하지 않은 월 기준 값). 실제 구독 매출은 daily_revenue kind = subscription.
-- 이탈률은 저장하지 않는다. 화면에서 기간 churned ÷ 기간 시작일 active_subscribers 로 계산한다.
-- 구독자 티켓 결제 = 결제일에 활성 구독이 있던 회원의 티켓 결제(환불 차감 순매출). 비구독 회원 값은 daily_revenue ticket 에서 뺀다.
-- discount_amount = 그날(결제일) 티켓 멤버 할인 합, 환불 주문 제외. 할인은 플랫폼 부담이라 멤버십 순기여에서 뺀다.
--   daily_revenue ticket 의 discount_amount 일 합과 같다(할인은 결제 시점 구독자에게만 붙는다).
-- 날짜 범위: 첫 구독 시작일 ~ 스냅샷 기준일. 행이 없는 날은 없다(0 으로 채운다).

CREATE OR REPLACE TABLE marts.daily_subscription (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  active_subscribers INT64 OPTIONS(description='그날 활성 구독 회원 수'),
  new_subscribers INT64 OPTIONS(description='그날 시작한 구독 수'),
  churned_subscribers INT64 OPTIONS(description='그날 종료한 구독 수'),
  mrr INT64 OPTIONS(description='그날 활성 구독의 월 구독료 합 (원)'),
  subscriber_ticket_payers INT64 OPTIONS(description='그날 티켓을 결제한 활성 구독 회원 수'),
  subscriber_ticket_amount INT64 OPTIONS(description='활성 구독 회원의 그날 티켓 순매출 (원, 실결제액 - 환불)'),
  discount_amount INT64 OPTIONS(description='그날 티켓 멤버 할인 합 (원, 환불 주문 제외, 플랫폼 부담)')
)
PARTITION BY kst_date
OPTIONS(description='구독 일 마트. 1행 = 일. 원천 staging.dim_subscription·fct_order. 활성 = start_date <= d < end_date')
AS
WITH bounds AS (
  SELECT MIN(start_date) AS lo, MAX(snapshot_date) AS hi
  FROM staging.dim_subscription
),
spine AS (
  SELECT d AS kst_date
  FROM bounds, UNNEST(GENERATE_DATE_ARRAY(lo, hi)) AS d
),
sub_day AS (
  SELECT d AS kst_date, member_id, price
  FROM staging.dim_subscription,
    UNNEST(GENERATE_DATE_ARRAY(start_date, LEAST(COALESCE(DATE_SUB(end_date, INTERVAL 1 DAY), snapshot_date), snapshot_date))) AS d
),
active AS (
  SELECT kst_date, COUNT(DISTINCT member_id) AS active_subscribers, SUM(price) AS mrr
  FROM sub_day
  GROUP BY kst_date
),
started AS (
  SELECT start_date AS kst_date, COUNT(*) AS n
  FROM staging.dim_subscription
  GROUP BY 1
),
ended AS (
  SELECT end_date AS kst_date, COUNT(*) AS n
  FROM staging.dim_subscription
  WHERE end_date IS NOT NULL
  GROUP BY 1
),
sub_member_day AS (
  SELECT DISTINCT kst_date, member_id
  FROM sub_day
),
sub_ticket AS (
  SELECT
    o.paid_date AS kst_date,
    COUNT(DISTINCT o.member_id) AS payers,
    SUM(o.net_amount) AS amount
  FROM staging.fct_order AS o
  JOIN sub_member_day AS s ON s.member_id = o.member_id AND s.kst_date = o.paid_date
  WHERE o.applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND o.kind = 'ticket'
    AND o.is_paid
  GROUP BY 1
),
disc AS (
  SELECT paid_date AS kst_date, SUM(discount_amount) AS amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND kind = 'ticket'
    AND is_paid
    AND refund_amount = 0
  GROUP BY 1
)
SELECT
  sp.kst_date,
  COALESCE(a.active_subscribers, 0) AS active_subscribers,
  COALESCE(st.n, 0) AS new_subscribers,
  COALESCE(en.n, 0) AS churned_subscribers,
  COALESCE(a.mrr, 0) AS mrr,
  COALESCE(t.payers, 0) AS subscriber_ticket_payers,
  COALESCE(t.amount, 0) AS subscriber_ticket_amount,
  COALESCE(di.amount, 0) AS discount_amount
FROM spine AS sp
LEFT JOIN active AS a USING (kst_date)
LEFT JOIN started AS st USING (kst_date)
LEFT JOIN ended AS en USING (kst_date)
LEFT JOIN sub_ticket AS t USING (kst_date)
LEFT JOIN disc AS di USING (kst_date);
