-- 표: staging.dim_contract_change — 파트너 계약 요금제 변경 이력
-- 1행: 요금제 변경 1건
-- 키: change_id
-- 파티션·클러스터: 없음 / contract_id
-- 원천: raw.db_venue_contract_changes, staging.dim_contract (계약 기간)
-- 소비: staging.int_contract_day, marts.monthly_contract
--
-- change_date(KST)부터 새 요금제·요금이 적용된다. 그 전날까지는 from_plan·from_fee.
-- direction = to_fee > from_fee 면 upgrade, 작으면 downgrade(같으면 lateral).
-- 계약 활성 기간 안의 변경만 남긴다: start_date < change_date < end_date(진행 중이면 스냅샷 기준일 이하).
-- 시작일·종료일 이후의 변경은 신규·해지와 겹쳐 MRR 다리가 두 번 세므로 버린다.

CREATE OR REPLACE TABLE staging.dim_contract_change (
  change_id STRING OPTIONS(description='변경 ID'),
  contract_id STRING OPTIONS(description='계약 ID'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  changed_at TIMESTAMP OPTIONS(description='변경 시각 (UTC)'),
  change_date DATE OPTIONS(description='변경 적용일 (KST). 이날부터 새 요금제'),
  from_plan STRING OPTIONS(description='변경 전 요금제 basic / pro'),
  to_plan STRING OPTIONS(description='변경 후 요금제 basic / pro'),
  from_fee INT64 OPTIONS(description='변경 전 월 이용료 (원)'),
  to_fee INT64 OPTIONS(description='변경 후 월 이용료 (원)'),
  direction STRING OPTIONS(description='upgrade / downgrade / lateral (월 이용료 증감 기준)')
)
CLUSTER BY contract_id
OPTIONS(description='파트너 계약 요금제 변경 이력. 1행 = 변경 1건. 키 change_id. 원천 raw.db_venue_contract_changes. 계약 활성 기간 안의 변경만')
AS
SELECT
  ch.change_id,
  ch.contract_id,
  ch.venue_id,
  ch.changed_at,
  DATE(ch.changed_at, 'Asia/Seoul') AS change_date,
  ch.from_plan,
  ch.to_plan,
  ch.from_fee,
  ch.to_fee,
  CASE
    WHEN ch.to_fee > ch.from_fee THEN 'upgrade'
    WHEN ch.to_fee < ch.from_fee THEN 'downgrade'
    ELSE 'lateral'
  END AS direction
FROM raw.db_venue_contract_changes AS ch
JOIN staging.dim_contract AS c USING (contract_id)
WHERE DATE(ch.changed_at, 'Asia/Seoul') > c.start_date
  AND DATE(ch.changed_at, 'Asia/Seoul') <= c.snapshot_date
  AND (c.end_date IS NULL OR DATE(ch.changed_at, 'Asia/Seoul') < c.end_date);
