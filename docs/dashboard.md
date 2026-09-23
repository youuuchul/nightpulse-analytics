# NightPulse KPI 대시보드 — 탭·지표·필터·데이터 계약

가상 서비스 시나리오로 생성한 데이터 · 실제 서비스 데이터 아님. 앱 코드는 `dashboard/`.

## 1. 원칙

1. **필터는 마트에 축이 있을 때만 붙인다.** 필터가 걸린 것처럼 보이는데 값이 안 변하는 카드는 만들지 않는다. 축이 없는 대상(공간·행사·캠페인)은 탭 안 **보기 전환**으로 분리하고, 그 보기에서는 세그먼트 줄을 대상 축 컨트롤(지역·장르 / 유형·가격대 / 캠페인)로 바꾼다.
2. **줄은 없애지 않고 바꾼다.** 필터 바는 기간 줄과 세그먼트 줄 두 줄, 높이 고정. 주간·월간 탭은 기간 줄이 주차·월 선택기로, 월간 보기는 세그먼트 줄이 범위(6/12개월) 선택으로 바뀐다.
3. **탭 구조는 스코어보드 → 메인 추이 → (대상 탭만) 표.** 설명 문장은 화면에 쓰지 않고 라벨·단위·창·분모 한 줄로 푼다(`방문자 944명 중`, `W1 리텐션 · 9/7 코호트`).
4. **비율은 화면에서 계산한다.** 마트는 분자·분모 열만 두고, 화면은 필터 적용 후 분자·분모를 각각 합산한 뒤 나눈다. 비율의 증감은 %p, 건수·금액의 증감은 %.
5. **단위를 섞지 않는다.** 일별 마트의 사람 수를 기간으로 합하면 사람이 아니라 사람 × 일이다. 사람 지표는 `person_day` 로 기간 고유를 세고(§3), 주간·월간 탭의 WAU·월 방문자·리텐션은 주간·월간 마트에서 읽는다.
6. **기간 길이에 따라 입자가 바뀐다.** 1일 = 시간별 차트, 120일 이하 = 일별, 그 이상 = 주별(월요일 시작). 개요 탭 추이 카드는 별도 규칙(§3b).
7. **대상을 고르면 기간이 따라간다.** 캠페인 보기의 기본 기간은 `캠페인 기간`(선택한 캠페인의 관측 범위, 전체 선택 시 모든 캠페인 범위). 선택기 옵션에 관측 기간을 병기한다.
8. 필터 상태는 전부 URL 쿼리에 있어 링크로 같은 화면을 공유할 수 있다.

## 2. 탭

| 탭 | 보기 | 세그먼트 줄 | 스코어보드 | 메인 차트 | 표 | 마트 |
|---|---|---|---|---|---|---|
| 개요 | — | 채널·플랫폼·회원 | 기준일 현황(누적 회원·공간, 필터 미적용) + 방문자·세션·활성 세션 비율·신규 방문자·가입·신청·결제·결제 금액 | 추이 카드 5개: 방문자 → 활성 세션 → 신규 방문자·가입 → 신청·결제 → 결제 금액 (§3b) | — | daily_metrics, hourly_metrics, person_day, daily_venue |
| 퍼널 | — | 채널·플랫폼·회원 | 전체 전환율(랜딩→결제)·최대 이탈 단계·가장 크게 변한 단계·탐색 도달률 | 단계 전환율 추이(상세→신청 화면, 신청 화면→결제. 28일 이상 주별, 미만 일별, 1일은 단계 막대) + 세그먼트별 퍼널 히트맵 표 | 드릴다운 ① 오디언스별 퍼널(오디언스 칩 → 도달률 표 + 주별 전환율) ② 경로 탐색 생키 · 보조 요일×시간대 (1일: 시간별 세션) | person_day, funnel_daily, daily_metrics, hourly_metrics, weekly_audience_funnel, weekly_path |
| 행사·결제 | 흐름 | 채널·플랫폼·회원 | 신청·결제·결제 금액·결제자당 금액·취소율 | 신청·결제 추이 + 결제 퍼널(행사 상세 → 신청 화면 → 결제) | — | daily_metrics, hourly_metrics, person_day |
| 행사·결제 | 행사별 | 유형·가격대 | 조회된 행사·신청·결제 금액·취소율 | 결제 금액 추이 | 행사별 성과 | daily_event |
| 행사·결제 | 공간별 | 지역·장르 | 조회된 공간·신청·결제 | 공간 상세 조회 추이 | 공간 순위 | daily_venue |
| 회원 | — | 채널·플랫폼·회원 | 가입·신규 방문자 대비 가입·회원 방문자·방문자 중 회원 비중·W1·W4 | 방문자 회원/비회원 누적 + 리텐션 곡선 W1~W12 | — | daily_metrics, hourly_metrics, weekly_cohort, person_day |
| 유입·광고 | 채널 | 채널·플랫폼·회원 | 세션·광고 세션 비중·신규 방문자·가입·결제 금액 | 유입 유형별 세션 누적 (1일: 막대 목록) | 채널별 성과 | daily_channel |
| 유입·광고 | 캠페인 | 캠페인 선택 | 집행(지출·노출·클릭, CTR) → 유입(세션·신규 방문자) → 행동(가입 + CAC·신청·결제 금액 + ROAS) | 지출 / 광고 세션 (두 차트, 이중 축 없음) | 캠페인 비교(행 클릭 = 선택) | daily_ad |
| 주간·월간 | 주간 | 채널·플랫폼·회원 · 기간 줄 → 주차 | WAU·신규·재방문·재방문 비중·주 2일+ 방문·W1(직전 주 코호트) | 주간 방문자 12주(신규/재방문) + 코호트 히트맵 W1~W12(12개 코호트 + 가중 평균) | — | weekly_activity, weekly_cohort |
| 주간·월간 | 월간 | 범위 6/12개월 · 기간 줄 → 월 | 방문자·신규·가입·결제 금액·취소율·W1 (전월 대비) | 월간 방문자(신규/재방문) + 월 코호트 M1~M6 | 월간 브리핑 | monthly_summary, monthly_cohort |

탭 순서는 도메인 탭 → 성격이 다른 주간·월간 탭(끝). 퍼널 탭은 표 열에 드릴다운 카드를 적었다. 옛 링크 `tab=explore` 는 퍼널 탭으로, `tab=explore&view=venue` 는 행사·결제 공간별로 연결된다.

## 3. 지표 산식 (화면 계산)

| 지표 | 산식 | 단위 |
|---|---|---|
| 방문자 (개요·회원 탭) | 기간·세그먼트 안 `visited` 비트를 가진 고유 `pk` 수(`person_day`). 키가 없으면 Σ persons 로 폴백 | 명 |
| 사람 지표 공통 | 방문자·회원 방문자·탐색·행사 상세·신청 화면·결제자·퍼널 단계는 전부 `person_day` 기간 고유 사람 수(마스크의 비트를 같은 날 모두 가진 고유 `pk`, `uniqueByMasks`). 건수(세션·신청·결제·금액)는 합, 신규·가입은 합(사람당 1회). 키가 없으면 마트 합으로 폴백 | 명 |
| 기준일 현황 (개요 탭) | 누적 회원 = `meta.to_date` 까지 Σ signups(전체, 필터 미적용) · 공간 = `daily_venue` 고유 venue_id | 명 · 곳 |
| 활성 세션 비율 | Σ engaged_sessions ÷ Σ sessions | 세션 |
| 탐색 도달률 (퍼널 탭) | 고유(visited ∧ explored) ÷ 고유(visited) | 명 |
| 단계 막대 (퍼널 탭 1일) | 누적 단계별 고유 사람, 막대 = 이전 단계 대비, 오른쪽 열 = 첫 단계 대비 | 명 |
| 결제 퍼널 (행사·결제) | 누적 조건 고유 사람: event_detail → event_detail ∧ apply_view → event_detail ∧ apply_view ∧ paid(같은 날 비트 AND). 뒤 단계가 앞 단계에 포함된다. 결제자당 금액의 결제자는 누적 조건 없이 고유(paid). `person_day` 가 없으면 daily_metrics 열 합(비누적)으로 폴백 | 명 |
| 결제자당 금액 | Σ pay_amount ÷ 고유(paid) | 원 |
| 취소율 | Σ cancels ÷ Σ applies | 건 |
| 신규 방문자 대비 가입 | Σ signups ÷ Σ new_persons | 사람 |
| 회원 방문자 · 방문자 중 회원 비중 | member_seg = member 인 날 visited 가 있는 고유 사람 ÷ 고유 방문자. 기간 중 가입한 사람은 가입 전(비회원)·후(회원) 양쪽에 나타나므로 회원 + 비회원 ≥ 방문자. 차트 일 버킷은 마트 값, 주 버킷(120일 초과)은 주 고유 | 명 |
| 상세 조회 표 열 (공간별·행사별) | `daily_venue`·`daily_event` 의 detail_viewers(그날 그 대상 상세를 본 고유 사람) 기간 합. 마트가 일 × 대상 집계라 기간 고유가 아니므로 열 이름 `조회 사람(일 합)`, 타일에는 두지 않는다. 공간 추이 차트도 같은 값의 버킷 합 | 사람(일 합) |
| 광고 탭 유입 | 세션 + 신규 방문자(Σ daily_ad.new_persons, 광고 세션이 첫 방문인 사람 — 사람당 1회라 합 = 고유). 열이 없으면 신규 타일을 숨긴다. 캠페인 귀속은 세션 라스트클릭이라 `person_day` 로 기간 고유를 낼 수 없어 방문자·활성 방문자 타일은 두지 않는다 | 세션 · 명 |
| W1 · W4 (회원 탭) | 기간 안에 시작한 코호트 중 해당 경과 주가 완결된 것만, Σ retained ÷ Σ cohort_size. 라벨에 쓰인 코호트 주 범위를 적고, 완결 코호트가 없으면 기간 안 코호트 범위와 `—` | 사람 |
| 광고 세션 비중 | channel1 = paid 의 Σ sessions ÷ Σ sessions | 세션 |
| CTR · CAC · ROAS | clicks ÷ impressions · spend ÷ signups · pay_amount ÷ spend | — |
| 재방문 비중 · 주 2일+ 방문 | returning_persons ÷ wau · two_plus_days ÷ wau | 사람 |
| 증감 | 직전 동일 길이 기간 대비(1일은 전일). 직전 기간이 데이터 범위 밖이면 표시하지 않는다 | % / %p |

### 3b. 개요 탭 추이 카드 (`TrendCard`)

카드 한 장 = 주 지표 1개(+ 같은 단위 보조 지표 1개, 실선만) · 왼쪽 차트 · 오른쪽 분해 타일. 탭 상태에 의존하지 않고 행·기간·세그먼트 상태만 받는다.

| 항목 | 규칙 |
|---|---|
| 전기 | 직전 동일 길이 기간 `[from − n, from − 1]`(n = 기간 일수, 1일이면 전일). 버킷 i 의 전기 값은 버킷 i 의 날짜를 n 일 당긴 구간의 값이며 같은 x 위치에 점선으로 겹친다. 전기 시작이 데이터 시작(`meta.from_date`)보다 이르면 점선·전기 대비를 숨기고 머리에 `전기 없음` |
| 그레인 | 토글 `자동·일·주·월`(카드별, URL 미저장). 자동 = 1일 → 시간, 14일 이하 → 일, 120일 이하 → 주, 그 이상 → 월. 버킷이 2개 미만이 되는 선택지는 비활성 |
| 버킷 | 주 = 기간 시작일부터 7일씩(마지막은 짧을 수 있음, 툴팁에 실제 범위). 월 = 달력 월과 기간의 교집합(부분 월은 툴팁에 범위 병기) |
| 버킷 값 | 건수·금액·신규·가입 = 버킷 합. 사람 지표(방문자) = 일 버킷은 일별 고유(마트 값), 주·월 버킷은 버킷 고유 사람(`person_day`, 없으면 합). 1일 시간별은 `hourly_metrics`(시간별 열이 없는 지표는 차트 없이 분해 타일만) |
| 분해 타일 | `전체` + 선택 축 값(회원/비회원 · 유료/비유료 · iOS/Android/웹)의 기간 값과 전기 대비 %. 사람 지표는 기간 고유(한 사람이 두 값에 나타나면 양쪽에 센다), 그 외는 합. 필터가 고정한 축은 선택기에서 비활성, 기본 축이 막히면 다음 축 |
| 툴팁 | 버킷(`9/21 (일)` · `9/15~9/21` · `2026-09`) / 지표 값 / 전기 대비 %(전기 0이면 `—`) / `전기 <범위>: 값` / 보조 지표 값과 전기 대비. 차트 영역 밖으로 나가지 않게 위치 보정 |
| 드릴다운 | 차트 클릭 → 가리킨 버킷으로 기간 변경: 일 → 그날(1일, 시간별), 주 → 그 7일(직접 기간), 월 → 그 달 전체(데이터 범위로 자름). URL 에 push 되어 뒤로 가기로 복귀 |

### 3a. 퍼널 탭 산식

`funnel_daily` 의 단계는 누적 조건이다(랜딩 ⊇ 상세 ⊇ 로그인·가입 ⊇ 신청 화면 ⊇ 결제). 화면은 같은 조건을 `person_day` 비트 AND(visited → +event_detail → +logged_in → +apply_view → +paid, 같은 날 판정)로 다시 세어 기간·세그먼트 안 **고유 사람 수**를 쓴다. 아래 n(k) 는 단계 k 의 고유 사람 수, `person_day` 가 없으면 funnel_daily 합으로 폴백.

| 지표 | 산식 | 단위 |
|---|---|---|
| 전체 전환율 | n(payment) ÷ n(landing) | 명 |
| 최대 이탈 단계 | 랜딩 대비 도달률 r(k) = n(k) ÷ n(landing) 에서 r(k−1) − r(k) 가 가장 큰 k. 값은 그 차(%p) | 명 |
| 가장 크게 변한 단계 | 직전 단계 대비 전환율 c(k) = n(k) ÷ n(k−1) 의 직전 동일 길이 기간 대비 차가 절댓값 최대인 k. 직전 기간이 데이터 범위 밖이면 비운다 | %p |
| 단계 전환율 추이 | 기간 28일 이상 주(월요일) 버킷, 미만 일 버킷마다 버킷 고유 사람으로 c(apply_view), c(payment). 분모 0인 버킷은 선을 끊는다 | 명 |
| 세그먼트별 퍼널 | 행 = 전체 + 세그먼트 값(선택한 축의 다른 값은 숨김), 칸 = r(k)(행마다 그 세그먼트의 고유 사람). 색은 열 안 최소~최대 명도 | 명 |
| 오디언스 도달률 | 기간과 겹치는 주(`week_start ∈ [기간 시작의 월요일, 기간 끝]`)를 합산해 오디언스별 Σ step_k ÷ Σ landing | 사람·주 |
| 오디언스 주별 전환율 | 주마다 Σ payment ÷ Σ landing (주 2개 이상일 때만 그림) | 사람·주 |
| 경로 비중 | 링크 세션 ÷ 출발 노드 세션(그 화면 세션 중), 링크 세션 ÷ step 1 세션 합(전체 세션 대비). 노드는 기간 안 세션 상위 12개 화면만 이름을 두고 나머지는 `(기타)` | 세션 |

오디언스끼리는 겹치므로 합산하지 않는다. 드릴다운 두 카드는 주 단위라 기간 프리셋이 1일·7일이어도 그 날짜가 속한 주 전체를 쓰며, 카드 머리에 주 수와 범위를 적는다. 두 표가 추출에 없으면(`weekly_audience_funnel` 키·`files.weekly_path` 부재) 카드는 '데이터 없음'.

코호트 히트맵은 선택한 주(월)까지 완결된 칸만 칠한다. 색은 한 색상의 명도 단계(값이 클수록 진함), 칸 안 숫자는 %.

## 4. 데이터 계약 (`dashboard/public/data/`)

**파일 분할과 로딩.** 첫 화면에 필요한 표만 `index.json` 에 담고, 큰 표는 화면이 필요할 때 받는다.

| 파일 | 내용 | 받는 시점 |
|---|---|---|
| `index.json` (고정 이름) | `meta` + `files` + `daily_metrics, daily_ad, daily_event, funnel_daily, weekly_cohort, monthly_cohort, weekly_activity, monthly_summary, weekly_audience_funnel` | 첫 요청 |
| `hourly_metrics.<해시>.json` | 행 배열 | 1일 보기(개요·행사·회원), 퍼널 탭 시간대 히트맵 |
| `daily_channel.<해시>.json` | 행 배열 | 유입·광고 탭 채널 보기 |
| `daily_venue.<해시>.json` | 행 배열 | 개요 상단 공간 수, 행사·결제 탭 공간별 보기 |
| `weekly_path.<해시>.json` | 행 배열 | 퍼널 탭 경로 탐색 |
| `person_day.<해시>.bin` + `person_day.meta.<해시>.json` | 사람×일 행동 비트(아래) | 사람 단위 지표가 있는 탭(개요·퍼널·행사 흐름·회원) |

- `files` = `{표 이름: 파일 이름}`(`person_day` 는 `.bin`, `person_day_meta` 는 메타 JSON). 이름의 8자리는 내용 SHA-256 앞자리라 내용이 바뀌면 이름이 바뀐다(캐시 무효화). `files` 에 없는 표는 추출되지 않은 것으로 본다.
- 화면은 `index.json` 도착 후 스코어보드를 그리고, 지연 표에 의존하는 타일·카드는 받는 동안 값 자리에 회색 바, 실패하면 `불러오지 못함` 한 줄. 같은 파일은 한 번만 받아 메모리에 둔다.
- 기준 크기(2026-09-23 추출, 사람 80,000명·52주): `index.json` 7.5MB(gzip 0.36MB), `person_day.bin` 5.6MB(gzip 2.6MB), 지연 JSON 4개 합 35.5MB(gzip 1.3MB).

**표 열.** 아래 키 = 마트 이름, 값 = 행 배열(`index.json` 의 키 또는 지연 JSON 파일 전체). 열 이름은 `docs/architecture.md` §2 마트 열과 같다. 날짜는 `YYYY-MM-DD`(KST), 월은 `YYYY-MM`, 금액은 정수 원.

| 키 | 열 |
|---|---|
| `meta` | `to_date, from_date, built_at, source(sample/bigquery), tables{name: rows}` |
| `daily_metrics` | `kst_date, channel1, device_platform, member_seg, persons, new_persons, sessions, engaged_sessions, explorers, detail_viewers, signups, apply_viewers, applies, payers, pay_count, pay_amount, cancels` |
| `hourly_metrics` | `kst_date, kst_hour, channel1, device_platform, member_seg, persons, sessions, applies, pay_count` |
| `daily_channel` | `kst_date, channel1, channel2, channel3, device_platform, member_seg, sessions, persons, new_persons, signups, applies, payers, pay_amount` |
| `daily_ad` | `kst_date, campaign_id, campaign_name, spend, impressions, clicks, sessions, persons, active_persons, signups, applies, payers, pay_amount` |
| `daily_event` | `kst_date, event_id, event_name, venue_name, event_type, price_tier, detail_viewers, applies, pay_count, pay_amount, cancels` |
| `daily_venue` | `kst_date, venue_id, venue_name, region, genre, detail_viewers, applies, pay_count` |
| `funnel_daily` | `kst_date, step(landing/detail/signup/apply_view/payment), channel1, device_platform, member_seg, persons` |
| `weekly_cohort` | `cohort_week, week_offset(0..12), channel1, device_platform, member_seg, cohort_size, retained` |
| `monthly_cohort` | `cohort_month, month_offset(0..6), member_seg, cohort_size, retained` |
| `weekly_activity` | `week_start, channel1, device_platform, member_seg, wau, new_persons, returning_persons, two_plus_days` |
| `weekly_audience_funnel` | `week_start, audience_id(new/returning/paid_inflow/past_payer/apply_no_pay/explorer_only), step(landing/detail/signup/apply_view/payment), channel1, device_platform, member_seg, persons` |
| `weekly_path` | `week_start, channel1, device_platform, member_seg, step(1..4, 정수), from_screen, to_screen, sessions` |
| `monthly_summary` | `month, persons, new_persons, signups, applies, pay_count, pay_amount, cancels, w1_retention, top_channel` |
| `person_day` | 바이너리 `person_day.<해시>.bin`: 행당 8바이트, 리틀엔디언 Uint32 2개. word0 = `pk`(비트 0–19) \| `d`(20–28) \| `c`(29) \| `p`(30–31), word1 = `m`(0) \| `f`(1–15), 나머지 비트 0. 행은 날짜·사람 키 순. 메타 `person_day.meta.<해시>.json` = `{base_date, codes, rows, row_bytes, layout}`. 날짜 = `base_date` + `d`일, `pk` 는 익명 사람 키(적재마다 재부여), `c`·`p`·`m` 은 `codes` 인덱스 — `codes = {c: [non_paid, paid], p: [android, ios, web], m: [guest, member]}`(적재 데이터의 고유값 정렬, 값이 늘면 인덱스가 바뀐다). `f` 는 비트 플래그(`src/lib/persons.ts` 의 `F`, 비트 정의는 `bigquery/sql/marts/person_day.sql` 머리 주석). 플래그가 없는 날은 행이 없다. 폭을 넘는 값이 나오면 `extract.py` 가 중단한다(`PD_BITS` 를 늘리고 `persons.ts` 를 같이 고친다). `meta.tables.person_day` 는 행 수 |

세그먼트 값: `channel1` ∈ {paid, non_paid}, `device_platform` ∈ {ios, android, web}, `member_seg` ∈ {member, guest}. 세그먼트 속성은 행마다 1개라 조합의 합이 전체다. `channel2` 는 `staging.map_channel` 의 2단계 값(direct·organic_search·organic_social·influencer·paid_social·referral·ai_referral·other), `top_channel` 도 같은 값을 쓴다. `price_tier` ∈ {free, standard, premium}.

**`docs/architecture.md` 와 다른 점**: `hourly_metrics` 에 세그먼트 축 3개가 있다. 시간대 히트맵과 1일 시간별 차트가 세그먼트 필터를 받아야 하므로 마트에 축을 추가한다.

`weekly_audience_funnel` 의 오디언스는 서로 겹치므로 오디언스끼리 더하지 않는다(`new` + `returning` 만 그 주 방문 사람 전체). `weekly_path` 의 `step = n` 은 n번째 화면 → n+1번째 화면 전이이고, `to_screen` 은 화면 이름 12개와 `(이탈)`·`(기타)` 중 하나다. 같은 주·세그먼트에서 `step = 1` 의 세션 합이 방문 세션 수다.

두 주간 마트의 원본 SQL(`bigquery/sql/marts/weekly_audience_funnel.sql`·`weekly_path.sql`)에 있는 보조 열 `step_order`(1~5)는 추출하지 않는다 — 화면은 `step` 이름으로 순서를 정한다. `weekly_path.step` 만 정수이고 나머지 표의 `step` 은 문자열이다.

`weekly_cohort.cohort_size` 는 경과 주와 무관하게 같은 값이 반복되며, 화면은 `week_offset = 0` 행의 값을 코호트 크기로 쓴다(월 코호트도 같다).

## 5. 헤더와 페이지

화면은 대시보드·프로젝트 개요(`?page=about`)·데이터(`?page=data`) 세 페이지다. 페이지 키는 대시보드 상태와 같은 URL 쿼리에 있어, 오가도 탭·기간·필터·선택한 표가 유지되고 브라우저 뒤로 가기가 동작한다. 링크는 실제 `href` 를 가져 새 탭으로도 열린다.

**헤더** — 왼쪽: 로고(대시보드로) + 페이지 이동. 대시보드에서는 `프로젝트 개요`·`데이터` 두 항목, 다른 페이지에서는 앞에 `대시보드` 가 붙고 현재 페이지를 강조한다. 오른쪽: 기준일(`meta.to_date`) · 저톤 밑줄 문장 `가상 서비스 시나리오로 생성한 데이터`(개요 페이지 데이터 설명 절 `#data-note` 로 이동) · 테마 토글. 폭 640px 미만은 두 줄(1줄 로고·페이지 이동, 2줄 기준일·문장·테마)로 접고 로고의 `KPI` 를 숨긴다.

**프로젝트 개요** — 대시보드 안에 설명 문장을 넣지 않기 위한 자리.

1. 한 문장 요약 + 데이터 설명 절(`#data-note`, 저톤 문단): 시나리오·분포 규칙으로 생성했고 실제 데이터를 포함하지 않음, 방문자 80,000명·회원 약 7,700명·52주·이벤트 약 880만 건 규모
2. 가상 프로덕트 배경 한 단락(공간·행사 탐색 → 신청 → 결제, 회원·비회원, 앱·웹, 광고 유입)
3. 핵심 퍼널 5화면 와이어프레임(홈·지도 → 행사 상세 → 로그인·가입 → 신청 화면 → 결제 완료)과 화면별 이벤트 이름
4. 데이터 흐름 도식(행동 로그·서비스 DB·광고 리포트 → raw → staging → marts, ops → JSON 추출 → 정적 웹). 폭 768px 미만은 세로 도식
5. 문서 카드 6개: 데이터 페이지(내부 이동) · SQL 카탈로그(`bigquery/README.md`) · 데이터 아키텍처 · 지표 정의 · 대시보드 설계 · 저장소

**데이터** — `public/catalog.json`(계약은 `docs/backlog.md` §6, 생성기 `bigquery/build_catalog.py --export`) + `public/data/`.

- 왼쪽: 층별 접이식 표 목록(표 이름 + 1행 그레인). 폭 1024px 미만은 상단 선택기(층별 그룹)로 바뀐다.
- 오른쪽: 선택 표 헤더(`층.표`, SQL 파일 GitHub 링크, 1행·키·파티션·클러스터·행 수·크기·원천·소비·검사) → 컬럼 표(이름·타입·설명, 폰 폭에서는 타입이 이름 아래로) → 미리보기(marts 만, 같은 이름 표의 첫 20행. 지연 표는 그 표를 고를 때 받는다. `person_day` 는 바이너리라 미리보기 없음). 미리보기 열 순서는 카탈로그 컬럼 순서이며, 추출되지 않은 컬럼(`step_order` 등)은 빠지고 카탈로그에 없는 추출 열은 뒤에 붙는다. 숫자는 오른쪽 정렬·고정폭, 가로 스크롤.
- 선택은 `table=<층.표>`. 없거나 모르는 값이면 `marts.daily_metrics`(없으면 첫 표).
- `catalog.json` 이 없거나 표가 0개면 `카탈로그 없음` 한 줄.

## 6. 캡처

`npm run build && npm run capture -- --all` 이 `dashboard/captures/` 에 탭별 라이트 화면과 보기 전환·1일·1년·세그먼트 조합·드릴다운 카드·데이터 없음·개요 추이 카드(90일·1년·7일+필터·툴팁 hover 좌/우/일/시간/다크/폰·주 버킷 클릭 드릴다운)·다크·폰 폭(390px)·개요 페이지·데이터 페이지(라이트·다크·폰·카탈로그 없음)·헤더(폰·태블릿 폭)를 저장한다. `catalog.json` 이 아직 없으면 `NP_CATALOG=<파일>` 로 다른 파일을 대신 물려 찍는다. README 대표 이미지는 `docs/img/` 에 최적화해 복사한다.
