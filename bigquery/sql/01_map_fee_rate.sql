-- 표: staging.map_fee_rate — 공간 등급별 거래 수수료율
-- 1행: 수수료 등급 1개
-- 키: fee_tier
-- 파티션·클러스터: 없음 / 없음
-- 원천: 없음 (이 파일의 상수)
-- 소비: staging.fct_order (티켓 수수료)
--
-- 수수료율의 유일한 원본. 율을 바꾸면 이 파일만 고치고 2단계부터 다시 돌린다.
--   none   비파트너 공간 10%
--   basic  파트너 베이직 5%
--   pro    파트너 프로 3%
-- 수수료 = 정가(멤버 할인 전) × 율. 멤버 할인은 플랫폼 부담이라 수수료를 줄이지 않는다.
-- 등급은 행사 개최일(관측 후 개최면 스냅샷 기준일)에 공간의 활성 계약 요금제다(staging.fct_order).

CREATE OR REPLACE TABLE staging.map_fee_rate (
  fee_tier STRING OPTIONS(description='수수료 등급 none(비파트너) / basic / pro'),
  rate NUMERIC OPTIONS(description='정가 대비 수수료율 (0.10 = 10%)')
)
OPTIONS(description='공간 등급별 거래 수수료율. 1행 = 등급 1개. 키 fee_tier. 수수료율의 유일한 원본')
AS
SELECT fee_tier, rate
FROM UNNEST([
  STRUCT('none' AS fee_tier, NUMERIC '0.10' AS rate),
  STRUCT('basic', NUMERIC '0.05'),
  STRUCT('pro', NUMERIC '0.03')
]);
