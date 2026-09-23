-- 표: staging.dim_venue — 공간 차원
-- 1행: 공간 1곳
-- 키: venue_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: raw.db_venues, raw.db_events
-- 소비: marts.daily_venue (공간 속성)

CREATE OR REPLACE TABLE staging.dim_venue (
  venue_id INT64 OPTIONS(description='공간 ID'),
  venue_name STRING OPTIONS(description='공간명 (가상)'),
  region STRING OPTIONS(description='지역'),
  genre STRING OPTIONS(description='대표 장르'),
  capacity_band STRING OPTIONS(description='수용 규모 S/M/L'),
  events INT64 OPTIONS(description='등록 행사 수')
)
OPTIONS(description='공간 차원. 1행 = 공간 1곳. 키 venue_id. 원천 raw.db_venues·db_events')
AS
SELECT
  v.venue_id,
  v.name AS venue_name,
  v.region,
  v.genre,
  v.capacity_band,
  (SELECT COUNT(*) FROM raw.db_events AS e WHERE e.venue_id = v.venue_id) AS events
FROM raw.db_venues AS v;
