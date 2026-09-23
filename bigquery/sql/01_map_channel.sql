-- 표: staging.map_channel — 채널 3단계 매핑
-- 1행: (source, medium) 1쌍
-- 키: (source, medium)
-- 파티션·클러스터: 없음 / 없음
-- 원천: raw.ga4_events.traffic_source (관측된 쌍 전부)
-- 소비: staging.int_session (세션 라스트클릭 채널 — 채널·광고 마트는 이 열을 쓴다)
--
-- 채널 분류 규칙의 유일한 원본. 규칙을 바꾸면 이 파일만 고치고 3단계부터 다시 돌린다.
--   channel1  paid / non_paid           광고비가 드는 유입인가
--   channel2  유입 유형                  paid_social·paid_search·organic_search·organic_social·influencer·ai_referral·referral·direct·other
--   channel3  플랫폼                     source 정규화 (linktr.ee → linktree 등)

CREATE OR REPLACE TABLE staging.map_channel (
  source STRING OPTIONS(description='유입 소스 (원문)'),
  medium STRING OPTIONS(description='유입 매체 (원문)'),
  channel1 STRING OPTIONS(description='1단계: paid / non_paid'),
  channel2 STRING OPTIONS(description='2단계: 유입 유형'),
  channel3 STRING OPTIONS(description='3단계: 플랫폼')
)
OPTIONS(description='채널 3단계 매핑. 1행 = (source, medium) 1쌍. 원천 raw.ga4_events.traffic_source. 규칙의 유일한 원본')
AS
WITH pairs AS (
  SELECT DISTINCT
    traffic_source.source AS source,
    traffic_source.medium AS medium
  FROM raw.ga4_events
  -- 전체 재생성: 파티션 필터를 전 기간으로 명시한다
  WHERE event_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
)
SELECT
  source,
  medium,
  IF(medium IN ('paid_social', 'cpc', 'ppc', 'paid_search', 'display'), 'paid', 'non_paid') AS channel1,
  CASE
    WHEN medium = 'paid_social' THEN 'paid_social'
    WHEN medium IN ('cpc', 'ppc', 'paid_search') THEN 'paid_search'
    WHEN medium = 'display' THEN 'display'
    WHEN medium = 'organic' THEN 'organic_search'
    WHEN medium = 'influencer' THEN 'influencer'
    WHEN medium = 'social' THEN 'organic_social'
    WHEN medium = 'referral' AND source IN ('chatgpt', 'gemini', 'perplexity', 'claude', 'copilot') THEN 'ai_referral'
    WHEN medium = 'referral' THEN 'referral'
    WHEN source = '(direct)' OR medium = '(none)' THEN 'direct'
    ELSE 'other'
  END AS channel2,
  CASE
    WHEN source = '(direct)' THEN 'direct'
    WHEN source = 'linktr.ee' THEN 'linktree'
    WHEN source = 'bit.ly' THEN 'bitly'
    ELSE REGEXP_REPLACE(LOWER(source), r'\.(com|net|co\.kr)$', '')
  END AS channel3
FROM pairs;
