-- 표: marts.daily_channel — 세션 채널 마트
-- 1행: 일(KST) × 세션 채널 3단계 × device_platform × member_seg
-- 키: 이 여섯 열
-- 파티션·클러스터: kst_date / channel2, device_platform, member_seg
-- 원천: staging.int_session (세션 라스트클릭 채널), staging.int_person_day (기기·회원 세그먼트)
-- 소비: 유입·광고 탭 채널 보기. 광고 세션 비중 = channel1 = 'paid' 의 sessions / 전체 sessions. ops.reconciliation
-- 검사: C5
--
-- 이 마트의 channel1·channel2·channel3 은 세션 라스트클릭 채널이다(다른 마트의 channel1 = 사람의 첫 유입과 다르다).
-- 세션 속성이라 세션 합은 조합 합 = 전체지만, persons·payers 는 채널끼리 더하면 중복이 생긴다.
-- sessions 는 자동 로드 제외. 자동 로드는 auto_load_sessions (sessions + auto_load_sessions = int_session 행 수, 검사 C5).

CREATE OR REPLACE TABLE marts.daily_channel (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  channel1 STRING OPTIONS(description='세션 채널 1단계 paid / non_paid'),
  channel2 STRING OPTIONS(description='세션 채널 2단계 유입 유형'),
  channel3 STRING OPTIONS(description='세션 채널 3단계 플랫폼'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  sessions INT64 OPTIONS(description='방문 세션 수 (자동 로드 제외)'),
  persons INT64 OPTIONS(description='방문 세션을 가진 고유 사람 수 (채널 간 합산 불가)'),
  new_persons INT64 OPTIONS(description='이 채널 세션이 첫 방문인 사람 수'),
  signups INT64 OPTIONS(description='세션 안 가입 수'),
  applies INT64 OPTIONS(description='세션 안 신청 건수'),
  payers INT64 OPTIONS(description='세션 안 결제한 고유 사람 수'),
  pay_amount INT64 OPTIONS(description='세션 안 결제 금액 (원)'),
  engaged_sessions INT64 OPTIONS(description='활성 세션 수'),
  auto_load_sessions INT64 OPTIONS(description='자동 로드 세션 수'),
  pay_count INT64 OPTIONS(description='세션 안 결제 건수')
)
PARTITION BY kst_date
CLUSTER BY channel2, device_platform, member_seg
OPTIONS(description='세션 채널 마트. 1행 = 일 × 세션 채널 3단계 × device_platform × member_seg. 원천 staging.int_session·int_person_day')
AS
WITH s AS (
  SELECT *
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
seg AS (
  SELECT person_id, kst_date, device_platform, member_seg
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
)
SELECT
  s.session_date AS kst_date,
  s.session_channel1 AS channel1,
  s.session_channel2 AS channel2,
  s.session_channel3 AS channel3,
  g.device_platform,
  g.member_seg,
  COUNTIF(NOT s.is_auto_load) AS sessions,
  COUNT(DISTINCT IF(s.is_auto_load, NULL, s.person_id)) AS persons,
  COUNTIF(s.is_person_first_session) AS new_persons,
  SUM(s.sign_ups) AS signups,
  SUM(s.applications) AS applies,
  COUNT(DISTINCT IF(s.purchases > 0, s.person_id, NULL)) AS payers,
  SUM(s.purchase_amount) AS pay_amount,
  COUNTIF(s.is_active) AS engaged_sessions,
  COUNTIF(s.is_auto_load) AS auto_load_sessions,
  SUM(s.purchases) AS pay_count
FROM s
JOIN seg AS g
  ON g.person_id = s.person_id AND g.kst_date = s.session_date
GROUP BY 1, 2, 3, 4, 5, 6;
