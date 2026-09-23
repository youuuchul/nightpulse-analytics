-- 표: ops.reconciliation — 대조·범위·무결성 검사 결과 (행 추가)
-- 1행: 실행 1회 × 검사 항목
-- 키: (run_id, check_id)
-- 파티션·클러스터: DATE(checked_at) / 없음
-- 원천: raw.db_payments·db_applications, staging.events_clean·int_session·int_person_day·fct_order·ad_spend,
--       marts.daily_metrics·weekly_cohort·daily_channel·weekly_activity·weekly_audience_funnel·weekly_path
-- 소비: load_all.sh 8단계. passed = FALSE 가 하나라도 있으면 파이프라인이 exit 1
--
-- 표 정의는 sql/00_ops_tables.sql.
-- 판정
--   reconcile (C)  observed = |왼쪽 - 오른쪽| + 날짜별 불일치 키 수. 0 이어야 통과
--   range     (R)  observed = 분자 / 분모. docs/architecture.md §6 범위 안이어야 통과
--   integrity (I)  observed = 위반 건수. 0 이어야 통과
-- 매개변수: @run_id STRING

INSERT INTO ops.reconciliation
  (run_id, checked_at, check_id, category, check_name, left_label, left_value, right_label, right_value,
   observed, lower_bound, upper_bound, passed, note)
WITH
log_ev AS (
  SELECT
    COUNTIF(event_name = 'purchase') AS purchases,
    SUM(IF(event_name = 'purchase', amount, 0)) AS purchase_amount,
    COUNTIF(event_name = 'apply_event') AS applications
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND event_name IN ('purchase', 'apply_event')
),
ledger AS (
  SELECT
    (SELECT COUNT(*) FROM raw.db_payments) AS payments,
    (SELECT SUM(amount) FROM raw.db_payments) AS payment_amount,
    (SELECT COUNT(*) FROM raw.db_applications) AS applications
),
-- C3 일 방문 사람: 마트 합 vs 중간 표 재집계, 날짜별
c3 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(persons) AS v
    FROM marts.daily_metrics
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT kst_date, COUNTIF(is_visit) AS v
    FROM staging.int_person_day
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS p USING (kst_date)
),
-- C4 주간 코호트 크기: 0주차 합 vs 첫 방문 사람, 코호트 주별
c4 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_weeks
  FROM (
    SELECT cohort_week, SUM(cohort_size) AS v
    FROM marts.weekly_cohort
    WHERE week_offset = 0
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT DATE_TRUNC(kst_date, WEEK(MONDAY)) AS cohort_week, COUNT(DISTINCT person_id) AS v
    FROM staging.int_person_day
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND is_visit AND is_first_visit_day
    GROUP BY 1
  ) AS p USING (cohort_week)
),
-- C5 채널 합: 세션 채널 마트 세션 합 vs 세션 표, 날짜별
c5 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(sessions + auto_load_sessions) AS v
    FROM marts.daily_channel
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT session_date AS kst_date, COUNT(*) AS v
    FROM staging.int_session
    WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS p USING (kst_date)
),
-- C6 오디언스 퍼널: new + returning 랜딩 사람 합 vs weekly_activity wau, 주 × 세그먼트별
c6 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(w.v, 0)) AS ref_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(w.v, -1)) AS bad_keys
  FROM (
    SELECT week_start, channel1, device_platform, member_seg, SUM(persons) AS v
    FROM marts.weekly_audience_funnel
    WHERE step = 'landing' AND audience_id IN ('new', 'returning')
    GROUP BY 1, 2, 3, 4
  ) AS m
  FULL OUTER JOIN (
    SELECT week_start, channel1, device_platform, member_seg, SUM(wau) AS v
    FROM marts.weekly_activity
    WHERE wau > 0
    GROUP BY 1, 2, 3, 4
  ) AS w USING (week_start, channel1, device_platform, member_seg)
),
-- C7 경로: step 1 세션 합 vs weekly_activity 방문 세션 합, 주 × 세그먼트별
c7 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(w.v, 0)) AS ref_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(w.v, -1)) AS bad_keys
  FROM (
    SELECT week_start, channel1, device_platform, member_seg, SUM(sessions) AS v
    FROM marts.weekly_path
    WHERE step = 1
    GROUP BY 1, 2, 3, 4
  ) AS m
  FULL OUTER JOIN (
    SELECT week_start, channel1, device_platform, member_seg, SUM(valid_sessions) AS v
    FROM marts.weekly_activity
    WHERE valid_sessions > 0
    GROUP BY 1, 2, 3, 4
  ) AS w USING (week_start, channel1, device_platform, member_seg)
),
cohort_ret AS (
  SELECT
    SUM(IF(week_offset = 1, retained, 0)) AS w1_num,
    SUM(IF(week_offset = 1, cohort_size, 0)) AS w1_den,
    SUM(IF(week_offset = 4, retained, 0)) AS w4_num,
    SUM(IF(week_offset = 4, cohort_size, 0)) AS w4_den
  FROM marts.weekly_cohort
  WHERE week_offset IN (1, 4) AND is_complete_week
),
person_conv AS (
  SELECT
    COUNT(DISTINCT IF(did_sign_up, person_id, NULL)) AS signup_persons,
    COUNT(DISTINCT IF(is_visit, person_id, NULL)) AS visit_persons
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
day_conv AS (
  SELECT SUM(appliers) AS appliers, SUM(detail_viewers) AS detail_viewers
  FROM marts.daily_metrics
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
orders AS (
  SELECT
    COUNT(*) AS applications,
    COUNTIF(is_canceled) AS canceled,
    COUNTIF(is_paid_tier) AS paid_tier,
    COUNTIF(is_paid_tier AND is_paid) AS paid_tier_paid
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
spend_days AS (
  SELECT DISTINCT kst_date
  FROM staging.ad_spend
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND spend > 0
),
sess AS (
  SELECT
    COUNT(*) AS sessions,
    COUNTIF(is_auto_load) AS auto_load,
    COUNTIF(NOT is_auto_load AND session_date IN (SELECT kst_date FROM spend_days)) AS valid_in_spend,
    COUNTIF(NOT is_auto_load AND session_date IN (SELECT kst_date FROM spend_days) AND session_channel1 = 'paid') AS paid_in_spend,
    COUNTIF(session_channel1 = 'unmapped') AS unmapped
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
integrity AS (
  SELECT
    (SELECT COUNT(*) FROM (
       SELECT client_id
       FROM staging.events_clean
       WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND member_id IS NOT NULL
       GROUP BY client_id
       HAVING COUNT(DISTINCT member_id) > 1)) AS multi_member_devices,
    (SELECT COUNTIF(kst_date != DATE(event_at, 'Asia/Seoul'))
       FROM staging.events_clean
       WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS kst_date_mismatch,
    (SELECT COUNTIF(price_tier IS NULL)
       FROM staging.fct_order
       WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS orphan_orders
),
checks AS (
  SELECT 'C1a' AS check_id, 'reconcile' AS category, '결제 건수: 로그 vs 원장' AS check_name,
         'events_clean purchase' AS left_label, CAST(l.purchases AS FLOAT64) AS left_value,
         'raw.db_payments 행' AS right_label, CAST(g.payments AS FLOAT64) AS right_value,
         CAST(ABS(l.purchases - g.payments) AS FLOAT64) AS observed, 0.0 AS lower_bound, 0.0 AS upper_bound,
         CAST(NULL AS STRING) AS note
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C1b', 'reconcile', '결제 금액: 로그 vs 원장',
         'events_clean purchase value 합', l.purchase_amount, 'raw.db_payments amount 합', g.payment_amount,
         ABS(l.purchase_amount - g.payment_amount), 0, 0, NULL
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C2', 'reconcile', '신청 건수: 로그 vs 원장',
         'events_clean apply_event', l.applications, 'raw.db_applications 행', g.applications,
         ABS(l.applications - g.applications), 0, 0, NULL
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C3', 'reconcile', '일 방문 사람: 마트 합 vs 중간 표',
         'marts.daily_metrics persons 합', mart_v, 'int_person_day is_visit 재집계', stg_v,
         ABS(mart_v - stg_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c3
  UNION ALL
  SELECT 'C4', 'reconcile', '주간 코호트 크기: 0주차 vs 첫 방문',
         'marts.weekly_cohort 0주차 cohort_size 합', mart_v, 'int_person_day 첫 방문 사람', stg_v,
         ABS(mart_v - stg_v) + bad_weeks, 0, 0, FORMAT('불일치 코호트 주 %d', bad_weeks)
  FROM c4
  UNION ALL
  SELECT 'C5', 'reconcile', '채널 합: 세션 채널 마트 vs 세션 표',
         'marts.daily_channel sessions + auto_load_sessions 합', mart_v, 'int_session 행', stg_v,
         ABS(mart_v - stg_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c5
  UNION ALL
  SELECT 'C6', 'reconcile', '오디언스 퍼널: 신규 + 재방문 vs WAU',
         'weekly_audience_funnel landing new+returning 합', mart_v, 'weekly_activity wau 합', ref_v,
         ABS(mart_v - ref_v) + bad_keys, 0, 0, FORMAT('불일치 주 × 세그먼트 %d', bad_keys)
  FROM c6
  UNION ALL
  SELECT 'C7', 'reconcile', '경로 1단계 세션 vs 주간 방문 세션',
         'weekly_path step 1 sessions 합', mart_v, 'weekly_activity valid_sessions 합', ref_v,
         ABS(mart_v - ref_v) + bad_keys, 0, 0, FORMAT('불일치 주 × 세그먼트 %d', bad_keys)
  FROM c7
  UNION ALL
  SELECT 'R1', 'range', '신규 방문자 W1 리텐션',
         'W1 retained', w1_num, 'cohort_size (W1 관측 완료 코호트)', w1_den,
         SAFE_DIVIDE(w1_num, w1_den), 0.15, 0.30, NULL
  FROM cohort_ret
  UNION ALL
  SELECT 'R2', 'range', 'W4 리텐션',
         'W4 retained', w4_num, 'cohort_size (W4 관측 완료 코호트)', w4_den,
         SAFE_DIVIDE(w4_num, w4_den), 0.08, 0.18, NULL
  FROM cohort_ret
  UNION ALL
  SELECT 'R3', 'range', '방문 → 가입 전환 (기간 누적 사람)',
         '가입 사람', signup_persons, '방문 사람', visit_persons,
         SAFE_DIVIDE(signup_persons, visit_persons), 0.06, 0.12, NULL
  FROM person_conv
  UNION ALL
  SELECT 'R4', 'range', '행사 상세 조회 → 신청 (사람 × 일)',
         '신청 사람 × 일', appliers, '행사 상세 조회 사람 × 일', detail_viewers,
         SAFE_DIVIDE(appliers, detail_viewers), 0.03, 0.08, NULL
  FROM day_conv
  UNION ALL
  SELECT 'R5', 'range', '신청 → 결제 완료 (유료 행사)',
         '유료 신청 중 결제', paid_tier_paid, '유료 행사 신청', paid_tier,
         SAFE_DIVIDE(paid_tier_paid, paid_tier), 0.55, 0.75, NULL
  FROM orders
  UNION ALL
  SELECT 'R6', 'range', '취소율 (신청 대비)',
         '취소된 신청', canceled, '신청', applications,
         SAFE_DIVIDE(canceled, applications), 0.05, 0.12, NULL
  FROM orders
  UNION ALL
  SELECT 'R7', 'range', '광고 세션 비중 (집행일, 자동 로드 제외)',
         '광고 세션', paid_in_spend, '집행일 전체 세션', valid_in_spend,
         SAFE_DIVIDE(paid_in_spend, valid_in_spend), 0.10, 0.30, NULL
  FROM sess
  UNION ALL
  SELECT 'R8', 'range', '자동 로드 세션 비중',
         '자동 로드 세션', auto_load, '전체 세션', sessions,
         SAFE_DIVIDE(auto_load, sessions), 0.05, 0.10, NULL
  FROM sess
  UNION ALL
  SELECT 'I1', 'integrity', '기기당 회원 1명', '회원 2명 이상 기기', multi_member_devices, NULL, NULL,
         multi_member_devices, 0, 0, NULL
  FROM integrity
  UNION ALL
  SELECT 'I2', 'integrity', '채널 매핑 누락 세션', 'unmapped 세션', unmapped, NULL, NULL,
         unmapped, 0, 0, NULL
  FROM sess
  UNION ALL
  SELECT 'I3', 'integrity', 'event_date = KST 날짜', '불일치 이벤트', kst_date_mismatch, NULL, NULL,
         kst_date_mismatch, 0, 0, NULL
  FROM integrity
  UNION ALL
  SELECT 'I4', 'integrity', '행사 원장에 없는 신청', '고아 신청', orphan_orders, NULL, NULL,
         orphan_orders, 0, 0, NULL
  FROM integrity
)
SELECT
  @run_id,
  CURRENT_TIMESTAMP(),
  check_id,
  category,
  check_name,
  left_label,
  left_value,
  right_label,
  right_value,
  observed,
  lower_bound,
  upper_bound,
  COALESCE(observed BETWEEN lower_bound AND upper_bound, FALSE),
  note
FROM checks;
