-- 표: marts.daily_venue — 공간별 일 마트 (리스트 집계)
-- 1행: 일(KST) × 공간
-- 키: (kst_date, venue_id)
-- 파티션·클러스터: kst_date / venue_id
-- 원천: staging.events_clean·int_session (공간 상세·리뷰 조회, 세션 시작일·사람 단위), staging.fct_order (그 공간 행사의 신청, 신청일 기준), staging.dim_venue
-- 소비: 공간 상위 N 표. 단위가 공간이므로 사람 세그먼트 축이 없다

CREATE OR REPLACE TABLE marts.daily_venue (
  kst_date DATE OPTIONS(description='날짜 (KST). 조회는 세션 시작일, 원장은 신청일. 일 파티션'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  venue_name STRING OPTIONS(description='공간명 (가상)'),
  region STRING OPTIONS(description='지역'),
  genre STRING OPTIONS(description='대표 장르'),
  detail_viewers INT64 OPTIONS(description='공간 상세 조회 사람 수'),
  applies INT64 OPTIONS(description='그 공간 행사 신청 건수 (원장, 신청일 기준)'),
  pay_count INT64 OPTIONS(description='그 공간 행사 결제 완료 건수 (원장, 신청일 기준)'),
  capacity_band STRING OPTIONS(description='수용 규모'),
  detail_views INT64 OPTIONS(description='공간 상세 조회 수'),
  review_views INT64 OPTIONS(description='공간 리뷰 조회 수'),
  shares INT64 OPTIONS(description='공간 공유 수'),
  net_amount INT64 OPTIONS(description='그 공간 행사 순매출 (원)')
)
PARTITION BY kst_date
CLUSTER BY venue_id
OPTIONS(description='공간별 일 마트. 1행 = 일 × 공간. 원천 staging.events_clean·int_session·fct_order·dim_venue')
AS
WITH ev AS (
  SELECT client_id, session_id, event_name, screen_name, venue_id
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND venue_id IS NOT NULL
    AND event_name IN ('screen_view', 'share')
),
s AS (
  SELECT client_id, session_id, session_date, person_id
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
views AS (
  SELECT
    s.session_date AS kst_date,
    ev.venue_id,
    COUNTIF(ev.event_name = 'screen_view' AND ev.screen_name = 'venue_detail') AS detail_views,
    COUNT(DISTINCT IF(ev.event_name = 'screen_view' AND ev.screen_name = 'venue_detail', s.person_id, NULL)) AS detail_viewers,
    COUNTIF(ev.event_name = 'screen_view' AND ev.screen_name = 'venue_review') AS review_views,
    COUNTIF(ev.event_name = 'share') AS shares
  FROM ev
  JOIN s USING (client_id, session_id)
  GROUP BY 1, 2
),
orders AS (
  SELECT
    applied_date AS kst_date,
    venue_id,
    COUNT(*) AS applications,
    COUNTIF(is_paid) AS paid_orders,
    SUM(net_amount) AS net_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY 1, 2
)
SELECT
  kst_date,
  venue_id,
  d.venue_name,
  d.region,
  d.genre,
  COALESCE(v.detail_viewers, 0) AS detail_viewers,
  COALESCE(o.applications, 0) AS applies,
  COALESCE(o.paid_orders, 0) AS pay_count,
  d.capacity_band,
  COALESCE(v.detail_views, 0) AS detail_views,
  COALESCE(v.review_views, 0) AS review_views,
  COALESCE(v.shares, 0) AS shares,
  COALESCE(o.net_amount, 0) AS net_amount
FROM views AS v
FULL OUTER JOIN orders AS o USING (kst_date, venue_id)
LEFT JOIN staging.dim_venue AS d USING (venue_id);
