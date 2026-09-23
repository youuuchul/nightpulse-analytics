# NightPulse 데이터 아키텍처

가상 나이트라이프 플랫폼 NightPulse의 행동 로그(GA4 형태)와 서비스 RDB(MySQL 가정)를 BigQuery 한 곳에 모아 KPI 대시보드까지 잇는 구조. 데이터는 전부 합성이다.

## 0. 설계 원칙

- **원천 둘, 층 넷.** 행동 로그(GA4 일 export)와 서비스 RDB(야간 스냅샷)를 `raw`에 그대로 두고, 정제·판정은 `staging`, 화면이 읽는 집계는 `marts`, 실행 기록은 `ops`. 층을 건너뛰는 참조를 만들지 않는다.
- **그레인을 표 이름과 설명에 적는다.** 모든 표는 "1행 = 무엇"이 한 줄로 설명돼야 하고, 그 열이 키다.
- **사람 단위와 기기 단위를 섞지 않는다.** 비회원은 기기(`client_id`), 회원은 `member_id`. 신원 규칙은 `COALESCE(member_id, client_id)` 한 줄이며 `staging.int_session`에서 한 번만 적용한다.
- **원장이 행동 로그의 진실이다.** 결제·신청·취소의 건수와 금액은 RDB 원장(`applications`·`payments`)에서 세고, 로그는 흐름(퍼널)을 보는 데 쓴다. 두 값의 차이는 `ops.reconciliation`에 남긴다. 구독자 수·파트너 계약·B2B 매출도 원장(`subscriptions`·`venue_contracts`)에서 센다.
- **활성 규칙 하나.** 구독·계약은 날짜 d(KST)에 `start_date <= d < end_date`(진행 중이면 스냅샷 기준일까지)일 때 활성이다. 종료일 당일이 해지일이다. 규칙은 `staging.dim_subscription`·`dim_contract` 머리 주석에만 적고 마트·검사가 같은 규칙을 쓴다.
- **파티션과 날짜 필터.** 이벤트 표는 `event_date` 일 파티션 + 파티션 필터 필수. 마트는 날짜 열로 파티션. 조회 SQL은 필요한 열만 쓴다.
- **1회 실행으로 전체 재현.** `bigquery/load_all.sh` 하나가 적재 → 정제 → 마트 → 대조 → 기록을 순서대로 돌리고, 같은 입력이면 같은 결과가 나온다.

## 1. 원천과 적재

| 원천 | 형태 | 적재 방식 | 대상 |
|---|---|---|---|
| 행동 로그 | GA4 BigQuery export를 단순화한 이벤트 행 (NDJSON) | `bq load`, 일 파티션, 전체 교체 | `raw.ga4_events` |
| 서비스 RDB | MySQL 테이블 야간 스냅샷 (CSV) | `bq load` 전체 교체, `snapshot_date` 열 추가 | `raw.db_members` `raw.db_venues` `raw.db_events` `raw.db_applications` `raw.db_payments` `raw.db_venue_contracts` `raw.db_subscriptions` |
| 광고 | 광고 플랫폼 일별 집행 리포트 (CSV) | `bq load` 전체 교체 | `raw.ads_spend` |

실제 운영이라면 RDB 스냅샷은 읽기 전용 복제본에서 S3로 내보내고 Transfer Service로 적재하는 경로를 가정한다. 이 저장소에서는 생성기가 같은 형식의 CSV를 만들고 로컬에서 적재한다. 접속 정보·키는 저장소에 두지 않는다.

## 2. 데이터셋과 표

리전 `asia-northeast3`. 표 설명(description)에 그레인·키·원천을 적는다.

### raw — 원천 그대로

| 표 | 1행 | 키 | 파티션 |
|---|---|---|---|
| `ga4_events` | 이벤트 1건 | (`user_pseudo_id`, `ga_session_id`, `event_timestamp`, `event_name`) — GA4 원본 열 이름 유지, `staging`부터 `client_id`·`session_id` | `event_date` |
| `db_members` | 회원 1명 | `member_id` | — |
| `db_venues` | 공간 1곳 (상권·구·좌표·등록일·상태) | `venue_id` | — |
| `db_events` | 행사 1건 (정원·가격대·가격·개최 시점 파트너 여부) | `event_id` | — |
| `db_applications` | 신청 1건 | `order_id` | — |
| `db_payments` | 결제 1건 (`kind` ticket/subscription, 할인액·구독 ID) | `order_id` | — |
| `db_venue_contracts` | 파트너 계약 1건 (basic/pro, 월 이용료) | `contract_id` | — |
| `db_subscriptions` | 소비자 구독 1건 | `subscription_id` | — |
| `ads_spend` | 캠페인 × 일 | (`campaign_id`, `date`) | `date` |

### staging — 정제·참조·중간

| 표 | 1행 | 키 | 내용 |
|---|---|---|---|
| `events_clean` | 이벤트 1건 | raw와 동일 | KST 변환(`kst_date`, `kst_hour`), 파라미터 평탄화(`page_path`, `venue_id`, `is_partner`, `event_id`, `order_id`, `amount`, 사용자 속성 `subscriber`), 중복 제거, 테스트 제외 |
| `map_channel` | (source, medium) 1쌍 | (`source`, `medium`) | 채널 3단계(`channel1` paid/non_paid, `channel2` 플랫폼군, `channel3` 플랫폼). 규칙의 유일한 원본 |
| `int_session` | 세션 1건 | (`client_id`, `session_id`) | 시작·종료 시각, 랜딩 화면, 라스트클릭 채널, 기기·OS, 자동 로드 판정, 활성 판정, `person_id` |
| `dim_subscription` | 구독 1건 | `subscription_id` | 시작·종료일(KST)·상태·월 구독료 + 구독 결제 건수·금액. 활성 규칙의 원본 |
| `int_person_day` | 사람 × 일 | (`person_id`, `kst_date`) | 플래그 BOOL 16종(방문·탐색·행사 상세·상세·가입·로그인 상태·신청 화면·신청·결제·취소·검색·홈 배너·공유·2세션+·구독 결제 이벤트 `sub_paid` + 상태 `subscribed` 그날 활성 구독), 회원 여부, 첫 방문 여부, 첫 유입 채널, 기기 플랫폼 |
| `dim_member` | 회원 1명 | `member_id` | 가입일·지역·장르·마케팅 동의 + 첫 유입 채널(로그에서 역산) |
| `dim_event` | 행사 1건 | `event_id` | 공간·유형·개최일·가격대 + 원장 집계(신청·결제·취소·매출) |
| `dim_contract` | 계약 1건 | `contract_id` | 공간·요금제·월 이용료·시작·종료일(KST). B2B 매출의 원천 |
| `dim_venue` | 공간 1곳 | `venue_id` | 상권·구·좌표·장르·유형·규모·등록일·상태 + 기준일 파트너 여부·요금제·계약일(없으면 최근 계약) |
| `fct_order` | 주문 1건 | `order_id` | 티켓 신청(`kind` ticket, 신청·결제·취소 한 행) + 구독 결제(`kind` subscription). 실결제액·할인액·환불·순매출, 개최 시점 파트너 여부. 행사·신청 지표는 ticket 만 |
| `ad_spend` | 캠페인 × 일 | (`campaign_id`, `date`) | 광고 집행 정리(raw를 마트가 직접 읽지 않게) |

### marts — 화면이 읽는 집계

| 표 | 1행 | 세그먼트 축 | 화면 |
|---|---|---|---|
| `daily_metrics` | 일 × 세그먼트 | 첫 유입 채널 · 기기 플랫폼 · 회원 여부 | 개요·탐색·회원 스코어보드와 추이 |
| `hourly_metrics` | 일 × 시(KST) × 세그먼트 | 위와 같음 | 시간대 패턴 히트맵, 1일 선택 시 시간별 차트 |
| `daily_channel` | 일 × 세션 채널 × 세그먼트 | 위와 같음 | 유입 탭. 이 마트의 `channel1~3`만 세션 라스트클릭이고 다른 마트의 `channel1`은 사람의 첫 유입 |
| `daily_ad` | 일 × 캠페인 | 없음 | 광고 탭 (지출·노출·클릭 → 세션 → 가입·결제, CAC·ROAS) |
| `daily_event` | 일 × 행사 | 없음 | 행사 리스트·결제 퍼널 (원장 기준) |
| `daily_venue` | 일 × 공간 | 없음 | 공간 상위 N |
| `daily_revenue` | 일 × 매출 종류(ticket/subscription/b2b) × 파트너 여부(티켓만) | 없음 | 매출 타일·매출 구성 스택. B2B = 활성 계약 월 요금 ÷ 그 달 일수 |
| `daily_subscription` | 일 | 없음 | 구독 보기(구독자·신규·해지·MRR·구독자 티켓 결제) |
| `daily_venue_registry` | 일 × 상권 | 없음 | 공간 탭(등록·파트너 누적, 신규 계약·해지, 요금제별 MRR) |
| `venue_registry` | 공간 1곳 (기준일 스냅샷) | 없음 | 공간 탭 지도·상권별 표·파트너 공간 표(365일 행사·매출, 28일 상세 조회 사람) |
| `funnel_daily` | 일 × 단계 × 세그먼트 | 위와 같음 | 퍼널(랜딩 → 상세 → 가입 → 신청 화면 → 결제) |
| `weekly_cohort` | 코호트 주 × 경과 주 × 세그먼트 | 위와 같음 | 리텐션 히트맵 W1·W2·W4·W8·W12 |
| `monthly_cohort` | 코호트 월 × 경과 월 | 회원 여부 | 월 리텐션 |
| `weekly_activity` | 주 × 세그먼트 | 위와 같음 | WAU·신규·재방문·2일+ |
| `monthly_summary` | 월 | 없음 | 월간 브리핑 표 (방문·가입·신청·결제·매출·리텐션·상위 채널 + 매출 구성·월말 구독자·월말 공간) |
| `weekly_audience_funnel` | 주 × 오디언스 × 단계 × 세그먼트 | 위와 같음 (`member_seg` 는 주 시작 기준) | 퍼널 탭 오디언스별 퍼널. 오디언스 6개(신규·재방문·광고 유입·결제 경험·신청 후 미결제·탐색만)는 서로 겹친다 |
| `weekly_path` | 주 × 세그먼트 × 단계(1~4) × from 화면 × to 화면 | 위와 같음 (`member_seg` 는 주 시작 기준) | 퍼널 탭 경로 탐색 생키. 세션당 앞 5개 화면 전이, 자동 로드 제외, 상위 12개 밖 `(기타)`, 끝나면 `(이탈)` |
| `person_day` | 사람 × 일 (플래그 없는 날 제외) | 위와 같음 (`member_seg` 는 그날 0시 기준) | 사람 지표 타일·분해·전기 대비의 기간 고유 사람 수. 익명 정수 키 `person_key`(적재마다 재부여, 원본 id 없음) + 플래그 비트 16종 `flags`(행동 15종 + 상태 32768 `subscribed`) |

세그먼트 속성은 사람당 1개이므로 조합의 합이 전체다. 마트는 가장 잘게 저장하고 합산은 화면에서 한다.

### ops — 실행 기록

| 표 | 1행 | 내용 |
|---|---|---|
| `build_log` | 실행 1회 × 단계 | 시작·종료 시각, 처리 행 수, 결과 |
| `reconciliation` | 실행 1회 × 대조 항목 | 로그 vs 원장 건수·금액, 마트 vs 정제층 재집계, 허용 오차, 판정 |
| `freshness` | 표 1개 | 마지막 적재 시각, 마지막 날짜 |

## 3. 파이프라인 단계

`bigquery/load_all.sh` 가 아래를 순서대로 실행한다. 각 단계는 멱등이다(전체 교체 또는 `DELETE` 후 `INSERT`).

1. `raw` 적재 — 이벤트 NDJSON, RDB 스냅샷 CSV 7개, 광고 CSV
2. `staging.map_channel` — 규칙 표 생성
3. `staging.events_clean`
4. `staging.int_session`
5. `staging.dim_subscription` · `int_person_day`
6. `staging.dim_member` · `fct_order` · `dim_event` · `dim_contract` · `dim_venue` · `ad_spend`
7. `marts.*` 18개
8. `ops.reconciliation`(`bigquery/checks/reconciliation.sql`) — 어긋나면 종료 코드 1
9. `ops.build_log` · `ops.freshness`

운영 가정: GA4 export는 매일 오전 도착, RDB 스냅샷은 야간. 실제라면 예약 쿼리나 워크플로 도구가 1~9를 하루 한 번 돌린다. 이 저장소는 로컬 1회 실행만 지원한다.

## 4. 대조 규칙

| 항목 | 기준 | 허용 |
|---|---|---|
| 결제 건수·금액 | 로그 결제 이벤트 vs `db_payments`(kind = ticket) | 정확히 일치 |
| 신청 건수 | 로그 신청 이벤트 vs `db_applications` | 정확히 일치 |
| 일 방문 사람 | `daily_metrics` 합 vs `int_person_day` 재집계 | 정확히 일치 |
| 주간 코호트 크기 | `weekly_cohort` 0주차 vs `int_person_day` 첫 방문 | 정확히 일치 |
| 채널 합 | `daily_channel` 세션 합 vs `int_session` | 정확히 일치 |
| 오디언스 합 | `weekly_audience_funnel` 신규+재방문 랜딩 vs `weekly_activity.wau` | 정확히 일치 |
| 경로 1단계 | `weekly_path` step 1 세션 합 vs 주간 방문 세션 | 정확히 일치 |
| 사람 마트 방문 | `person_day` 방문 플래그 고유 사람 vs `daily_metrics.persons`, 일 × 세그먼트별 | 정확히 일치 |
| C9 티켓 결제 | `daily_revenue` ticket 실결제액(정가 − 할인)·건수 vs `db_payments`(kind = ticket), 결제일별 | 정확히 일치 |
| C10 활성 구독자 | `daily_subscription.active_subscribers` vs `db_subscriptions` 활성일 재집계, 날짜별 | 정확히 일치 |
| C11 등록 공간 누적 | `daily_venue_registry.registered_total` 상권 합 vs `db_venues` 등록일 누적, 날짜별 | 정확히 일치 |

## 5. 명명·타입 규칙

- 표·열 이름은 소문자 스네이크. 날짜 `kst_date`(DATE), 시각 `*_at`(TIMESTAMP, UTC), 시(hour) `kst_hour`(INT64 0~23).
- 금액은 INT64 원. 비율은 마트에 저장하지 않고 화면에서 계산한다(분자·분모 열을 둔다).
- 플래그는 BOOL. 비트마스크·문자열 플래그를 쓰지 않는다.
- 세그먼트 축 열 이름은 전 마트 공통: `channel1`, `device_platform`, `member_seg`.
- 백업은 `backup` 데이터셋에만, 만료 7일.

## 6. 지표의 일반 범위 (합성 데이터가 지켜야 할 자리)

대시보드 숫자가 현업 감각에서 벗어나지 않도록 생성기와 대조 단계가 아래 범위를 확인한다.

| 지표 | 범위 | 비고 |
|---|---|---|
| 신규 방문자 W1 리텐션 | 15~30% | 콘텐츠·이벤트형 소비 서비스 통상 |
| W4 리텐션 | 8~18% | |
| 방문 → 가입 전환 | 6~12% | 기간 누적 사람 기준 |
| 상세 조회 → 신청 | 3~15% | 사람×일 기준. 회원·구독자는 상세에서 신청 화면으로 바로 가는 비중이 높아 일 단위 비율이 연간 사람 기준(약 5%)보다 높다 |
| 신청 → 결제 완료 | 55~75% | 무료 행사 제외 |
| 취소율 | 5~12% | 신청 대비 |
| 광고 세션 비중 | 10~30% | 집행 구간에서만 |
| 자동 로드(허수) 세션 | 5~10% | 제외 후 지표 계산 |
