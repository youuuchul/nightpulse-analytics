# 지표 정의

> 생성물 — 원본은 `dashboard/public/metrics.json`, 생성 `uv run dashboard/scripts/build_metrics_doc.py`. 이 파일을 직접 고치지 않는다.

마트 열 기준 정의. 비율은 마트에 저장하지 않고 분자·분모 열을 화면에서 나눈다(예외: 화면 계약상 `monthly_summary.w1_retention`). 산식의 원본은 `bigquery/sql/` 의 마트 생성 SQL 이며, 이 문서는 그 열을 가리킨다. 대시보드의 `지표 가이드` 페이지와 타일 이름 옆 `?` 가 같은 원본을 보여준다.

지표 83개 · 탭 7개.

## 탭이 답하는 질문

| 탭 | 질문 | 주 사용자 | 핵심 지표 |
|---|---|---|---|
| 개요 | 서비스가 이번 기간 커지고 있는가, 매출은 어디서 나오는가 | 경영진 · 전 직군 | V12 방문자 · M01 총 매출 · C12 결제 |
| 퍼널 | 방문한 사람이 결제까지 가는 길에서 어디서 가장 많이 빠지는가 | 프로덕트 · 데이터 분석 | C15 전체 전환율 · C16 최대 이탈 단계 · E01 탐색 도달률 |
| 행사·결제 | 어떤 행사·공간이 신청과 매출을 만들고, 객단가와 할인은 어떻게 움직이는가 | 운영 · 파트너십 | C07 결제자당 금액 · M06 티켓 객단가 · M08 파트너 티켓 매출 비중 |
| 회원 | 방문자가 회원·구독자로 바뀌고 남아 있는가 | 프로덕트 · 마케팅 | C01 신규 방문자 대비 가입 · R01 주간 리텐션 Wn · S01 구독자 |
| 공간 | 등록 공간과 파트너 계약이 어느 상권에서 늘고 B2B 매출로 이어지는가 | 파트너십 · 경영진 | P02 파트너 공간 · P05 B2B MRR · P03 신규 계약 |
| 유입·광고 | 어떤 유입과 캠페인이 가입·결제로 이어지고 비용 대비 효율은 어떤가 | 마케팅 | A02 광고 세션 비중 · A05 가입당 비용(CAC) · A06 ROAS |
| 주간·월간 | 주·월 단위로 활성 사용자와 재방문이 유지되는가 | 경영진 · 데이터 분석 | V03 주간 방문자(WAU) · V05 재방문 비중 · R03 월 리텐션 Mn |

## 공통 규칙

- **단위.** 사람 = `person_id`(회원이면 `member_id`, 아니면 기기 `client_id`). 기기 행 수를 사람 수로 쓰지 않는다. 세션 = (`client_id`, `session_id`). 건 = 원장 행(`order_id`·`contract_id`·`subscription_id`). 공간 = `venue_id`.
- **방문.** 자동 로드 세션(체류 0ms·화면 1개 이하·2초 이내)은 방문이 아니다. 모든 마트의 `sessions` 는 자동 로드를 뺀 방문 세션이고, 자동 로드는 `auto_load_sessions` 로 따로 둔다.
- **날짜.** 모든 날짜는 KST. 세션과 그 안의 행동은 세션 시작일에 속한다. 원장 지표는 신청일(`applied_date`)·결제일(`paid_at`)·계약일 기준.
- **세그먼트.** `channel1`(첫 유입 paid/non_paid)·`device_platform`(첫 방문 기기 ios/android/web)·`member_seg`(member/guest) 는 사람당 1개라 조합 합이 전체다. `member_seg` 는 일·시간 마트에서 그날 0시 기준이며 가입 당일은 `guest` 다. 예외: `daily_channel` 의 `channel1~3` 은 세션 라스트클릭 채널이다.
- **사람 수 합산.** 사람 열은 같은 날(주·월) 안에서 세그먼트끼리만 더할 수 있다. 여러 날을 더하면 같은 사람이 중복된다. 화면의 기간 고유 사람 수는 `person_day` 비트로 다시 세고, 주·월 고유는 `weekly_activity`·`monthly_summary` 를 쓴다.
- **로그 vs 원장.** 결제·신청·취소의 건수·금액은 원장이 기준이다(`daily_event`·`daily_venue`·`daily_revenue`·`monthly_summary`). `daily_metrics`·`hourly_metrics`·`daily_channel`·`daily_ad` 의 `applies`·`pay_count`·`pay_amount`·`cancels` 는 로그 이벤트 기준이며 원장과의 일치는 검사 C1·C2·C9 가 확인한다.
- **매출 세 갈래.** 티켓(행사 결제, 구독 할인 후 순액)·구독(소비자 월 구독 9,900원)·B2B(공간 파트너 월 이용료). 티켓·구독은 결제 원장, B2B 는 계약 원장의 월별 활성 계약 × 요금에서 나온다. 매출은 세그먼트 축이 없으므로 세그먼트 필터를 걸면 매출 타일·카드는 화면에서 빠진다.
- **비율.** 마트는 분자·분모 열만 두고 화면이 필터 적용 후 각각 합산한 뒤 나눈다. 비율의 증감은 %p, 건수·금액의 증감은 %.

## 방문·활동

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| V01 | 일 방문자 | 개요 | 사람 | 그날 방문 세션이 1개 이상인 사람 | Σ persons (같은 날 세그먼트끼리만 합산) | — | `daily_metrics.persons` | 하루 규모의 기본 단위 |
| V02 | 신규 방문자 | 개요 | 사람 | 그날이 첫 방문일인 사람 | Σ new_persons | — | `daily_metrics.new_persons` | 새로 들어오는 사람의 흐름 |
| V03 | 주간 방문자(WAU) | 주간·월간 | 사람 | 그 주(월요일 시작)에 방문한 고유 사람 | Σ wau (세그먼트 합) | — | `weekly_activity.wau` | 주 단위 활성 규모 |
| V04 | 월간 방문자(MAU) | 주간·월간 | 사람 | 그 달 방문한 고유 사람 | persons | — | `monthly_summary.persons` | 월 단위 활성 규모 |
| V05 | 재방문 비중 | 주간·월간 | 사람 | 그 주 방문자 중 이전 주에 첫 방문한 사람의 비중 | Σ returning_persons ÷ Σ wau | WAU | `weekly_activity.returning_persons`, `weekly_activity.wau` | 신규 유입 없이도 남는 사용자층의 두께 |
| V06 | 주 2일+ 방문 비중 | 주간·월간 | 사람 | 그 주 2일 이상 방문한 사람의 비중 | Σ two_plus_days ÷ Σ wau | WAU | `weekly_activity.two_plus_days`, `weekly_activity.wau` | 습관 형성 정도 |
| V07 | 방문 세션 | 개요 | 세션 | 자동 로드가 아닌 세션 | Σ sessions | — | `daily_metrics.sessions` | 방문의 양 |
| V08 | 활성 세션 비율 | 개요 | 세션 | 방문 세션 중 engaged 세션의 비율 | Σ engaged_sessions ÷ Σ sessions | 방문 세션 | `daily_metrics.engaged_sessions`, `daily_metrics.sessions` | 들어와서 실제로 머문 비율 — 유입 품질 신호 |
| V09 | 자동 로드 세션 비중 | 개요 | 세션 | 전체 세션 중 자동 로드 세션 | auto_load_sessions ÷ (sessions + auto_load_sessions) | 전체 세션 | `daily_metrics.auto_load_sessions` | 웹뷰·미리보기 같은 비방문 세션 규모 점검 |
| V10 | 세션당 체류 | 개요 | 초 | 방문 세션의 평균 체류 시간 | engagement_msec ÷ 1000 ÷ sessions | 방문 세션 | `daily_metrics.engagement_msec`, `daily_metrics.sessions` | 콘텐츠 몰입도 |
| V11 | 하루 2세션+ 비중 | 개요 | 사람 | 그날 방문 세션 2개 이상인 사람의 비중 | multi_session_persons ÷ persons | 일 방문자 | `daily_metrics.multi_session_persons`, `daily_metrics.persons` | 하루 안 재방문 |
| V12 | 방문자 | 개요 | 사람 | 기간·세그먼트 안에 방문한 고유 사람 | person_day 에서 visited 비트를 가진 고유 pk 수 (키가 없으면 Σ persons) | — | `person_day.flags(visited)`, `daily_metrics.persons` | 기간 규모의 기본 지표. 일 방문자를 더한 값(사람 × 일)과 다르다 |
| V13 | 시간대 세션 | 퍼널 | 세션 | 요일 × 시간대 방문 세션의 하루 평균(1일 보기는 시간별 세션) | Σ sessions ÷ 그 요일 날짜 수 | 요일별 일수 | `hourly_metrics.sessions` | 운영·푸시 시간대 결정 |
| V14 | 회원 방문자 | 회원 | 사람 | member_seg = member 인 날 방문한 고유 사람 | person_day 에서 member 코드 ∧ visited 고유 pk | — | `person_day.flags(visited)`, `person_day.m` | 로그인 상태로 돌아오는 핵심 사용자 규모 |
| V15 | 방문자 중 회원 비중 | 회원 | 사람 | 기간 방문자 중 회원으로 방문한 사람의 비중 | 회원 방문자 ÷ 방문자 | 방문자(기간 고유) | `person_day.flags(visited)`, `person_day.m` | 비회원 트래픽 의존도 |
| V16 | 주간 신규 | 주간·월간 | 사람 | 그 주가 첫 방문 주인 사람 | Σ new_persons | — | `weekly_activity.new_persons` | 주간 유입 |
| V17 | 주간 재방문 | 주간·월간 | 사람 | 그 주 이전에 첫 방문한 사람 중 그 주 방문 | Σ returning_persons | — | `weekly_activity.returning_persons` | 주간 유지 |

## 탐색

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| E01 | 탐색 도달률 | 퍼널 | 사람 | 방문자 중 지도·검색·검색 결과 화면을 본 사람 | 고유(visited ∧ explored) ÷ 고유(visited) | 방문자(기간 고유) | `person_day.flags(explored)`, `daily_metrics.explorers` | 탐색 기능이 쓰이는 정도 |
| E02 | 행사 상세 조회율 | 퍼널 | 사람 | 일 방문자 중 행사 상세를 본 사람 | detail_viewers ÷ persons | 일 방문자 | `daily_metrics.detail_viewers`, `daily_metrics.persons` | 행사 콘텐츠의 흡인력 |
| E03 | 신청 화면 도달률 | 퍼널 | 사람 | 일 방문자 중 신청 화면을 본 사람 | apply_viewers ÷ persons | 일 방문자 | `daily_metrics.apply_viewers`, `daily_metrics.persons` | 구매 의도 규모 |
| E04 | 행사 상세 조회 | 행사·결제 | 사람(일 합) | 그 행사 상세를 본 사람의 일별 합 | Σ detail_viewers | — | `daily_event.detail_viewers` | 행사별 관심도 순위 |
| E05 | 공간 상세 조회 | 행사·결제 | 사람(일 합) | 그 공간 상세를 본 사람의 일별 합 | Σ detail_viewers | — | `daily_venue.detail_viewers` | 공간별 관심도 순위 |
| E06 | 화면 경로 전이 | 퍼널 | 세션 | n번째 화면에서 n+1번째 화면으로 넘어간 방문 세션 | 링크 세션 ÷ 출발 노드 세션 | 그 단계 출발 화면의 세션 | `weekly_path.sessions` | 사람들이 실제로 움직이는 길 |
| E07 | 조회된 행사 | 행사·결제 | 건 | 기간 안 상세 조회·신청이 1건 이상 있는 행사 수 | 고유 event_id 수 | — | `daily_event.event_id` | 노출된 행사 폭 |
| E08 | 조회된 공간 | 행사·결제 | 곳 | 기간 안 상세 조회·신청이 1건 이상 있는 공간 수 | 고유 venue_id 수 | — | `daily_venue.venue_id` | 노출된 공간 폭 |

`weekly_path` 는 세션 안 `screen_view` 를 시각 순으로 앞 5개만 쓴다. 같은 화면이 연달아 나와도 그대로 센다. 기간 전체 기준 상위 12개 화면 밖은 `(기타)` 로 접는다. 단계 n 의 세션 합 = 화면을 n개 이상 본 세션 수이고, `step = 1` 합은 그 주 방문 세션 수와 같다(검사 C7).

## 전환

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| C01 | 신규 방문자 대비 가입 | 회원 | 사람 | 신규 방문자 대비 가입한 사람 | Σ signups ÷ Σ new_persons | 신규 방문자 | `daily_metrics.signups`, `daily_metrics.new_persons` | 첫 방문을 회원으로 바꾸는 힘 |
| C02 | 방문 → 가입 전환(기간 누적) | 회원 | 사람 | 기간 방문 고유 사람 중 기간 안 가입한 사람 | 고유(signed_up) ÷ 고유(visited) | 방문자(기간 고유) | `staging.int_person_day` | 검사 R3 기준값 |
| C03 | 행사 상세 → 신청 | 퍼널 | 사람 × 일 | 행사 상세를 본 사람 중 신청한 사람 | appliers ÷ detail_viewers | 행사 상세를 본 사람 | `daily_metrics.appliers`, `daily_metrics.detail_viewers` | 상세 화면의 설득력 |
| C04 | 신청 화면 → 신청 | 퍼널 | 사람 × 일 | 신청 화면을 본 사람 중 신청한 사람 | appliers ÷ apply_viewers | 신청 화면을 본 사람 | `daily_metrics.appliers`, `daily_metrics.apply_viewers` | 신청 양식의 마찰 |
| C05 | 신청 → 결제 완료 | 행사·결제 | 건 | 유료 행사 신청 중 결제 완료 | pay_count ÷ paid_tier_applies | 유료 행사 신청 | `daily_event.pay_count`, `daily_event.paid_tier_applies` | 결제 단계 이탈 |
| C06 | 취소율 | 행사·결제 | 건 | 신청 중 취소된 신청 | Σ cancels ÷ Σ applies | 신청 | `daily_metrics.cancels`, `daily_metrics.applies`, `daily_event.cancels` | 노쇼·환불 위험 |
| C07 | 결제자당 금액 | 행사·결제 | 원 | 기간 결제 금액을 기간 고유 결제자로 나눈 값 | Σ pay_amount ÷ 고유(paid) | 결제한 사람(기간 고유) | `daily_metrics.pay_amount`, `person_day.flags(paid)` | 사람당 지출 크기 |
| C08 | 방문 퍼널 단계 | 퍼널 | 사람 | 랜딩 → 행사 상세 → 로그인·가입 → 신청 화면 → 결제, 같은 날 누적 조건 | 단계별 고유 사람 (person_day 비트 AND) | 이전 단계 | `funnel_daily.persons`, `person_day.flags` | 퍼널 탭의 뼈대 |
| C09 | 오디언스별 퍼널 단계 | 퍼널 | 사람 × 주 | 그 주 그 오디언스 중 그 단계까지 도달한 사람 | Σ step_k ÷ Σ landing | 그 오디언스의 랜딩 | `weekly_audience_funnel.persons` | 누구에게 어느 단계가 막히는가 |
| C10 | 가입 | 개요 | 명 | 그날 가입한 사람(사람당 1회) | Σ signups | — | `daily_metrics.signups` | 회원 기반 성장 |
| C11 | 신청 | 행사·결제 | 건 | 행사 신청 이벤트 수 | Σ applies | — | `daily_metrics.applies` | 수요의 양 |
| C12 | 결제 | 개요 | 건 | 결제 완료 이벤트 수 | Σ pay_count | — | `daily_metrics.pay_count` | 거래의 양 |
| C13 | 결제 금액 | 개요 | 원 | 로그 결제 이벤트 금액 합(할인 전) | Σ pay_amount | — | `daily_metrics.pay_amount` | 세그먼트로 쪼갤 수 있는 거래액 |
| C14 | 결제 퍼널 | 행사·결제 | 사람 | 행사 상세 → 신청 화면 → 결제, 같은 날 누적 조건의 기간 고유 사람 | 고유(event_detail ∧ apply_view ∧ paid) 등 비트 AND | 이전 단계 | `person_day.flags` | 행사 화면 이후 결제까지의 이탈 |
| C15 | 전체 전환율 | 퍼널 | 사람 | 랜딩한 사람 중 같은 날 결제까지 간 사람 | n(payment) ÷ n(landing) | 랜딩(방문자) | `person_day.flags`, `funnel_daily.persons` | 퍼널 전체 효율 한 숫자 |
| C16 | 최대 이탈 단계 | 퍼널 | %p | 랜딩 대비 도달률이 가장 크게 떨어지는 단계 | argmax r(k−1) − r(k), r(k) = n(k) ÷ n(landing) | 랜딩 | `person_day.flags` | 개선 우선순위 |
| C17 | 가장 크게 변한 단계 | 퍼널 | %p | 직전 단계 대비 전환율의 전기 대비 변화가 가장 큰 단계 | argmax \|c(k) − c_prev(k)\| | 이전 단계 | `person_day.flags` | 배포·캠페인 영향 감지 |
| C18 | 세그먼트별 퍼널 | 퍼널 | 사람 | 세그먼트 값마다 랜딩 대비 단계 도달률 | n_seg(k) ÷ n_seg(landing) | 그 세그먼트의 랜딩 | `person_day.flags` | 어느 집단이 어디서 막히는가 |
| C19 | 조회 대비 신청 | 행사·결제 | 건 ÷ 사람(일 합) | 행사·공간별 상세 조회 대비 신청 | Σ applies ÷ Σ detail_viewers | 상세 조회 사람(일 합) | `daily_event.applies`, `daily_event.detail_viewers`, `daily_venue.applies` | 대상별 전환 효율 |
| C20 | 누적 회원 | 개요 | 명 | 기준일까지 가입한 사람 수(필터 미적용) | Σ signups (전체 기간) | — | `daily_metrics.signups` | 회원 기반의 크기 |

`funnel_daily` 의 단계는 누적 조건이다. 방문 → +행사 상세 → +로그인 상태(회원 ID 가 실린 방문 세션, 그날 가입 포함) → +신청 화면 → +결제. 같은 날 안에서 판정하며 뒤 단계는 앞 단계보다 클 수 없다.

오디언스(C09)는 사람 × 주로 판정하며 서로 겹친다. 오디언스끼리 더하지 않는다. `new` + `returning` 의 `landing` 합은 `weekly_activity.wau` 와 같다(검사 C6).

| 오디언스 | 조건 |
|---|---|
| `new` 신규 | 그 주가 첫 방문 주 (`weekly_activity.new_persons` 와 같은 판정) |
| `returning` 재방문 | 그 주 이전에 첫 방문 |
| `paid_inflow` 광고 유입 | 그 주 방문 세션 중 세션 라스트클릭 `channel1 = 'paid'` 1개 이상 |
| `past_payer` 결제 경험 | 그 주 시작 전 결제 1회 이상 (로그 결제 이벤트) |
| `apply_no_pay` 신청 후 미결제 | 그 주 시작 전 신청 1회 이상, 그 주 시작 전 결제 0회 |
| `explorer_only` 탐색만 | 그 주 행사 상세 조회 있음, 신청 화면 조회 없음 |

## 리텐션

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| R01 | 주간 리텐션 Wn | 회원 | 사람 | 첫 방문 주 코호트 중 n주 뒤 주에 방문한 사람 | Σ retained ÷ Σ cohort_size (week_offset = n, 완결 주만) | 코호트 크기 | `weekly_cohort.retained`, `weekly_cohort.cohort_size` | 제품이 다시 부르는 힘 |
| R02 | W1 리텐션(월 요약) | 주간·월간 | 사람 | 그 달 시작 코호트의 W1 재방문자 합 ÷ 코호트 크기 합 | w1_retention | 코호트 크기 | `monthly_summary.w1_retention` | 월 브리핑용 리텐션 |
| R03 | 월 리텐션 Mn | 주간·월간 | 사람 | 첫 방문 월 코호트 중 n달 뒤 달에 방문한 사람 | Σ retained ÷ Σ cohort_size (month_offset = n) | 코호트 크기 | `monthly_cohort.retained`, `monthly_cohort.cohort_size` | 장기 유지 |

코호트 = 첫 방문일이 속한 주(월요일 시작)·달. 검사 R1(W1 15~30%)·R2(W4 8~18%)는 관측이 끝난 코호트 전체 합으로 본다.

코호트 마트의 `member_seg` 는 코호트 주(달) 말일 기준 회원 여부다. 일 마트의 `member_seg`(그날 0시 기준)와 기준 시점이 다르다. `cohort_size` 는 경과 주(월)와 무관하게 반복되고 0주차 `retained = cohort_size`.

## 매출

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| M01 | 총 매출 | 개요 | 원 | 티켓(할인 후) + 구독 + B2B 순매출 합 | Σ net_amount (kind 전체) | — | `daily_revenue.net_amount` | 사업 규모의 한 숫자 |
| M02 | 티켓 매출 | 개요 | 원 | 행사 결제 순매출(구독 할인·환불 차감) | Σ net_amount (kind = ticket), net = gross − discount − refund | — | `daily_revenue.net_amount`, `daily_revenue.kind` | 거래 수수료 기반 매출 |
| M03 | 구독 매출 | 개요 | 원 | 소비자 구독 결제 합(월 9,900원 반복 결제) | Σ net_amount (kind = subscription) | — | `daily_revenue.net_amount`, `daily_revenue.kind` | 반복 매출 |
| M04 | B2B 매출 | 개요 | 원 | 파트너 공간 월 이용료를 일별로 나눠 쌓은 값 | Σ net_amount (kind = b2b) | — | `daily_revenue.net_amount`, `daily_revenue.kind` | 공급 측 매출 |
| M05 | 매출 구성 | 행사·결제 | 원 | 기간 매출의 종류별(티켓·구독·B2B) 비중 | 종류별 Σ net_amount ÷ 총 매출 | 총 매출 | `daily_revenue.net_amount`, `daily_revenue.kind` | 매출이 한 갈래에 쏠리는지 |
| M06 | 티켓 객단가 | 행사·결제 | 원 | 티켓 결제 1건당 결제 금액(할인 전) | Σ gross_amount ÷ Σ pay_count (kind = ticket) | 티켓 결제 건수 | `daily_revenue.gross_amount`, `daily_revenue.pay_count` | 가격대·상품 구성 변화 |
| M07 | 구독 할인액 | 행사·결제 | 원 | 구독자가 파트너 공간 행사를 결제할 때 받은 15% 할인 합 | Σ discount_amount (kind = ticket) | — | `daily_revenue.discount_amount` | 구독 혜택의 비용 |
| M08 | 파트너 티켓 매출 비중 | 행사·결제 | 원 | 티켓 순매출 중 파트너 공간 행사에서 나온 몫 | Σ net_amount (partner_flag) ÷ Σ net_amount (ticket) | 티켓 매출 | `daily_revenue.partner_flag`, `daily_revenue.net_amount` | 파트너 계약이 거래를 끌어오는가 |

티켓 할인: 구독자가 파트너 공간 행사를 결제하면 `discount_amount = round(price × 0.15)`. `partner_flag` 는 행사 개최 시점의 계약 여부이며 티켓 행에만 값이 있다.

B2B 는 결제 표가 아니라 계약 표에서 월 이용료로 계산한다. 일 행은 그날 활성 계약의 월 요금 ÷ 그 달 일수라서 한 달을 더하면 월 이용료 합이 된다. b2b 행의 `pay_count` 는 활성 계약 수, `payers` 는 공간 수.

매출 마트는 세그먼트 축이 없다. 개요 탭에서 세그먼트 필터를 걸면 매출 타일·매출 구성 카드는 빠진다.

## 구독

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| S01 | 구독자 | 회원 | 명 | 기간 마지막 날 활성 구독 중인 고유 회원 | active_subscribers (기간 끝일) | — | `daily_subscription.active_subscribers` | 반복 매출의 기반 |
| S02 | 신규 구독 | 회원 | 건 | 기간 안 시작한 구독 건수 | Σ new_subscribers | — | `daily_subscription.new_subscribers` | 구독 획득 |
| S03 | 구독 해지 | 회원 | 건 | 기간 안 끝난 구독 건수 | Σ churned_subscribers | — | `daily_subscription.churned_subscribers` | 구독 이탈 |
| S04 | 구독 MRR | 회원 | 원 | 기간 마지막 날 활성 구독자 × 월 요금 | mrr (기간 끝일) | — | `daily_subscription.mrr` | 월 반복 매출 규모 |
| S05 | 월 이탈률 | 회원 | 명 | 기간 해지를 기간 시작일 활성 구독자로 나눠 30일로 환산 | Σ churned_subscribers ÷ active_subscribers(기간 시작일) × 30 ÷ 기간 일수 | 기간 시작일 활성 구독자 | `daily_subscription.churned_subscribers`, `daily_subscription.active_subscribers` | 구독 유지력 — 시나리오 기준 월 6% |
| S06 | 구독 회원 결제 전환 | 회원 | 사람 | 구독 중 방문한 회원 중 티켓을 결제한 사람(비구독 회원과 비교) | 고유(member ∧ subscribed ∧ paid) ÷ 고유(member ∧ subscribed ∧ visited) | 구독 중 방문한 회원 | `person_day.flags(subscribed)`, `person_day.flags(paid)` | 구독이 결제를 늘리는가 |
| S07 | 구독자 티켓 결제 금액 | 회원 | 원 | 구독 중인 사람이 결제한 티켓 순매출 | Σ subscriber_ticket_amount | — | `daily_subscription.subscriber_ticket_amount` | 구독자의 거래 기여 |

구독은 회원만 가능하며 2025-12-01 출시. `person_day` 의 비트 32768 `subscribed` 가 그날 구독 활성 여부다. 구독자 vs 비구독 회원 비교는 member 코드인 날만 센다(한 사람이 기간 중 구독을 시작하면 양쪽에 모두 나타난다).

## 공간·파트너

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| P01 | 등록 공간 | 공간 | 곳 | 기간 끝일까지 등록된 공간 누적 | Σ registered_total (기간 끝일, 상권 합) | — | `daily_venue_registry.registered_total` | 공급 측 목록의 크기 |
| P02 | 파트너 공간 | 공간 | 곳 | 기간 끝일에 계약이 진행 중인 공간 | Σ partner_total (기간 끝일) | — | `daily_venue_registry.partner_total` | 유료 계약 공급자 규모 |
| P03 | 신규 계약 | 공간 | 건 | 기간 안 시작한 파트너 계약 | Σ new_contracts | — | `daily_venue_registry.new_contracts` | 영업 성과 |
| P04 | 계약 해지 | 공간 | 건 | 기간 안 끝난 파트너 계약 | Σ churned_contracts | — | `daily_venue_registry.churned_contracts` | 파트너 유지 |
| P05 | B2B MRR | 공간 | 원 | 기간 끝일 활성 계약의 월 이용료 합(basic 99,000 · pro 299,000) | Σ (mrr_basic + mrr_pro) (기간 끝일) | — | `daily_venue_registry.mrr_basic`, `daily_venue_registry.mrr_pro` | 공급 측 반복 매출 |
| P06 | 파트너 비중 | 공간 | 곳 | 등록 공간 중 파트너 공간 | 파트너 공간 ÷ 등록 공간 | 등록 공간 | `daily_venue_registry.partner_total`, `daily_venue_registry.registered_total` | 목록을 매출로 바꾸는 비율 |
| P07 | 공간 28일 조회 | 공간 | 사람(일 합) | 기준일까지 28일간 그 공간 상세를 본 사람의 일별 합 | detail_viewers_28d | — | `venue_registry.detail_viewers_28d` | 공간별 수요의 크기 — 지도 점 크기 |
| P08 | 공간 행사 수 | 공간 | 건 | 기준일까지 365일 그 공간에서 열린 행사 | events_365d | — | `venue_registry.events_365d` | 파트너 활동량 |
| P09 | 공간 티켓 매출 | 공간 | 원 | 기준일까지 365일 그 공간 행사의 티켓 순매출 | ticket_amount_365d | — | `venue_registry.ticket_amount_365d` | 공간별 거래 기여 |

`daily_venue_registry` 의 `*_total`·`mrr_*` 은 그날 값이라 기간으로 더하지 않고 기간 마지막 날 값을 쓴다. `new_*`·`churned_*` 만 기간 합.

`venue_registry` 는 기준일(`as_of_date`) 스냅샷이다. 파트너 판정은 `is_partner` 로만 한다 — 활성 계약이 없는 공간도 `plan`·계약일 열에 가장 최근 계약 값이 남는다. `status = closed` 공간은 지도·표에서 뺀다.

`daily_venue_registry` 의 축은 상권(`region`) 하나라 공간 탭 스코어보드·추이는 상권 선택만 받는다. 장르·파트너 여부는 기준일 스냅샷 `venue_registry` 를 쓰는 지도 카드 안에서만 고른다.

## 유입·광고

| 코드 | 이름 | 탭 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |
|---|---|---|---|---|---|---|---|---|
| A01 | 채널별 방문 세션 | 유입·광고 | 세션 | 세션 라스트클릭 채널별 방문 세션 | Σ sessions (channel1~3) | — | `daily_channel.sessions` | 유입 구성 |
| A02 | 광고 세션 비중 | 유입·광고 | 세션 | 방문 세션 중 광고(paid) 세션 | Σ sessions(channel1 = paid) ÷ Σ sessions | 방문 세션 | `daily_channel.sessions`, `daily_channel.channel1` | 광고 의존도 |
| A03 | 채널별 신규 유입 | 유입·광고 | 사람 | 그 채널 세션이 첫 방문인 사람 | Σ new_persons | — | `daily_channel.new_persons` | 새 사람을 데려오는 채널 |
| A04 | CTR | 유입·광고 | 건 | 노출 대비 클릭 | Σ clicks ÷ Σ impressions | 노출 | `daily_ad.clicks`, `daily_ad.impressions` | 소재 반응 |
| A05 | 가입당 비용(CAC) | 유입·광고 | 원 | 광고비를 광고 세션 안 가입으로 나눈 값 | Σ spend ÷ Σ signups | 광고 세션 안 가입 | `daily_ad.spend`, `daily_ad.signups` | 회원 한 명을 사는 비용(보수적) |
| A06 | ROAS | 유입·광고 | 배 | 광고 세션 안 결제 금액 ÷ 광고비 | Σ pay_amount ÷ Σ spend | 광고비 | `daily_ad.pay_amount`, `daily_ad.spend` | 광고비 회수 |
| A07 | 캠페인 방문자 · 활성 방문자 | 유입·광고 | 사람(일 합) | 광고 방문 세션(활성 세션)을 가진 사람 | Σ persons, Σ active_persons | — | `daily_ad.persons`, `daily_ad.active_persons` | 캠페인 유입 품질 |
| A08 | 광고비 | 유입·광고 | 원 | 캠페인 집행 금액 | Σ spend | — | `daily_ad.spend` | 집행 규모 |
| A09 | 노출 · 클릭 | 유입·광고 | 건 | 광고 리포트의 노출·클릭 | Σ impressions, Σ clicks | — | `daily_ad.impressions`, `daily_ad.clicks` | 집행 도달 |
| A10 | 광고 세션 | 유입·광고 | 세션 | 캠페인 라스트클릭 방문 세션 | Σ sessions | 클릭(클릭 대비 세션) | `daily_ad.sessions` | 클릭이 방문으로 이어지는 정도 |
| A11 | 캠페인 신규 방문자 | 유입·광고 | 사람 | 광고 세션이 첫 방문인 사람(사람당 1회) | Σ new_persons | — | `daily_ad.new_persons` | 광고가 데려온 새 사람 |

유입 분류는 세션 라스트클릭이다(`daily_channel.channel1~3`). 다른 마트의 세그먼트 `channel1` 은 사람의 첫 유입이다.

광고 귀속은 광고 세션 안에서 일어난 가입·결제만 센다. 이후 다른 채널로 돌아와 전환한 경우는 포함하지 않으므로 CAC 는 보수적(높게), ROAS 는 낮게 나온다.

채널 규칙(`channel1` paid/non_paid, `channel2` 유입 유형, `channel3` 플랫폼)의 원본은 `bigquery/sql/01_map_channel.sql` 하나다.
