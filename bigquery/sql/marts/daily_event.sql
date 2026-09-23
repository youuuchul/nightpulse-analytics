-- 표: marts.daily_event — 행사별 일 마트 (리스트 집계)
-- 1행: 일(KST) × 행사
-- 키: (kst_date, event_id)
-- 파티션·클러스터: kst_date / event_id
-- 원천: staging.events_clean·int_session (조회 흐름, 세션 시작일·사람 단위), staging.fct_order (원장, 신청일 기준), staging.dim_event (속성)
-- 소비: 행사 리스트, 행사 결제 퍼널 (상세 조회 → 신청 화면 → 신청 → 결제). 세그먼트 축 없음
--
-- 원장 열(applies·pay_count·pay_amount·cancels 등)은 신청일 기준이다. 그날 신청분이 나중에 취소돼도 신청일 행에 남는다.

CREATE OR REPLACE TABLE marts.daily_event (
  kst_date DATE OPTIONS(description='날짜 (KST). 조회는 세션 시작일, 원장은 신청일. 일 파티션'),
  event_id INT64 OPTIONS(description='행사 ID'),
  event_name STRING OPTIONS(description='행사명 (가상)'),
  venue_name STRING OPTIONS(description='공간명 (가상)'),
  event_type STRING OPTIONS(description='행사 유형'),
  price_tier STRING OPTIONS(description='가격대 free / standard / premium'),
  detail_viewers INT64 OPTIONS(description='행사 상세 조회 사람 수'),
  applies INT64 OPTIONS(description='신청 건수 (원장)'),
  pay_count INT64 OPTIONS(description='결제 완료 건수 (원장, 이후 환불 포함)'),
  pay_amount INT64 OPTIONS(description='그날 신청분 결제 금액 (원)'),
  cancels INT64 OPTIONS(description='그날 신청분 중 취소된 건수'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  start_date DATE OPTIONS(description='개최일 (KST)'),
  detail_views INT64 OPTIONS(description='행사 상세 조회 수'),
  apply_viewers INT64 OPTIONS(description='신청 화면 조회 사람 수'),
  promo_clicks INT64 OPTIONS(description='홈 배너 선택 수'),
  shares INT64 OPTIONS(description='공유 수'),
  paid_tier_applies INT64 OPTIONS(description='유료 행사 신청 건수 (원장) — 결제 전환 분모'),
  refund_amount INT64 OPTIONS(description='그날 신청분 환불액 (원)'),
  net_amount INT64 OPTIONS(description='그날 신청분 순매출 (원)')
)
PARTITION BY kst_date
CLUSTER BY event_id
OPTIONS(description='행사별 일 마트. 1행 = 일 × 행사. 원천 staging.events_clean·int_session·fct_order·dim_event')
AS
WITH ev AS (
  SELECT client_id, session_id, event_name, screen_name, event_id
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND event_id IS NOT NULL
    AND event_name IN ('screen_view', 'select_promotion', 'share')
),
s AS (
  SELECT client_id, session_id, session_date, person_id
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
views AS (
  SELECT
    s.session_date AS kst_date,
    ev.event_id,
    COUNTIF(ev.event_name = 'screen_view' AND ev.screen_name = 'event_detail') AS detail_views,
    COUNT(DISTINCT IF(ev.event_name = 'screen_view' AND ev.screen_name = 'event_detail', s.person_id, NULL)) AS detail_viewers,
    COUNT(DISTINCT IF(ev.event_name = 'screen_view' AND ev.screen_name = 'event_apply', s.person_id, NULL)) AS apply_viewers,
    COUNTIF(ev.event_name = 'select_promotion') AS promo_clicks,
    COUNTIF(ev.event_name = 'share') AS shares
  FROM ev
  JOIN s USING (client_id, session_id)
  GROUP BY 1, 2
),
orders AS (
  SELECT
    applied_date AS kst_date,
    event_id,
    COUNT(*) AS applications,
    COUNTIF(is_paid_tier) AS paid_tier_applications,
    COUNTIF(is_paid) AS paid_orders,
    COUNTIF(is_canceled) AS canceled,
    SUM(paid_amount) AS gross_amount,
    SUM(refund_amount) AS refund_amount,
    SUM(net_amount) AS net_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND kind = 'ticket'
  GROUP BY 1, 2
)
SELECT
  kst_date,
  event_id,
  d.event_name,
  d.venue_name,
  d.event_type,
  d.price_tier,
  COALESCE(v.detail_viewers, 0) AS detail_viewers,
  COALESCE(o.applications, 0) AS applies,
  COALESCE(o.paid_orders, 0) AS pay_count,
  COALESCE(o.gross_amount, 0) AS pay_amount,
  COALESCE(o.canceled, 0) AS cancels,
  d.venue_id,
  d.start_date,
  COALESCE(v.detail_views, 0) AS detail_views,
  COALESCE(v.apply_viewers, 0) AS apply_viewers,
  COALESCE(v.promo_clicks, 0) AS promo_clicks,
  COALESCE(v.shares, 0) AS shares,
  COALESCE(o.paid_tier_applications, 0) AS paid_tier_applies,
  COALESCE(o.refund_amount, 0) AS refund_amount,
  COALESCE(o.net_amount, 0) AS net_amount
FROM views AS v
FULL OUTER JOIN orders AS o USING (kst_date, event_id)
LEFT JOIN staging.dim_event AS d USING (event_id);
