-- 표: staging.fct_order — 주문(신청) 원장 정리
-- 1행: 신청 1건
-- 키: order_id
-- 파티션·클러스터: applied_date / event_id
-- 원천: raw.db_applications, raw.db_payments, raw.db_events
-- 소비: staging.dim_event, marts.daily_event·daily_venue·monthly_summary, ops.reconciliation
-- 검사: R5·R6·I4
--
-- 결제·신청·취소의 건수와 금액은 이 표(원장)에서 센다. 로그는 흐름을 보는 데만 쓴다.

CREATE OR REPLACE TABLE staging.fct_order (
  applied_date DATE OPTIONS(description='신청일 (KST). 일 파티션'),
  order_id STRING OPTIONS(description='주문 ID'),
  event_id INT64 OPTIONS(description='행사 ID'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  member_id STRING OPTIONS(description='회원 ID'),
  applied_at TIMESTAMP OPTIONS(description='신청 시각 (UTC)'),
  status STRING OPTIONS(description='신청 상태 applied / paid / payment_pending / canceled'),
  price_tier STRING OPTIONS(description='가격대 free / standard / premium'),
  is_paid_tier BOOL OPTIONS(description='유료 행사 신청인가'),
  is_paid BOOL OPTIONS(description='결제 완료 이력이 있는가 (환불 포함)'),
  paid_at TIMESTAMP OPTIONS(description='결제 시각 (UTC)'),
  paid_date DATE OPTIONS(description='결제일 (KST)'),
  paid_amount INT64 OPTIONS(description='결제 금액 (원)'),
  payment_status STRING OPTIONS(description='결제 상태 paid / refunded'),
  payment_method STRING OPTIONS(description='결제 수단'),
  is_canceled BOOL OPTIONS(description='취소된 신청인가'),
  cancel_at TIMESTAMP OPTIONS(description='취소 시각 (UTC)'),
  cancel_date DATE OPTIONS(description='취소일 (KST)'),
  refund_amount INT64 OPTIONS(description='환불액 (원)'),
  net_amount INT64 OPTIONS(description='순매출 = 결제 금액 - 환불액 (원)')
)
PARTITION BY applied_date
CLUSTER BY event_id
OPTIONS(description='주문 원장 정리. 1행 = 신청 1건. 키 order_id. 원천 raw.db_applications·db_payments·db_events')
AS
SELECT
  DATE(a.applied_at, 'Asia/Seoul') AS applied_date,
  a.order_id,
  a.event_id,
  e.venue_id,
  a.member_id,
  a.applied_at,
  a.status,
  e.price_tier,
  e.price_tier != 'free' AS is_paid_tier,
  p.order_id IS NOT NULL AS is_paid,
  p.paid_at,
  DATE(p.paid_at, 'Asia/Seoul') AS paid_date,
  COALESCE(p.amount, 0) AS paid_amount,
  p.status AS payment_status,
  p.method AS payment_method,
  a.status = 'canceled' AS is_canceled,
  a.cancel_at,
  DATE(a.cancel_at, 'Asia/Seoul') AS cancel_date,
  COALESCE(a.cancel_amount, 0) AS refund_amount,
  COALESCE(p.amount, 0) - COALESCE(a.cancel_amount, 0) AS net_amount
FROM raw.db_applications AS a
LEFT JOIN raw.db_payments AS p USING (order_id)
LEFT JOIN raw.db_events AS e USING (event_id);
