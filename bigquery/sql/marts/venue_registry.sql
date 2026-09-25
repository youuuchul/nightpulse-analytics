-- 표: marts.venue_registry — 공간 목록 (기준일 스냅샷, 리스트 집계)
-- 1행: 공간 1곳
-- 키: venue_id
-- 파티션·클러스터: 없음 / region
-- 원천: staging.dim_venue (속성·파트너 여부·요금제·계약일), staging.dim_event (개최 행사), staging.fct_order (티켓 매출),
--       staging.events_clean·int_session (공간 상세 조회 사람)
-- 소비: 공간 탭 서울 분포 지도(좌표·28일 조회·파트너 여부)·상권별 표·파트너 공간 표, ops.reconciliation. 기간 필터를 받지 않는 기준일 고정 표
--
-- 기준일(as_of_date) = 원장 스냅샷 기준일. 창은 기준일 포함 역산:
--   events_365d          개최일이 (기준일 - 364일) ~ 기준일인 행사 수
--   ticket_amount_365d   결제일이 같은 창인 그 공간 행사 티켓 순매출(실결제액 - 환불)
--   detail_viewers_28d   세션 시작일이 (기준일 - 27일) ~ 기준일인 공간 상세 조회 고유 사람 수
-- 파트너 여부·요금제·계약일은 기준일 활성 계약(없으면 가장 최근 계약) — staging.dim_venue 규칙.
-- 날짜 열 registered_at·contract_started_at·contract_ended_at 는 화면 계약 이름을 따르되 값은 KST 날짜(DATE)다.

CREATE OR REPLACE TABLE marts.venue_registry (
  venue_id INT64 OPTIONS(description='공간 ID'),
  name STRING OPTIONS(description='공간명 (가상)'),
  region STRING OPTIONS(description='상권'),
  district STRING OPTIONS(description='구'),
  lat FLOAT64 OPTIONS(description='위도'),
  lng FLOAT64 OPTIONS(description='경도'),
  genre STRING OPTIONS(description='대표 장르'),
  venue_type STRING OPTIONS(description='공간 유형'),
  capacity_band STRING OPTIONS(description='수용 규모 S/M/L/XL'),
  registered_at DATE OPTIONS(description='등록일 (KST)'),
  is_partner BOOL OPTIONS(description='기준일 활성 파트너 계약 여부'),
  plan STRING OPTIONS(description='요금제 basic / pro (현재 또는 가장 최근 계약, 이력 없으면 NULL)'),
  contract_started_at DATE OPTIONS(description='그 계약 시작일 (KST)'),
  contract_ended_at DATE OPTIONS(description='그 계약 종료일 (KST). NULL = 진행 중 또는 이력 없음'),
  events_365d INT64 OPTIONS(description='기준일까지 365일 개최 행사 수'),
  ticket_amount_365d INT64 OPTIONS(description='기준일까지 365일 티켓 순매출 (원)'),
  detail_viewers_28d INT64 OPTIONS(description='기준일까지 28일 공간 상세 조회 고유 사람 수'),
  status STRING OPTIONS(description='공간 상태 active / closed'),
  as_of_date DATE OPTIONS(description='기준일 (원장 스냅샷)')
)
CLUSTER BY region
OPTIONS(description='공간 목록 기준일 스냅샷. 1행 = 공간 1곳. 원천 staging.dim_venue·dim_event·fct_order·events_clean·int_session. 365일 행사·매출, 28일 상세 조회 사람')
AS
WITH asof AS (
  SELECT MAX(snapshot_date) AS d
  FROM staging.dim_venue
),
ev AS (
  SELECT e.venue_id, COUNT(*) AS n
  FROM staging.dim_event AS e, asof
  WHERE e.start_date BETWEEN DATE_SUB(asof.d, INTERVAL 364 DAY) AND asof.d
  GROUP BY 1
),
amt AS (
  SELECT o.venue_id, SUM(o.net_amount) AS amount
  FROM staging.fct_order AS o, asof
  WHERE o.applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND o.kind = 'ticket'
    AND o.is_paid
    AND o.paid_date BETWEEN DATE_SUB(asof.d, INTERVAL 364 DAY) AND asof.d
  GROUP BY 1
),
views AS (
  SELECT ec.venue_id, COUNT(DISTINCT s.person_id) AS viewers
  FROM staging.events_clean AS ec
  JOIN staging.int_session AS s USING (client_id, session_id)
  CROSS JOIN asof
  WHERE ec.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND s.session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND ec.event_name = 'screen_view'
    AND ec.screen_name = 'venue_detail'
    AND ec.venue_id IS NOT NULL
    AND s.session_date BETWEEN DATE_SUB(asof.d, INTERVAL 27 DAY) AND asof.d
  GROUP BY 1
)
SELECT
  v.venue_id,
  v.venue_name AS name,
  v.region,
  v.district,
  v.lat,
  v.lng,
  v.genre,
  v.venue_type,
  v.capacity_band,
  v.registered_date AS registered_at,
  v.is_partner,
  v.plan,
  v.contract_start_date AS contract_started_at,
  v.contract_end_date AS contract_ended_at,
  COALESCE(ev.n, 0) AS events_365d,
  COALESCE(amt.amount, 0) AS ticket_amount_365d,
  COALESCE(views.viewers, 0) AS detail_viewers_28d,
  v.status,
  asof.d AS as_of_date
FROM staging.dim_venue AS v
CROSS JOIN asof
LEFT JOIN ev USING (venue_id)
LEFT JOIN amt USING (venue_id)
LEFT JOIN views USING (venue_id);
