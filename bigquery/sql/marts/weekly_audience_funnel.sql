-- 표: marts.weekly_audience_funnel — 오디언스별 주간 퍼널 마트
-- 1행: 주(월요일 시작) × 오디언스 × 단계 × channel1 × device_platform × member_seg
-- 키: 이 여섯 열
-- 파티션·클러스터: week_start / audience_id, step_order, channel1, device_platform
-- 원천: staging.int_person_day, staging.int_session (광고 유입 판정), staging.dim_member (가입일)
-- 소비: 퍼널 탭 드릴다운 '오디언스별 퍼널' — 오디언스 × 단계 도달률 표, 선택 오디언스의 주별 전환율 추이. ops.reconciliation
-- 검사: C6
--
-- 대상: 그 주 방문한 사람(자동 로드 아닌 세션 1개 이상). 방문하지 않은 사람 × 주는 행을 만들지 않는다.
-- 오디언스 (사람 × 주 판정, 서로 겹칠 수 있다 — 오디언스끼리 더하지 않는다. 예외: new + returning = 방문 사람 전체)
--   new            그 주가 첫 방문 주 (weekly_activity.new_persons 와 같은 판정)
--   returning      그 주 이전에 첫 방문한 사람
--   paid_inflow    그 주 방문 세션 중 세션 라스트클릭이 유료 채널인 세션 1개 이상
--   past_payer     그 주 시작 전에 결제 1회 이상 (로그 결제 이벤트)
--   apply_no_pay   그 주 시작 전에 신청 1회 이상, 그 주 시작 전 결제 0회
--   explorer_only  그 주 행사 상세 조회 있음, 신청 화면 조회 없음
-- 단계 (funnel_daily 와 같은 누적 조건, 판정 창만 일 → 주). 플래그를 주 안에서 OR 한 뒤 누적 AND 한다.
--   landing     방문
--   detail      + 행사 상세 조회
--   signup      + 로그인 상태
--   apply_view  + 신청 화면 조회
--   payment     + 결제
-- 세그먼트: channel1·device_platform 은 사람의 첫 방문 속성, member_seg 는 주 시작일 0시 기준(weekly_activity 와 같음).

CREATE OR REPLACE TABLE marts.weekly_audience_funnel (
  week_start DATE OPTIONS(description='주 시작일 (월요일). 파티션'),
  audience_id STRING OPTIONS(description='오디언스 new / returning / paid_inflow / past_payer / apply_no_pay / explorer_only. 서로 겹칠 수 있다'),
  step STRING OPTIONS(description='단계 landing / detail / signup / apply_view / payment'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 주 시작 기준 member / guest'),
  persons INT64 OPTIONS(description='그 주 그 오디언스 중 그 단계까지 도달한 사람 수'),
  step_order INT64 OPTIONS(description='단계 순서 1~5')
)
PARTITION BY week_start
CLUSTER BY audience_id, step_order, channel1, device_platform
OPTIONS(description='오디언스별 주간 퍼널 마트. 1행 = 주 × 오디언스 × 단계 × 세그먼트. 원천 staging.int_person_day·int_session·dim_member. 오디언스는 겹칠 수 있고 단계는 주 안 누적 조건')
AS
WITH pd AS (
  SELECT *, DATE_TRUNC(kst_date, WEEK(MONDAY)) AS week_start
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
paid_week AS (
  SELECT DISTINCT person_id, DATE_TRUNC(session_date, WEEK(MONDAY)) AS week_start
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND NOT is_auto_load
    AND session_channel1 = 'paid'
),
history AS (
  SELECT
    person_id,
    MIN(IF(did_pay, kst_date, NULL)) AS first_pay_date,
    MIN(IF(did_apply, kst_date, NULL)) AS first_apply_date
  FROM pd
  GROUP BY person_id
),
pw AS (
  SELECT
    pd.week_start,
    pd.person_id,
    ANY_VALUE(pd.channel1) AS channel1,
    ANY_VALUE(pd.device_platform) AS device_platform,
    IF(ANY_VALUE(m.signup_date) < pd.week_start, 'member', 'guest') AS member_seg,
    LOGICAL_OR(pd.is_visit) AS visited,
    LOGICAL_OR(pd.is_visit AND pd.is_first_visit_day) AS is_new,
    LOGICAL_OR(pd.did_view_event_detail) AS f_detail,
    LOGICAL_OR(pd.is_logged_in) AS f_login,
    LOGICAL_OR(pd.did_view_apply) AS f_apply_view,
    LOGICAL_OR(pd.did_pay) AS f_pay
  FROM pd
  LEFT JOIN staging.dim_member AS m ON m.member_id = pd.person_id
  GROUP BY pd.week_start, pd.person_id
),
judged AS (
  SELECT
    pw.week_start,
    pw.channel1,
    pw.device_platform,
    pw.member_seg,
    pw.is_new,
    NOT pw.is_new AS is_returning,
    pk.person_id IS NOT NULL AS is_paid_inflow,
    COALESCE(h.first_pay_date < pw.week_start, FALSE) AS is_past_payer,
    COALESCE(h.first_apply_date < pw.week_start, FALSE)
      AND NOT COALESCE(h.first_pay_date < pw.week_start, FALSE) AS is_apply_no_pay,
    pw.f_detail AND NOT pw.f_apply_view AS is_explorer_only,
    TRUE AS s1,
    pw.f_detail AS s2,
    pw.f_detail AND pw.f_login AS s3,
    pw.f_detail AND pw.f_login AND pw.f_apply_view AS s4,
    pw.f_detail AND pw.f_login AND pw.f_apply_view AND pw.f_pay AS s5
  FROM pw
  LEFT JOIN paid_week AS pk USING (person_id, week_start)
  LEFT JOIN history AS h USING (person_id)
  WHERE pw.visited
),
aud AS (
  SELECT week_start, channel1, device_platform, member_seg, audience_id, s1, s2, s3, s4, s5
  FROM judged,
  UNNEST([
    STRUCT('new' AS audience_id, is_new AS hit),
    ('returning', is_returning),
    ('paid_inflow', is_paid_inflow),
    ('past_payer', is_past_payer),
    ('apply_no_pay', is_apply_no_pay),
    ('explorer_only', is_explorer_only)
  ]) AS a
  WHERE a.hit
),
steps AS (
  SELECT * FROM UNNEST([
    STRUCT(1 AS step_order, 'landing' AS step),
    (2, 'detail'), (3, 'signup'), (4, 'apply_view'), (5, 'payment')
  ])
)
SELECT
  aud.week_start,
  aud.audience_id,
  st.step,
  aud.channel1,
  aud.device_platform,
  aud.member_seg,
  COUNTIF(CASE st.step_order
    WHEN 1 THEN aud.s1
    WHEN 2 THEN aud.s2
    WHEN 3 THEN aud.s3
    WHEN 4 THEN aud.s4
    WHEN 5 THEN aud.s5
  END) AS persons,
  st.step_order
FROM aud
CROSS JOIN steps AS st
GROUP BY aud.week_start, aud.audience_id, st.step, aud.channel1, aud.device_platform, aud.member_seg, st.step_order;
