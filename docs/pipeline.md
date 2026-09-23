# 파이프라인 운영

`bigquery/load_all.sh` 한 번으로 원천 적재부터 대조·기록까지 돈다. 설계 기준은 [architecture.md](architecture.md), 지표 정의는 [metrics.md](metrics.md).

## 실행

```bash
scripts/bq.sh login                    # 최초 1회 (개인 GCP 계정)
bigquery/load_all.sh                   # 1~9단계 전부
bigquery/load_all.sh --skip-raw        # 적재 생략, 2단계부터
bigquery/load_all.sh --only 7          # 한 단계만 (1~9)
```

- BigQuery 명령은 모두 `scripts/bq.sh` 를 거친다. 프로젝트 `nightpulse-analytics`, 리전 `asia-northeast3` 가 래퍼에 고정돼 있다.
- 입력은 생성기 출력 `data/raw/` 7개 파일, 스키마는 `bigquery/schema/<표>.json`.
- 단계마다 stdout 한 줄(`[단계] 표 ok rows=… bytes=… 초`)과 `ops.build_log` 1행을 남긴다. 실행 ID(`run_id`)는 시작 시각(UTC)이다.

## 단계

| 단계 | 파일 | 만드는 표 | 방식 |
|---|---|---|---|
| 0 | `sql/00_ops_tables.sql` | `ops.build_log` `ops.reconciliation` `ops.freshness` | 없을 때만 생성 (매 실행 앞) |
| 1 | `load_all.sh` 안 적재 | `raw.ga4_events` `raw.db_*` 5개 `raw.ads_spend` | 전체 교체 |
| 2 | `sql/01_map_channel.sql` | `staging.map_channel` | 전체 교체 |
| 3 | `sql/02_events_clean.sql` | `staging.events_clean` | 전체 교체 |
| 4 | `sql/03_int_session.sql` | `staging.int_session` | 전체 교체 |
| 5 | `sql/04_int_person_day.sql` | `staging.int_person_day` | 전체 교체 |
| 6 | `sql/05_dim_member.sql` `06_fct_order.sql` `06_dim_event.sql` `06_dim_venue.sql` `06_ad_spend.sql` | 차원·원장 정리 5개 | 전체 교체, `fct_order` → `dim_event` 순서 |
| 7 | `sql/marts/*.sql` 11개 | `marts.*` | 전체 교체, `weekly_cohort` → `monthly_summary` 순서 |
| 8 | `checks/reconciliation.sql` | `ops.reconciliation` 에 18행 추가 | 누적. 실패 1건 이상이면 exit 1 |
| 9 | `sql/09_freshness.sql` | `ops.freshness` | 전체 교체 |

모든 단계가 멱등이다. 같은 입력이면 같은 표가 나오고, `ops.build_log`·`ops.reconciliation` 만 실행마다 누적된다.

모든 SQL 파일 머리에 그레인·키·원천·소비 화면을 적었고, 표·열 description 도 SQL 안에서 만든다. BigQuery 콘솔에서 표를 열면 같은 설명이 보인다.

## 재실행

| 상황 | 명령 |
|---|---|
| 생성기를 다시 돌렸다 | `bigquery/load_all.sh` |
| 채널 규칙만 바꿨다 (`01_map_channel.sql`) | `--only 2` 후 `--skip-raw` (4단계부터 다시 계산돼야 한다) |
| 마트 SQL 하나를 고쳤다 | `--only 7` 후 `--only 8` |
| 검사 기준만 바꿨다 | `--only 8` |

`--only` 는 앞 단계 결과가 이미 있다고 가정한다. 상위 표를 고쳤으면 그 단계부터 끝까지 돌리는 편이 안전하다(`--skip-raw` 는 2단계부터 전부).

## 실패 시 조치

| 증상 | 확인 | 조치 |
|---|---|---|
| `[1] raw… 실패: data/raw 에 … 없음` | 생성기 출력 파일명 | 생성기 재실행. 적재는 새 이름 우선, 이전 이름(`events.ndjson.gz` 등)도 받는다 |
| `[1]` 적재 오류 (스키마·형식) | 오류 메시지의 열 이름 | `bigquery/schema/*.json` 과 CSV 헤더 대조 |
| `[n] … 실패: … bytesBilled` | `NP_MAX_BYTES` (기본 500MB) | 날짜 필터·열 선택을 먼저 줄인다. 상한을 올리는 건 마지막 |
| `… Cannot replace a table with a different partitioning spec` 류 | 표의 파티션·클러스터 설정을 바꿨다 | `CREATE OR REPLACE` 는 설정 변경을 거부한다. `scripts/bq.sh rm -f -t <데이터셋>.<표>` 로 그 표만 지우고 해당 단계를 다시 돌린다 |
| `[8] 검사 실패 k건` | 아래 쿼리 | C(대조)는 SQL 버그, R(범위)은 생성기 보정, I(무결성)는 원천 문제일 가능성이 크다 |

```sql
-- 마지막 실행의 실패 항목
SELECT check_id, check_name, left_value, right_value, observed, lower_bound, upper_bound, note
FROM ops.reconciliation
WHERE DATE(checked_at) >= CURRENT_DATE() - 1
  AND run_id = (SELECT MAX(run_id) FROM ops.reconciliation WHERE DATE(checked_at) >= CURRENT_DATE() - 1)
  AND NOT passed;

-- 단계별 시간·바이트
SELECT step, step_name, TIMESTAMP_DIFF(ended_at, started_at, SECOND) AS sec, rows_out, bytes_processed, status, message
FROM ops.build_log
WHERE DATE(started_at) >= CURRENT_DATE() - 1
ORDER BY started_at;
```

실패한 단계는 `ops.build_log` 에 `status = 'failed'` 와 오류 요약으로 남고 스크립트는 즉시 멈춘다. 이전 단계 표는 그대로다. 원인을 고친 뒤 그 단계부터 다시 돌린다.

## 검사 (8단계)

| ID | 종류 | 내용 | 통과 |
|---|---|---|---|
| C1a · C1b | 대조 | 결제 건수·금액: 로그 `purchase` vs `raw.db_payments` | 차이 0 |
| C2 | 대조 | 신청 건수: 로그 `apply_event` vs `raw.db_applications` | 차이 0 |
| C3 | 대조 | 일 방문 사람: `daily_metrics` 합 vs `int_person_day` 재집계 (날짜별) | 차이 0, 불일치 날짜 0 |
| C4 | 대조 | 주간 코호트 크기: `weekly_cohort` 0주차 vs 첫 방문 사람 (코호트 주별) | 차이 0 |
| C5 | 대조 | 채널 합: `daily_channel` 의 `sessions + auto_load_sessions` 합 vs `int_session` 행 수 (날짜별) | 차이 0 |
| R1~R8 | 범위 | architecture.md §6 의 8개 지표 | 범위 안 |
| I1 | 무결성 | 기기당 회원 1명 | 위반 0 |
| I2 | 무결성 | 채널 매핑 누락 세션 | 0 |
| I3 | 무결성 | `event_date` = 이벤트 시각의 KST 날짜 | 0 |
| I4 | 무결성 | 행사 원장에 없는 신청 | 0 |

범위 검사(R)의 분자·분모 정의는 [metrics.md](metrics.md) 의 해당 지표와 같다.

## 비용

전체 실행 1회에 쿼리 처리량 약 0.65GB(52주·이벤트 약 89만 행 기준). 적재는 무료다. 무료 한도(월 1TB 쿼리·10GB 저장) 안에서 하루 여러 번 돌려도 된다.

| 단계 | 처리량 | 비고 |
|---|---:|---|
| 3 `events_clean` | 약 220MB | 원천 전 열을 한 번 읽는 유일한 단계 |
| 4 `int_session` | 약 140MB | 정제 이벤트 전체 |
| 7 `daily_event` · `daily_venue` | 각 약 60MB | 정제 이벤트에서 필요한 열만 |
| 나머지 | 각 25MB 이하 | |

- 이벤트 표(`raw.ga4_events`, `staging.events_clean`)는 일 파티션 + 파티션 필터 필수다. 전체 재생성 SQL도 기간을 명시한다.
- 단계마다 `--maximum_bytes_billed` 상한(`NP_MAX_BYTES`, 기본 500MB)이 걸려 있어 상한을 넘는 쿼리는 실행되지 않는다.
- 마트·중간 표는 날짜 파티션과 세그먼트 클러스터를 둔다. 화면 조회는 기간 필터로 파티션만 읽는다.

## 운영 가정

실제 서비스라면 GA4 export(오전 도착)와 RDB 야간 스냅샷 이후 예약 실행이 1~9단계를 하루 한 번 돌리고, 원천이 늦으면 대기 후 재시도한다. 이 저장소는 로컬 1회 실행만 지원한다.
