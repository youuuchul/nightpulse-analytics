# generator — 합성 데이터 생성기

**합성 데이터 · 실제 서비스 데이터 아님.** 가상 서비스 NightPulse(도시의 라이브·클럽 공간과 파티를 찾고 예매하는 모바일 웹)의 행동 로그와 서비스 원장을 한 루프에서 함께 만든다. 이름·지명·행사·캠페인은 전부 가상 조합이다.

## 실행

```bash
uv sync
uv run generator/generate.py --seed 20260923 --weeks 52 --persons 8000 --end-date 2026-09-20 --out data/
uv run generator/validate.py --data data/ --weeks 52 --end-date 2026-09-20
```

- 생성 약 30초, 검증 약 10초(노트북 1대 기준).
- 같은 `--seed` 와 같은 `seed/` 파일이면 산출물이 바이트 단위로 같다. `data/MANIFEST.txt` 의 SHA256 으로 확인한다(gzip 헤더 시각을 0으로 고정).
- 검증 단언이 하나라도 어긋나면 `validate.py` 가 exit 1 로 끝난다. 요약 통계는 `data/summary.md`.

## 입력

`seed/` 의 분포 파일. 전부 비율·분위수·전이 확률이고 절대값·식별자는 없다. 절대 규모(기간·사람 수)는 CLI 인자로 정한다. 이벤트명·화면명·경로는 이미 아래 「이벤트 체계」의 NightPulse 어휘로 적혀 있고, 범위 밖 도메인은 `(other_event)` · `(other_screen)` 한 줄로 합쳐져 있다.

| 파일 | 생성기에서 쓰는 곳 |
|---|---|
| `time_pattern.csv` | 요일 가중, 요일별 세션 시작 시(KST) 분포 |
| `session_shape.csv` | 세션 체류·시간 폭 분위수, 자동 로드 세션 비중, 기기 OS 비중 |
| `transitions.csv` | 화면 간 전이 확률 (아래 「화면 전이」) |
| `event_mix.csv` | `page_view`·`user_engagement`·`view_promotion` 의 세션 도달률 |
| `funnel_steps.csv` | 신청 화면 도달 후 신청 확률 |
| `channel_mix.csv` | 비광고 유입 source/medium 구성, 광고 노출→클릭→유입 비율 |
| `retention.csv` | 일반층 재방문 곡선의 초기 모양(W1 대비 W2·W4) |
| `popularity.csv` | 공간·행사 조회 집중도 곡선 |
| `name_map.csv` | 지역·장르 비중의 모양, 무료 행사 비중. 지역 값은 `names.json` 의 가상 지역 8개와 `(기타)` |
| `screen_mix.csv` | 참고용 (화면별 조회 비중) |
| `user_day_flags.csv` | 사용하지 않음 (마트 단계 검증용으로 남김, 범위 안 플래그만) |
| `names.json` | 가상 명칭 사전 — 지역 8·장르 6·행사 유형 5·공간 60·행사명 템플릿·캠페인 6 |

## 출력

`data/raw/` (gitignore, `data/MANIFEST.txt` 만 커밋). 파일 이름은 BigQuery `raw` 표 이름과 같고, 스키마는 `bigquery/schema/<표 이름>.json`. 서비스 RDB 스냅샷(`db_*`) 5개에는 `snapshot_date`(생성 종료일) 열이 붙는다.

| 파일 | 그레인 | 비고 |
|---|---|---|
| `ga4_events.ndjson.gz` | 이벤트 1행 | GA4 BigQuery export 를 단순화한 형태 |
| `db_members.csv` | 회원 1행 | 이름·연락처·이메일 컬럼 없음 |
| `db_venues.csv` | 공간 1행 | 60곳 |
| `db_events.csv` | 행사 1행 | 주당 2~8건, 시나리오 구간에 따라 증가 |
| `db_applications.csv` | 신청 1행 | `order_id` 로 이벤트와 1:1 |
| `db_payments.csv` | 결제 1행 | `order_id` 로 이벤트와 1:1 |
| `ads_spend.csv` | 일 × 캠페인 | 캠페인 6개 |

### 날짜·시각 형식 (ISO 8601)

- `ga4_events.event_date`: `YYYY-MM-DD`, **KST 기준 날짜**. BigQuery `DATE` 로 적재해 일 파티션 컬럼으로 쓴다.
- `ga4_events.event_timestamp`: UTC unix 마이크로초(정수). 시(hour) 분석은 KST 로 변환해서 한다.
- `ga_session_id`: 세션 시작 unix 초.
- 원장의 시각 컬럼(`signed_up_at`·`starts_at`·`applied_at`·`cancel_at`·`paid_at`): `YYYY-MM-DDTHH:MM:SSZ` (UTC).
- 날짜 컬럼(`ads_spend.date`, `db_*.snapshot_date`): `YYYY-MM-DD` (KST).
- 빈 `cancel_at` 은 빈 문자열이며 적재 시 NULL 이 된다.

### 이벤트 행 스키마

`event_date, event_timestamp, event_name, user_pseudo_id, user_id, ga_session_id, ga_session_number, engagement_time_msec, page_location, page_title, session_engaged, device_category, operating_system, traffic_source{source, medium, campaign, content}, user_properties[{key, string_value}], event_params[{key, string_value, int_value}]`

GA4 원본과 다른 점(의도한 단순화):

- 세션 ID·세션 번호·체류·페이지·engaged 를 `event_params` 가 아니라 최상위 열로 둔다.
- `traffic_source` 는 GA4 원본에서는 사용자 첫 유입이지만, 여기서는 **세션 단위 라스트클릭**이다. 첫 유입은 `user_properties.first_channel`(paid / non_paid).
- `engagement_time_msec` 은 직전 이벤트 이후 체류이며 세션 안 합이 세션 체류다.

## 이벤트 체계

| 이벤트 | 발생 조건 | 주요 파라미터 |
|---|---|---|
| `session_start` | 세션 시작 | — |
| `first_visit` | 기기의 첫 세션 | — |
| `page_view` | 랜딩(도달률 확률) | — |
| `screen_view` | 화면 진입 | `screen_name`, `event_id` 또는 `venue_id` |
| `user_engagement` | 화면 체류 기록 | — |
| `view_promotion` · `select_promotion` | 홈 배너 노출·선택 | `promotion_id`, `event_id` |
| `search` | 검색 결과 진입 | `search_term` |
| `share` | 상세 화면 공유 | `content_type`, `method` |
| `login` | 기존 회원의 로그아웃 기기 로그인 | `method` |
| `sign_up` | 가입(취향 설정 완료) | `method` |
| `apply_event` | 행사 신청 | `event_id`, `order_id`, `value`, `currency`, `price_tier` |
| `purchase` | 유료 행사 결제 성공 | 위 + `payment_method` |
| `cancel_apply` | 신청 취소 | `event_id`, `order_id`, `value`(환불액) |

화면(`screen_name`) 12종: `home` · `map_main` · `search_main` · `search_result` · `venue_detail` · `venue_review` · `event_detail` · `event_apply` · `login` · `taste_setup` · `payment_confirm` · `payment_success`. URL 은 `https://nightpulse.app/` 아래 `/event/{id}`, `/venue/{id}`, `/event/{id}/apply` 등.

## 생성 규칙

### 순서

1. **카탈로그**: 공간 60곳(지역·장르·규모), 행사(주당 수는 시나리오 구간별, 시작은 목~토 밤에 몰림, 공개는 시작 10~28일 전). 가격대는 무료 / 15,000~25,000원 / 40,000~60,000원.
2. **광고 계획**: 캠페인 6개, 집행 구간이 서로 다르다. 일 예산 → 노출(CPM) → 클릭을 seed 비율로 계산해 `ads_spend` 를 쓰고, 광고 유입 세션은 클릭의 60~90%(캠페인별, 기본 80%)로 만든다. 유입 세션 중 45%는 신규 사람, 나머지는 기존 방문자의 그날 첫 세션.
3. **사람**: 첫 방문일(구간별 유입 가중 × 월 계절 계수 × 요일 가중, 광고 유입은 광고 계획에서), 첫 유입 채널, 취향(지역·장르), 가입 의향과 가입 방문 차수, 기기 1~2대.
4. **방문 일정**: 날짜 루프 × 사람 벡터. 일반층(대부분)은 첫 주 이후 빠르게 재방문 확률이 줄고, 단골층은 유지 기간(지수분포) 동안 자주 방문한다. 가입 후 재방문 가중. 결과 리텐션은 W1 → W4 → W8 → W12 로 완만히 감쇠한다.
5. **세션**: 방문일마다 1~3세션(단골층 1~4), 시작 시각은 요일별 시 분포. 자동 로드 세션(체류 0, 화면 1개, 2초 이내)을 seed 비중만큼 섞는다.
6. **이벤트**: 랜딩 → 화면 전이 → 신청 게이트·결제·취소 로직. 체류·시간 폭은 세션 화면 수의 분위수 위치에 맞춰 seed 분위수에서 뽑는다.
7. **원장**: 이벤트를 쓰는 같은 루프에서 원장 행을 쓴다.

### 시나리오 4구간

| 주 | 구간 | 특징 |
|---|---|---|
| 1~10 | 런칭 | 유입이 낮게 시작해 오름, 신규 비중 높음 |
| 11~24 | 광고 | 캠페인 3회(유입 급증), 광고 세션은 이탈이 많아 활성률 하락 |
| 25~40 | 안정 | 재방문 가중 상승 |
| 41~52 | 피크 시즌 | 행사 수·신청 전환 상승, 여름 페스티벌 시즌 캠페인 |

캠페인 6개 중 1개는 런칭 구간, 3개는 광고 구간, 1개는 안정 구간, 1개는 피크 시즌 구간에 있다.

### 화면 전이

seed 전이는 이벤트 단위(화면 + 비화면 이벤트)다. 비화면 이벤트와 범위 밖 화면을 통과 노드로 두고 흡수 마르코프 연쇄를 풀어 **출력 화면 → 다음 출력 화면(또는 종료)** 확률로 접는다. 상위 200개만 있는 행은 재정규화한다. 결제 화면·로그인·취향 설정은 전이에서 빼고 신청 로직이 직접 만든다. 광고 세션은 행사 상세로 랜딩한다.

### 단일 신원 규칙

- 사람을 먼저 만들고 기기(`user_pseudo_id`)를 1~2대 배정한다. 2번째 기기는 가입 의향자에게만 있고, 가입 후 방문에서 쓰이며 첫 세션에서 로그인한다.
- 가입·로그인 이후 이벤트에는 `user_id` 가 실린다. 가입 전 이벤트는 `user_id` 가 비어 있다.
- 한 세션에 두 회원이 섞이지 않고, 한 기기에 두 회원이 붙지 않는다(검증 단언).
- 따라서 사람 = 기기에 붙은 `user_id`(있으면) 또는 기기. 기기 수 > 사람 수.

### 원장 동시 생성

- `sign_up` 1건 = `db_members` 1행, 시각 동일.
- `apply_event` 1건 = `db_applications` 1행 (`order_id` 동일).
- `purchase` 1건 = `db_payments` 1행 (`order_id`·금액·시각 동일).
- `cancel_apply` → `db_applications.status = canceled`, `cancel_at`·`cancel_amount` 기록, 유료분은 `db_payments.status = refunded`.
- 비회원이 신청 화면에 닿으면 로그인 화면에서 대부분 이탈한다(가입 게이트). 가입 방문이면 로그인 → 취향 설정 → `sign_up` 후 신청으로 이어진다.

### seed 이상치 처리

seed 창은 몇 주 길이라 단발 급증이 섞여 있다. 1년치에 그대로 반복하면 매주 같은 요일에 급증이 생기므로, **요일 합이 중앙값의 1.5배를 넘는 요일은 정상 요일 평균 모양으로 바꾼다**. 행사 조회 집중도는 지수 0.6으로 완화해 한 행사가 주 단위 지표를 좌우하지 않게 한다.

## 보정 손잡이

`generate.py` 상단 상수. 리텐션 모양은 `RETURN_BASE`·`CASUAL_SIGMA`·`CASUAL_TAIL`·`CORE_SHARE`·`CORE_LIFE_WEEKS`, 규모는 `CORE_DAILY`·`CORE_SESSIONS_PER_DAY`, 가입률은 `SIGNUP_INTENT`, 신청률은 `APPLY_MULT`, 결제 완료율은 `PAY_SUCCESS`, 취소율은 `CANCEL_PER_SESSION`, 광고 세션 비중은 `AD_BUDGET_SCALE`·`PAID_NEW_SHARE`, 클릭 대비 세션은 `AD_SESSION_RATIO` 로 맞춘다. 값을 바꾸면 SHA256 이 바뀌므로 MANIFEST 를 다시 커밋한다.

## 검증 단언 (`validate.py`)

정합성: 결제 이벤트 수 = `db_payments` 행 수 · 결제 order_id 집합 일치 · 결제 금액 합 일치 · 신청 이벤트 수 = `db_applications` 행 수 · 신청 order_id·회원 일치 · 취소 이벤트 = canceled 행(금액 합 포함) · 환불 결제 = 취소된 유료 신청 · 가입 이벤트 수 = `db_members` 행 수 · 신청 event_id 가 행사 원장에 존재 · 세션 내 user_id 단일 · 기기당 user_id 단일 · 기기 수 > 사람 수 · 날짜 범위 = 지정 주 수 · 이벤트 행 70만~120만 · `snapshot_date` = 종료일 · 캠페인별 광고 세션 ÷ 클릭 0.55~0.95 · 리텐션 W1 > W2 > W4 > W8 > W12.

일반 범위(`docs/architecture.md` §6 기준, 가입 전환과 2기기 비율은 이 생성기에서 조정): 아래를 벗어나면 실패한다.

| 지표 | 범위 | 계산 |
|---|---|---|
| 신규 방문자 W1 리텐션 | 15~30% | 첫 방문 주 코호트(사람, 완결 코호트) 중 다음 주 방문 |
| W4 리텐션 | 8~18% | 같은 코호트 중 4주 뒤 방문 |
| 방문 → 가입 | 6~12% | 가입 회원 ÷ 기간 내 방문 사람 |
| 회원 중 2기기 비율 | 30~40% | 기기 2대가 붙은 회원 ÷ 회원 |
| 행사 상세 → 신청 | 3~8% | 신청한 사람 ÷ 행사 상세를 본 사람 (기간 누적) |
| 신청 → 결제 완료 | 55~75% | 유료 행사 신청 중 결제 완료 |
| 취소율 | 5~12% | 취소 ÷ 신청 |
| 광고 세션 비중 | 10~30% | 캠페인 집행일의 방문 세션 중 `paid_social` |
| 자동 로드 세션 | 5~10% | 체류 0·화면 1개 이하·핵심 행동 없음·2초 이내 |

사람 = 기기에 붙은 `user_id`(있으면) 또는 기기. 자동 로드 세션은 비율 계산에서 뺀다.

## 기준 실행 결과 (seed 20260923, 52주, 8,000명)

| 항목 | 값 |
|---|---|
| 이벤트 행 | 856,072 |
| 기기 / 사람 | 8,234 / 7,999 |
| 회원 | 712 (8.9%) |
| 신청 / 결제 / 취소 | 3,692 / 1,831 / 313 |
| 리텐션 W1 / W2 / W4 / W8 / W12 | 0.215 / 0.136 / 0.099 / 0.085 / 0.077 |
| 방문 → 가입 / 회원 2기기 | 0.089 / 0.330 |
| 상세 → 신청 / 신청 → 결제 / 취소율 | 0.051 / 0.669 / 0.085 |
| 광고 세션 비중(집행일) / 자동 로드 | 0.200 / 0.073 |
| 캠페인별 광고 세션 ÷ 클릭 | 0.62 ~ 0.86 |

단언 26개 통과, 같은 seed 재실행 시 SHA256 동일(`data/MANIFEST.txt`).
