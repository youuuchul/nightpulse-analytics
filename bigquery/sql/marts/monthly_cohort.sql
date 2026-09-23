-- 표: marts.monthly_cohort — 월간 리텐션 코호트
-- 1행: 코호트 월 × 경과 월 × member_seg
-- 키: 이 세 열
-- 파티션·클러스터: DATE_TRUNC(cohort_month, MONTH) / month_offset, member_seg
-- 원천: staging.int_person_day, staging.dim_member
-- 소비: 월 리텐션 표. 리텐션 = retained / cohort_size (화면에서 나눈다)
--
-- 코호트 월 = 첫 방문일이 속한 달. member_seg = 코호트 월 말일 기준 회원 여부 member / guest.
-- 관측 가능한 칸을 0 포함으로 채운다. 경과 월은 0~6. cohort_size 는 경과 월과 무관하게 반복된다.

CREATE OR REPLACE TABLE marts.monthly_cohort (
  cohort_month DATE OPTIONS(description='코호트 월 (첫 방문 월의 1일). 월 파티션'),
  month_offset INT64 OPTIONS(description='경과 월 0~6 (0 = 첫 방문 월)'),
  member_seg STRING OPTIONS(description='세그먼트: 코호트 월 말일 기준 member / guest'),
  cohort_size INT64 OPTIONS(description='코호트 사람 수 (분모)'),
  retained INT64 OPTIONS(description='그 달에 방문한 코호트 사람 수 (분자)'),
  activity_month DATE OPTIONS(description='활동 월의 1일'),
  is_complete_month BOOL OPTIONS(description='활동 월 전체가 관측됐는가')
)
PARTITION BY DATE_TRUNC(cohort_month, MONTH)
CLUSTER BY month_offset, member_seg
OPTIONS(description='월간 리텐션 코호트. 1행 = 코호트 월 × 경과 월 × member_seg. 원천 staging.int_person_day·dim_member')
AS
WITH pd AS (
  SELECT person_id, kst_date, is_visit, is_first_visit_day
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
bounds AS (
  SELECT MAX(kst_date) AS last_date, DATE_TRUNC(MAX(kst_date), MONTH) AS last_month
  FROM pd
),
cohort AS (
  SELECT
    pd.person_id,
    DATE_TRUNC(pd.kst_date, MONTH) AS cohort_month,
    IF(m.signup_date <= LAST_DAY(pd.kst_date, MONTH), 'member', 'guest') AS member_seg
  FROM pd
  LEFT JOIN staging.dim_member AS m ON m.member_id = pd.person_id
  WHERE pd.is_visit AND pd.is_first_visit_day
),
activity AS (
  SELECT DISTINCT person_id, DATE_TRUNC(kst_date, MONTH) AS activity_month
  FROM pd
  WHERE is_visit
),
sizes AS (
  SELECT cohort_month, member_seg, COUNT(*) AS cohort_size
  FROM cohort
  GROUP BY 1, 2
),
grid AS (
  SELECT z.cohort_month, z.member_seg, z.cohort_size, mth AS activity_month,
         DATE_DIFF(mth, z.cohort_month, MONTH) AS month_offset
  FROM sizes AS z
  CROSS JOIN bounds AS b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(z.cohort_month, LEAST(b.last_month, DATE_ADD(z.cohort_month, INTERVAL 6 MONTH)), INTERVAL 1 MONTH)) AS mth
),
ret AS (
  SELECT c.cohort_month, c.member_seg, a.activity_month, COUNT(*) AS retained
  FROM cohort AS c
  JOIN activity AS a ON a.person_id = c.person_id AND a.activity_month >= c.cohort_month
  GROUP BY 1, 2, 3
)
SELECT
  g.cohort_month,
  g.month_offset,
  g.member_seg,
  g.cohort_size,
  COALESCE(r.retained, 0) AS retained,
  g.activity_month,
  LAST_DAY(g.activity_month, MONTH) <= b.last_date AS is_complete_month
FROM grid AS g
CROSS JOIN bounds AS b
LEFT JOIN ret AS r USING (cohort_month, member_seg, activity_month);
