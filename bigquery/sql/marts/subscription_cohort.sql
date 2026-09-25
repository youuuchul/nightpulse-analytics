-- 표: marts.subscription_cohort — 멤버십 구독 시작 월 코호트 유지
-- 1행: 코호트 월(구독 시작 월) × 경과 월(0~9)
-- 키: (cohort_month, month_offset)
-- 파티션·클러스터: DATE_TRUNC(cohort_month, MONTH) / 없음
-- 원천: staging.dim_subscription (시작·종료일·스냅샷 기준일)
-- 소비: 회원 탭 구독 보기 코호트 히트맵
--
-- 구독마다 확인일 = 시작일 + n개월(월말을 넘으면 그 달 마지막 날). 활성 규칙(staging.dim_subscription 머리 주석)으로
--   그날 활성이면 retained. 0개월 확인일 = 시작일이라 retained = cohort_size.
-- 단위는 구독 건(회원당 구독 1건이라 회원 수와 같다). 재구독은 새 코호트로 들어간다.
-- 코호트 전원의 확인일이 관측된 칸만 둔다: (코호트 월 마지막 날 + n개월) <= 스냅샷 기준일. 채워지지 않은 칸은 행이 없다.
-- cohort_size 는 경과 월과 무관하게 같은 값이 반복된다.

CREATE OR REPLACE TABLE marts.subscription_cohort (
  cohort_month DATE OPTIONS(description='코호트 월 = 구독 시작 월 (1일). 월 파티션'),
  month_offset INT64 OPTIONS(description='경과 월 0~9'),
  cohort_size INT64 OPTIONS(description='그 달 시작 구독 수'),
  retained INT64 OPTIONS(description='확인일(시작일 + n개월)에 활성인 구독 수')
)
PARTITION BY DATE_TRUNC(cohort_month, MONTH)
OPTIONS(description='멤버십 구독 시작 월 코호트 유지. 1행 = 코호트 월 × 경과 월(0~9). 원천 staging.dim_subscription. 전원 관측된 칸만')
AS
WITH s AS (
  SELECT subscription_id, start_date, end_date, DATE_TRUNC(start_date, MONTH) AS cohort_month, snapshot_date
  FROM staging.dim_subscription
),
checks AS (
  SELECT
    s.cohort_month,
    n AS month_offset,
    DATE_ADD(s.start_date, INTERVAL n MONTH) AS check_date,
    s.end_date
  FROM s, UNNEST(GENERATE_ARRAY(0, 9)) AS n
  WHERE DATE_ADD(LAST_DAY(s.cohort_month, MONTH), INTERVAL n MONTH) <= s.snapshot_date
)
SELECT
  cohort_month,
  month_offset,
  size.cohort_size,
  COUNTIF(end_date IS NULL OR end_date > check_date) AS retained
FROM checks
JOIN (
  SELECT cohort_month, COUNT(*) AS cohort_size
  FROM s
  GROUP BY 1
) AS size USING (cohort_month)
GROUP BY cohort_month, month_offset, size.cohort_size;
