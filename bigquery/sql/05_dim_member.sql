-- 표: staging.dim_member — 회원 차원
-- 1행: 회원 1명
-- 키: member_id
-- 파티션·클러스터: 없음 / member_id
-- 원천: raw.db_members (속성의 진실), staging.int_session (첫 유입·첫 방문을 로그에서 역산)
-- 소비: marts.weekly_cohort·monthly_cohort·weekly_activity·monthly_summary·weekly_audience_funnel·weekly_path (가입일),
--       회원 탭 분포, 애드혹 분석

CREATE OR REPLACE TABLE staging.dim_member (
  member_id STRING OPTIONS(description='회원 ID'),
  signed_up_at TIMESTAMP OPTIONS(description='가입 시각 (UTC)'),
  signup_date DATE OPTIONS(description='가입일 (KST)'),
  region STRING OPTIONS(description='관심 지역'),
  genre_tags STRING OPTIONS(description='취향 장르, | 구분'),
  marketing_opt_in BOOL OPTIONS(description='마케팅 수신 동의'),
  first_visit_date DATE OPTIONS(description='첫 방문일 (KST, 자동 로드 제외, 로그 역산)'),
  days_to_signup INT64 OPTIONS(description='첫 방문 → 가입 일수'),
  channel1 STRING OPTIONS(description='첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='첫 방문 기기 플랫폼'),
  first_session_channel2 STRING OPTIONS(description='첫 방문 세션의 유입 유형'),
  first_session_channel3 STRING OPTIONS(description='첫 방문 세션의 플랫폼'),
  signup_session_channel2 STRING OPTIONS(description='가입 세션의 유입 유형'),
  devices INT64 OPTIONS(description='로그에서 관측된 기기 수'),
  snapshot_date DATE OPTIONS(description='원장 스냅샷 기준일')
)
CLUSTER BY member_id
OPTIONS(description='회원 차원. 1행 = 회원 1명. 키 member_id. 원천 raw.db_members + staging.int_session(첫 유입 역산)')
AS
WITH s AS (
  SELECT person_id, client_id, started_at, is_auto_load, is_person_first_session, sign_ups,
         session_date, first_channel, device_platform, session_channel2, session_channel3
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
first_s AS (
  SELECT person_id, session_date AS first_visit_date, first_channel, device_platform,
         session_channel2, session_channel3
  FROM s
  WHERE is_person_first_session
),
signup_s AS (
  SELECT person_id, ARRAY_AGG(session_channel2 ORDER BY started_at LIMIT 1)[OFFSET(0)] AS channel2
  FROM s
  WHERE sign_ups > 0
  GROUP BY person_id
),
dev AS (
  SELECT person_id, COUNT(DISTINCT client_id) AS devices
  FROM s
  GROUP BY person_id
)
SELECT
  m.member_id,
  m.signed_up_at,
  DATE(m.signed_up_at, 'Asia/Seoul') AS signup_date,
  m.region,
  m.genre_tags,
  m.marketing_opt_in,
  f.first_visit_date,
  DATE_DIFF(DATE(m.signed_up_at, 'Asia/Seoul'), f.first_visit_date, DAY) AS days_to_signup,
  f.first_channel AS channel1,
  f.device_platform,
  f.session_channel2 AS first_session_channel2,
  f.session_channel3 AS first_session_channel3,
  su.channel2 AS signup_session_channel2,
  d.devices,
  m.snapshot_date
FROM raw.db_members AS m
LEFT JOIN first_s AS f ON f.person_id = m.member_id
LEFT JOIN signup_s AS su ON su.person_id = m.member_id
LEFT JOIN dev AS d ON d.person_id = m.member_id;
