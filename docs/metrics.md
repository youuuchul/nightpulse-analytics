# 지표 정의

마트 열 기준 정의. 비율은 마트에 저장하지 않고 분자·분모 열을 화면에서 나눈다(예외: 화면 계약상 `monthly_summary.w1_retention`, 분자·분모 열도 함께 둔다). 산식의 원본은 `bigquery/sql/` 의 마트 생성 SQL 하나이며, 이 문서는 그 열을 가리킨다.

## 공통 규칙

- **단위.** 사람 = `person_id`(회원이면 `member_id`, 아니면 기기 `client_id`). 기기 행 수를 사람 수로 쓰지 않는다. 세션 = (`client_id`, `session_id`). 건 = 원장 행(`order_id`).
- **방문.** 자동 로드 세션(체류 0ms·화면 1개 이하·2초 이내)은 방문이 아니다. 모든 마트의 `sessions` 는 자동 로드를 뺀 방문 세션이고, 자동 로드는 `auto_load_sessions` 로 따로 둔다.
- **날짜.** 모든 날짜는 KST. 세션과 그 안의 행동은 세션 시작일에 속한다. 원장 지표는 신청일(`applied_date`) 기준.
- **세그먼트.** `channel1`(첫 유입 paid/non_paid)·`device_platform`(첫 방문 기기 ios/android/web)·`member_seg`(member/guest) 는 사람당 1개라 조합 합이 전체다. `member_seg` 는 일·시간 마트에서 그날 0시 기준이며 가입 당일은 `guest` 다. 예외: `daily_channel` 의 `channel1~3` 은 세션 라스트클릭 채널이다.
- **사람 수 합산.** 사람 열은 같은 날(주·월) 안에서 세그먼트끼리만 더할 수 있다. 여러 날을 더하면 같은 사람이 중복된다. 기간 고유 사람 수는 `weekly_activity`·`monthly_summary` 를 쓴다.
- **로그 vs 원장.** 결제·신청·취소의 건수·금액은 원장이 기준이다(`daily_event`·`daily_venue`·`monthly_summary`, 신청일 기준). `daily_metrics`·`hourly_metrics`·`daily_channel`·`daily_ad` 의 `applies`·`pay_count`·`pay_amount`·`cancels` 는 로그 이벤트 기준이며 원장과의 일치는 검사 C1·C2 가 확인한다.

## 방문·활동

| 코드 | 이름 | 단위 | 분자 | 분모 | 마트 열 |
|---|---|---|---|---|---|
| V01 | 일 방문자 | 사람 | 그날 방문한 사람 | — | `daily_metrics.persons` |
| V02 | 신규 방문자 | 사람 | 그날이 첫 방문일인 사람 | — | `daily_metrics.new_persons` |
| V03 | 주간 방문자(WAU) | 사람 | 그 주 방문한 사람 | — | `weekly_activity.wau` |
| V04 | 월간 방문자(MAU) | 사람 | 그 달 방문한 사람 | — | `monthly_summary.persons` |
| V05 | 재방문자 비중 | 사람 | 그 주 방문자 중 이전 주에 첫 방문한 사람 | WAU | `weekly_activity.returning_persons / wau` |
| V06 | 주 2일+ 방문 비중 | 사람 | 그 주 2일 이상 방문한 사람 | WAU | `weekly_activity.two_plus_days / wau` |
| V07 | 방문 세션 | 세션 | 자동 로드 아닌 세션 | — | `daily_metrics.sessions` |
| V08 | 활성 세션 비중 | 세션 | engaged 이고 자동 로드 아닌 세션 | 방문 세션 | `daily_metrics.engaged_sessions / sessions` |
| V09 | 자동 로드 세션 비중 | 세션 | 자동 로드 세션 | 전체 세션 | `daily_metrics.auto_load_sessions / (sessions + auto_load_sessions)` |
| V10 | 세션당 체류 | 초 | 체류 합 / 1000 | 방문 세션 | `daily_metrics.engagement_msec / 1000 / sessions` |
| V11 | 하루 2세션+ 비중 | 사람 | 그날 방문 세션 2개 이상인 사람 | 일 방문자 | `daily_metrics.multi_session_persons / persons` |

## 탐색

| 코드 | 이름 | 단위 | 분자 | 분모 | 마트 열 |
|---|---|---|---|---|---|
| E01 | 탐색 도달률 | 사람 | 지도·검색·검색 결과 화면을 본 사람 | 일 방문자 | `daily_metrics.explorers / persons` |
| E02 | 행사 상세 조회율 | 사람 | 행사 상세를 본 사람 | 일 방문자 | `daily_metrics.detail_viewers / persons` |
| E03 | 신청 화면 도달률 | 사람 | 신청 화면을 본 사람 | 일 방문자 | `daily_metrics.apply_viewers / persons` |
| E04 | 행사 상세 조회 | 사람 | 그 행사 상세를 본 사람 | — | `daily_event.detail_viewers` |
| E05 | 공간 상세 조회 | 사람 | 그 공간 상세를 본 사람 | — | `daily_venue.detail_viewers` |

## 전환

| 코드 | 이름 | 단위 | 분자 | 분모 | 마트 열 |
|---|---|---|---|---|---|
| C01 | 신규 방문자 대비 가입 | 사람 | 가입한 사람 | 신규 방문자 | `daily_metrics.signups / new_persons` |
| C02 | 방문 → 가입 전환 (기간 누적) | 사람 | 기간 중 가입한 고유 사람 | 기간 중 방문한 고유 사람 | `staging.int_person_day` 고유 `person_id` (검사 R3) |
| C03 | 행사 상세 조회 → 신청 | 사람 × 일 | 신청한 사람 | 행사 상세를 본 사람 | `daily_metrics.appliers / detail_viewers` (검사 R4) |
| C04 | 신청 화면 → 신청 | 사람 × 일 | 신청한 사람 | 신청 화면을 본 사람 | `daily_metrics.appliers / apply_viewers` |
| C05 | 신청 → 결제 완료 | 건 | 유료 행사 신청 중 결제 완료 | 유료 행사 신청 | `daily_event.pay_count / paid_tier_applies` (검사 R5) |
| C06 | 취소율 | 건 | 취소된 신청 | 신청 | `daily_event.cancels / applies` (원장, 검사 R6). 흐름 탭은 `daily_metrics.cancels / applies` (로그) |
| C07 | 결제 금액 · 결제자당 금액 | 원 | 결제 금액 | 결제 사람 | `daily_metrics.pay_amount / payers`, 원장 `daily_event.pay_amount` · 순매출 `net_amount` |
| C08 | 방문 퍼널 단계 | 사람 × 일 | 그날 그 단계까지 도달한 사람 | 이전 단계 | `funnel_daily.persons` (`step` landing → detail → signup → apply_view → payment) |

`funnel_daily` 의 단계는 누적 조건이다. 방문 → +행사 상세 → +로그인 상태(회원 ID 가 실린 방문 세션, 그날 가입 포함) → +신청 화면 → +결제. 같은 날 안에서 판정하며 뒤 단계는 앞 단계보다 클 수 없다.

## 리텐션

| 코드 | 이름 | 단위 | 분자 | 분모 | 마트 열 |
|---|---|---|---|---|---|
| R01 | 주간 리텐션 Wn | 사람 | 코호트 중 n주 뒤 주에 방문한 사람 | 코호트 크기 | `weekly_cohort.retained / cohort_size` (`week_offset = n`, 0~12, `is_complete_week`) |
| R02 | W1 리텐션 (월 요약) | 사람 | 그 달 시작 코호트의 W1 재방문자 합 | 그 코호트 크기 합 | `monthly_summary.w1_retention` (= `w1_retained / w1_cohort_size`) |
| R03 | 월 리텐션 Mn | 사람 | 코호트 중 n달 뒤 달에 방문한 사람 | 코호트 크기 | `monthly_cohort.retained / cohort_size` (`month_offset` 0~6, `is_complete_month`) |

- 코호트 = 첫 방문일이 속한 주(월요일 시작)·달. 검사 R1(W1 15~30%)·R2(W4 8~18%)는 관측이 끝난 코호트 전체 합으로 본다.
- 코호트 마트의 `member_seg` 는 코호트 주(달) 말일 기준 회원 여부다. 일 마트의 `member_seg`(그날 0시 기준)와 기준 시점이 다르다. `cohort_size` 는 경과 주(월)와 무관하게 반복되고 0주차 `retained = cohort_size`.

## 유입·광고

| 코드 | 이름 | 단위 | 분자 | 분모 | 마트 열 |
|---|---|---|---|---|---|
| A01 | 채널별 방문 세션 | 세션 | 세션 라스트클릭 채널별 방문 세션 | — | `daily_channel.sessions` (`channel1~3`) |
| A02 | 광고 세션 비중 | 세션 | 광고(paid) 방문 세션 | 방문 세션 | `daily_channel` `channel1 = 'paid'` 의 `sessions` / 전체 `sessions` (검사 R7 은 집행일만) |
| A03 | 채널별 신규 유입 | 사람 | 그 채널 세션이 첫 방문인 사람 | — | `daily_channel.new_persons` |
| A04 | CTR | 건 | 클릭 | 노출 | `daily_ad.clicks / impressions` |
| A05 | 가입당 비용(CAC) | 원 | 광고비 | 광고 세션 안 가입 | `daily_ad.spend / signups` |
| A06 | ROAS | 배 | 광고 세션 안 결제 금액 | 광고비 | `daily_ad.pay_amount / spend` |
| A07 | 캠페인 방문자 · 활성 방문자 | 사람 | 광고 방문 세션(활성 세션)을 가진 사람 | — | `daily_ad.persons`, `daily_ad.active_persons` |

- 유입 분류는 세션 라스트클릭이다(`daily_channel.channel1~3`). 다른 마트의 세그먼트 `channel1` 은 사람의 첫 유입이다.
- 광고 귀속은 광고 세션 안에서 일어난 가입·결제만 센다. 이후 다른 채널로 돌아와 전환한 경우는 포함하지 않으므로 CAC 는 보수적(높게), ROAS 는 낮게 나온다.
- 채널 규칙(`channel1` paid/non_paid, `channel2` 유입 유형, `channel3` 플랫폼)의 원본은 `bigquery/sql/01_map_channel.sql` 하나다.
