-- 표: marts.person_day — 사람 × 일 행동 플래그 마트 (기간 고유 사람 수 계산용)
-- 1행: 사람 × 일(KST). 플래그가 하나도 없는 날(자동 로드만 있는 날)은 뺀다
-- 키: (person_key, kst_date)
-- 파티션·클러스터: kst_date / person_key
-- 원천: staging.int_person_day
-- 소비: 대시보드 사람 지표 타일·분해·전기 대비(기간 고유 사람 수). ops.reconciliation
-- 검사: C8
--
-- 사람 지표를 어떤 기간·필터에서도 '기간 고유 사람 수'로 세기 위한 마트다. 일별 고유 수를 더하지 않는다.
-- person_key 는 person_id 를 DENSE_RANK 로 바꾼 익명 정수 키다. 원본 식별자(member_id·client_id)는 싣지 않는다.
-- 키 값은 적재마다 다시 매겨지므로 적재 사이에 이어 쓰지 않는다.
-- flags 비트 (staging.int_person_day 의 BOOL 열과 1:1)
--   1 visited(is_visit) · 2 explored(did_explore) · 4 event_detail(did_view_event_detail)
--   8 detail_any(did_view_detail) · 16 signed_up(did_sign_up, 그날) · 32 logged_in(is_logged_in)
--   64 apply_view(did_view_apply) · 128 applied(did_apply) · 256 paid(did_pay) · 512 cancelled(did_cancel)
--   1024 searched(did_search) · 2048 banner(did_select_promotion) · 4096 shared(did_share)
--   8192 multi_session(is_multi_session) · 16384 first_visit(is_first_visit_day)

CREATE OR REPLACE TABLE marts.person_day (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  person_key INT64 OPTIONS(description='익명 사람 키 (person_id 의 DENSE_RANK, 적재마다 재부여)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  flags INT64 OPTIONS(description='행동 플래그 비트 합 (비트 정의는 파일 머리 주석)')
)
PARTITION BY kst_date
CLUSTER BY person_key
OPTIONS(description='사람 × 일 행동 플래그 마트. 1행 = (person_key, kst_date). 원천 staging.int_person_day. 기간 고유 사람 수 계산용')
AS
WITH f AS (
  SELECT
    kst_date,
    person_id,
    channel1,
    device_platform,
    member_seg,
    IF(is_visit, 1, 0)
      + IF(did_explore, 2, 0)
      + IF(did_view_event_detail, 4, 0)
      + IF(did_view_detail, 8, 0)
      + IF(did_sign_up, 16, 0)
      + IF(is_logged_in, 32, 0)
      + IF(did_view_apply, 64, 0)
      + IF(did_apply, 128, 0)
      + IF(did_pay, 256, 0)
      + IF(did_cancel, 512, 0)
      + IF(did_search, 1024, 0)
      + IF(did_select_promotion, 2048, 0)
      + IF(did_share, 4096, 0)
      + IF(is_multi_session, 8192, 0)
      + IF(is_first_visit_day, 16384, 0) AS flags
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
)
SELECT
  kst_date,
  DENSE_RANK() OVER (ORDER BY person_id) AS person_key,
  channel1,
  device_platform,
  member_seg,
  flags
FROM f
WHERE flags > 0;
