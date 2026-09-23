-- ops 층 표 준비 (없을 때만 만든다. 기록은 누적된다)
-- ops.build_log      1행 = 실행 1회 × 단계(SQL 파일 1개). 키 (run_id, step, step_name)
-- ops.reconciliation 1행 = 실행 1회 × 검사 항목. 키 (run_id, check_id)
-- ops.freshness      1행 = 표 1개. 키 (dataset_name, table_name). 매 실행 전체 교체
-- 소비: 파이프라인 상태 확인, 대시보드 데이터 탭의 기준일 표시

CREATE TABLE IF NOT EXISTS ops.build_log (
  run_id STRING NOT NULL OPTIONS(description='실행 ID (UTC 시각 기반)'),
  step STRING NOT NULL OPTIONS(description='파이프라인 단계 번호 1~9'),
  step_name STRING NOT NULL OPTIONS(description='단계 이름 또는 대상 표'),
  started_at TIMESTAMP OPTIONS(description='시작 시각 (UTC)'),
  ended_at TIMESTAMP OPTIONS(description='종료 시각 (UTC)'),
  rows_out INT64 OPTIONS(description='단계가 만든 표의 행 수 (여러 표면 합)'),
  bytes_processed INT64 OPTIONS(description='쿼리 처리 바이트 (적재 단계는 0)'),
  status STRING OPTIONS(description='ok / failed'),
  message STRING OPTIONS(description='실패 시 오류 요약')
)
PARTITION BY DATE(started_at)
OPTIONS(description='파이프라인 실행 기록. 1행 = 실행 1회 × 단계. load_all.sh 가 단계마다 1행 INSERT');

CREATE TABLE IF NOT EXISTS ops.reconciliation (
  run_id STRING NOT NULL OPTIONS(description='실행 ID'),
  checked_at TIMESTAMP OPTIONS(description='검사 시각 (UTC)'),
  check_id STRING NOT NULL OPTIONS(description='검사 ID. C=대조, R=일반 범위, I=무결성'),
  category STRING OPTIONS(description='reconcile / range / integrity'),
  check_name STRING OPTIONS(description='검사 이름'),
  left_label STRING OPTIONS(description='왼쪽 값 출처 (범위 검사는 분자)'),
  left_value FLOAT64 OPTIONS(description='왼쪽 값'),
  right_label STRING OPTIONS(description='오른쪽 값 출처 (범위 검사는 분모)'),
  right_value FLOAT64 OPTIONS(description='오른쪽 값'),
  observed FLOAT64 OPTIONS(description='판정에 쓴 값. 대조=차이, 범위=비율'),
  lower_bound FLOAT64 OPTIONS(description='허용 하한'),
  upper_bound FLOAT64 OPTIONS(description='허용 상한'),
  passed BOOL OPTIONS(description='통과 여부'),
  note STRING OPTIONS(description='보조 정보 (불일치 키 수 등)')
)
PARTITION BY DATE(checked_at)
OPTIONS(description='로그 vs 원장, 마트 vs 정제층 대조와 지표 일반 범위 검사. 1행 = 실행 1회 × 검사 항목');

CREATE TABLE IF NOT EXISTS ops.freshness (
  dataset_name STRING NOT NULL OPTIONS(description='데이터셋'),
  table_name STRING NOT NULL OPTIONS(description='표'),
  row_count INT64 OPTIONS(description='행 수'),
  last_loaded_at TIMESTAMP OPTIONS(description='마지막 변경 시각 (UTC)'),
  last_date DATE OPTIONS(description='마지막 파티션 날짜 (파티션 없는 표는 NULL)'),
  run_id STRING OPTIONS(description='갱신한 실행 ID')
)
OPTIONS(description='표별 신선도. 1행 = 표 1개. 매 실행 전체 교체');
