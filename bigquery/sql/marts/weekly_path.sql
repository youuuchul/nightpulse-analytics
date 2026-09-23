-- 표: marts.weekly_path — 주간 화면 경로 마트 (생키 다이어그램용)
-- 1행: 주(월요일 시작) × channel1 × device_platform × member_seg × 단계 × from 화면 × to 화면
-- 키: 이 일곱 열
-- 파티션·클러스터: week_start / step, channel1, device_platform, member_seg
-- 원천: staging.events_clean (screen_view 순서), staging.int_session (세션 날짜·자동 로드·사람), staging.int_person_day (세그먼트), staging.dim_member (가입일)
-- 소비: 퍼널 탭 드릴다운 '경로 탐색' — 단계별 노드(화면)·링크(전이) 생키. ops.reconciliation
-- 검사: C7
--
-- 규칙
--   대상 세션     자동 로드 아닌 세션. 주는 세션 시작일(KST)이 속한 주
--   화면 순서     세션 안 screen_view 를 이벤트 시각 순으로 앞 5개만 쓴다. 같은 화면이 연달아 나와도 그대로 센다
--   단계          step n = n번째 화면 → n+1번째 화면 (1 = 랜딩 → 2번째 … 4 = 4번째 → 5번째). 노드 열은 5개
--   이탈          n+1번째 화면이 없으면 to_screen = '(이탈)' 이고 그 세션은 다음 단계에 나오지 않는다
--   화면 접기     기간 전체에서 앞 5개 화면 안에 나온 세션 수 상위 12개 화면만 이름을 두고 나머지는 '(기타)'
--   세그먼트      channel1·device_platform 은 사람의 첫 방문 속성, member_seg 는 주 시작일 0시 기준(weekly_activity 와 같음)
-- 단계 n 의 세션 합 = 화면을 n개 이상 본 세션 수. step 1 의 세션 합 = 그 주 방문 세션 수(checks C7).

CREATE OR REPLACE TABLE marts.weekly_path (
  week_start DATE OPTIONS(description='주 시작일 (월요일, 세션 시작일 기준). 파티션'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 주 시작 기준 member / guest'),
  step INT64 OPTIONS(description='전이 단계 1~4 (n번째 화면 → n+1번째 화면)'),
  from_screen STRING OPTIONS(description='n번째 화면 이름. 상위 12개 밖은 (기타)'),
  to_screen STRING OPTIONS(description='n+1번째 화면 이름. 없으면 (이탈), 상위 12개 밖은 (기타)'),
  sessions INT64 OPTIONS(description='그 전이를 거친 방문 세션 수')
)
PARTITION BY week_start
CLUSTER BY step, channel1, device_platform, member_seg
OPTIONS(description='주간 화면 경로 마트. 1행 = 주 × 세그먼트 × 단계 × from 화면 × to 화면. 원천 staging.events_clean·int_session·int_person_day·dim_member. 세션당 앞 5개 화면, 자동 로드 제외, 상위 12개 화면 밖은 (기타)')
AS
WITH sv AS (
  SELECT client_id, session_id, event_at, screen_name
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND event_name = 'screen_view'
),
sess AS (
  SELECT
    client_id,
    session_id,
    person_id,
    DATE_TRUNC(session_date, WEEK(MONDAY)) AS week_start
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND NOT is_auto_load
),
seq AS (
  SELECT
    s.client_id,
    s.session_id,
    ARRAY_AGG(v.screen_name ORDER BY v.event_at, v.screen_name LIMIT 5) AS screens
  FROM sess AS s
  JOIN sv AS v USING (client_id, session_id)
  GROUP BY s.client_id, s.session_id
),
top_screen AS (
  SELECT screen_name
  FROM seq, UNNEST(ARRAY(SELECT DISTINCT x FROM UNNEST(seq.screens) AS x)) AS screen_name
  GROUP BY screen_name
  ORDER BY COUNT(*) DESC, screen_name
  LIMIT 12
),
person_seg AS (
  SELECT person_id, ANY_VALUE(channel1) AS channel1, ANY_VALUE(device_platform) AS device_platform
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY person_id
),
edge AS (
  SELECT
    s.week_start,
    ps.channel1,
    ps.device_platform,
    IF(m.signup_date < s.week_start, 'member', 'guest') AS member_seg,
    pos + 1 AS step,
    q.screens[OFFSET(pos)] AS from_raw,
    q.screens[SAFE_OFFSET(pos + 1)] AS to_raw
  FROM seq AS q
  JOIN sess AS s USING (client_id, session_id)
  JOIN person_seg AS ps USING (person_id)
  LEFT JOIN staging.dim_member AS m ON m.member_id = s.person_id
  CROSS JOIN UNNEST(GENERATE_ARRAY(0, LEAST(ARRAY_LENGTH(q.screens), 4) - 1)) AS pos
)
SELECT
  e.week_start,
  e.channel1,
  e.device_platform,
  e.member_seg,
  e.step,
  IF(e.from_raw IN (SELECT screen_name FROM top_screen), e.from_raw, '(기타)') AS from_screen,
  CASE
    WHEN e.to_raw IS NULL THEN '(이탈)'
    WHEN e.to_raw IN (SELECT screen_name FROM top_screen) THEN e.to_raw
    ELSE '(기타)'
  END AS to_screen,
  COUNT(*) AS sessions
FROM edge AS e
GROUP BY 1, 2, 3, 4, 5, 6, 7;
