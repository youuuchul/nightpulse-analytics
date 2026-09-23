-- 표: marts.hourly_metrics — 시간대 마트
-- 1행: 일(KST) × 시(KST, 세션 시작 시) × channel1 × device_platform × member_seg
-- 키: 이 다섯 열
-- 파티션·클러스터: kst_date / channel1, device_platform, member_seg
-- 원천: staging.int_session (세션), staging.int_person_day (세그먼트: 사람 × 일)
-- 소비: 요일 × 시간대 세션 히트맵, 1일 선택 시 시간별 차트. 세그먼트 필터를 받아야 해서 축을 둔다
--
-- persons 는 그 시에 방문 세션을 시작한 고유 사람 수라 시간끼리 더하면 중복이 생긴다.

CREATE OR REPLACE TABLE marts.hourly_metrics (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  kst_hour INT64 OPTIONS(description='세션 시작 시 (KST, 0~23)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  persons INT64 OPTIONS(description='그 시에 방문 세션을 시작한 사람 수 (시간끼리 합산 불가)'),
  sessions INT64 OPTIONS(description='방문 세션 수 (자동 로드 제외)'),
  applies INT64 OPTIONS(description='세션 안 신청 건수 (로그)'),
  pay_count INT64 OPTIONS(description='세션 안 결제 건수 (로그)'),
  engaged_sessions INT64 OPTIONS(description='활성 세션 수'),
  auto_load_sessions INT64 OPTIONS(description='자동 로드 세션 수'),
  pay_amount INT64 OPTIONS(description='세션 안 결제 금액 (원)')
)
PARTITION BY kst_date
CLUSTER BY channel1, device_platform, member_seg
OPTIONS(description='시간대 마트. 1행 = 일 × 시(KST) × channel1 × device_platform × member_seg. 원천 staging.int_session·int_person_day')
AS
WITH s AS (
  SELECT session_date, kst_hour, person_id, is_auto_load, is_active, applications, purchases, purchase_amount
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
seg AS (
  SELECT person_id, kst_date, channel1, device_platform, member_seg
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
)
SELECT
  s.session_date AS kst_date,
  s.kst_hour,
  g.channel1,
  g.device_platform,
  g.member_seg,
  COUNT(DISTINCT IF(s.is_auto_load, NULL, s.person_id)) AS persons,
  COUNTIF(NOT s.is_auto_load) AS sessions,
  SUM(s.applications) AS applies,
  SUM(s.purchases) AS pay_count,
  COUNTIF(s.is_active) AS engaged_sessions,
  COUNTIF(s.is_auto_load) AS auto_load_sessions,
  SUM(s.purchase_amount) AS pay_amount
FROM s
JOIN seg AS g
  ON g.person_id = s.person_id AND g.kst_date = s.session_date
GROUP BY 1, 2, 3, 4, 5;
