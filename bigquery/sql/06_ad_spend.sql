-- staging.ad_spend — 광고 집행 정리
-- 그레인: 캠페인 × 일(KST). 키: (campaign_id, kst_date)
-- 원천: raw.ads_spend
-- 소비: marts.daily_ad

CREATE OR REPLACE TABLE staging.ad_spend (
  kst_date DATE OPTIONS(description='집행일 (KST). 일 파티션'),
  campaign_id STRING OPTIONS(description='캠페인 ID (= 세션 campaign)'),
  campaign_name STRING OPTIONS(description='캠페인명 (가상)'),
  spend INT64 OPTIONS(description='광고비 (원)'),
  impressions INT64 OPTIONS(description='노출'),
  clicks INT64 OPTIONS(description='클릭')
)
PARTITION BY kst_date
CLUSTER BY campaign_id
OPTIONS(description='광고 집행 정리. 1행 = 캠페인 × 일. 키 (campaign_id, kst_date). 원천 raw.ads_spend')
AS
SELECT
  date AS kst_date,
  campaign_id,
  ANY_VALUE(campaign_name) AS campaign_name,
  SUM(COALESCE(spend, 0)) AS spend,
  SUM(COALESCE(impressions, 0)) AS impressions,
  SUM(COALESCE(clicks, 0)) AS clicks
FROM raw.ads_spend
WHERE date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY date, campaign_id;
