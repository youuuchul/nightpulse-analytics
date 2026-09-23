# NightPulse KPI 대시보드 — 탭·지표·필터·데이터 계약

합성 데이터 · 실제 서비스 데이터 아님. 앱 코드는 `dashboard/`.

## 1. 원칙

1. **필터는 마트에 축이 있을 때만 붙인다.** 필터가 걸린 것처럼 보이는데 값이 안 변하는 카드는 만들지 않는다. 축이 없는 대상(공간·행사·캠페인)은 탭 안 **보기 전환**으로 분리하고, 그 보기에서는 세그먼트 줄을 대상 축 컨트롤(지역·장르 / 유형·가격대 / 캠페인)로 바꾼다.
2. **줄은 없애지 않고 바꾼다.** 필터 바는 기간 줄과 세그먼트 줄 두 줄, 높이 고정. 주간·월간 탭은 기간 줄이 주차·월 선택기로, 월간 보기는 세그먼트 줄이 범위(6/12개월) 선택으로 바뀐다.
3. **탭 구조는 스코어보드 → 메인 추이 → (대상 탭만) 표.** 설명 문장은 화면에 쓰지 않고 라벨·단위·창·분모 한 줄로 푼다(`방문자 1,793명·일 중`, `W1 리텐션 · 9/7 코호트`).
4. **비율은 화면에서 계산한다.** 마트는 분자·분모 열만 두고, 화면은 필터 적용 후 분자·분모를 각각 합산한 뒤 나눈다. 비율의 증감은 %p, 건수·금액의 증감은 %.
5. **단위를 섞지 않는다.** 일별 마트의 사람 수를 기간으로 합하면 `사람·일`이다. 기간 고유 사람 수가 필요한 지표(WAU·월 방문자·리텐션)는 주간·월간 마트에서만 읽는다.
6. **기간 길이에 따라 입자가 바뀐다.** 1일 = 시간별 차트, 120일 이하 = 일별, 그 이상 = 주별(월요일 시작).
7. **대상을 고르면 기간이 따라간다.** 캠페인 보기의 기본 기간은 `캠페인 기간`(선택한 캠페인의 관측 범위, 전체 선택 시 모든 캠페인 범위). 선택기 옵션에 관측 기간을 병기한다.
8. 필터 상태는 전부 URL 쿼리에 있어 링크로 같은 화면을 공유할 수 있다.

## 2. 탭

| 탭 | 보기 | 세그먼트 줄 | 스코어보드 | 메인 차트 | 표 | 마트 |
|---|---|---|---|---|---|---|
| 개요 | — | 채널·플랫폼·회원 | 방문자(일평균)·신규 방문자·세션·활성 세션 비율·가입·결제 금액 | 방문자·신규 추이 (1일: 시간별 세션) | — | daily_metrics, hourly_metrics |
| 탐색 | 흐름 | 채널·플랫폼·회원 | 방문자(일평균)·탐색 도달률·행사 상세 조회율·신청 화면 도달률 | 방문 퍼널 5단계 + 요일×시간대 세션 히트맵 (1일: 시간별 세션) | — | daily_metrics, funnel_daily, hourly_metrics |
| 탐색 | 공간별 | 지역·장르 | 조회된 공간·상세 조회·신청·결제 | 공간 상세 조회 추이 | 공간 순위 | daily_venue |
| 행사·결제 | 흐름 | 채널·플랫폼·회원 | 신청·결제·결제 금액·결제자당 금액·취소율 | 신청·결제 추이 + 결제 퍼널(행사 상세 → 신청 화면 → 결제) | — | daily_metrics, hourly_metrics |
| 행사·결제 | 행사별 | 유형·가격대 | 조회된 행사·상세 조회·신청·결제 금액·취소율 | 결제 금액 추이 | 행사별 성과 | daily_event |
| 회원 | — | 채널·플랫폼·회원 | 가입·신규 방문자 대비 가입·회원 방문자(일평균)·방문자 중 회원 비중·W1·W4 | 방문자 회원/비회원 누적 + 리텐션 곡선 W1~W12 | — | daily_metrics, hourly_metrics, weekly_cohort |
| 유입·광고 | 채널 | 채널·플랫폼·회원 | 세션·광고 세션 비중·신규 방문자·가입·결제 금액 | 유입 유형별 세션 누적 (1일: 막대 목록) | 채널별 성과 | daily_channel |
| 유입·광고 | 캠페인 | 캠페인 선택 | 집행(지출·노출·클릭, CTR) → 유입(세션·방문자·활성 방문자) → 행동(가입 + CAC·신청·결제 금액 + ROAS) | 지출 / 광고 세션 (두 차트, 이중 축 없음) | 캠페인 비교(행 클릭 = 선택) | daily_ad |
| 주간·월간 | 주간 | 채널·플랫폼·회원 · 기간 줄 → 주차 | WAU·신규·재방문·재방문 비중·주 2일+ 방문·W1(직전 주 코호트) | 주간 방문자 12주(신규/재방문) + 코호트 히트맵 W1~W12(12개 코호트 + 가중 평균) | — | weekly_activity, weekly_cohort |
| 주간·월간 | 월간 | 범위 6/12개월 · 기간 줄 → 월 | 방문자·신규·가입·결제 금액·취소율·W1 (전월 대비) | 월간 방문자(신규/재방문) + 월 코호트 M1~M6 | 월간 브리핑 | monthly_summary, monthly_cohort |

탭 순서는 도메인 탭 → 성격이 다른 주간·월간 탭(끝).

## 3. 지표 산식 (화면 계산)

| 지표 | 산식 | 단위 |
|---|---|---|
| 방문자 · 일평균 | Σ persons ÷ 기간 일수 | 사람 |
| 활성 세션 비율 | Σ engaged_sessions ÷ Σ sessions | 세션 |
| 탐색 도달률 · 행사 상세 조회율 · 신청 화면 도달률 | Σ explorers · detail_viewers · apply_viewers ÷ Σ persons | 사람·일 |
| 방문 퍼널 | funnel_daily 단계별 Σ persons, 막대 = 이전 단계 대비 | 사람·일 |
| 결제자당 금액 | Σ pay_amount ÷ Σ payers | 원 |
| 취소율 | Σ cancels ÷ Σ applies | 건 |
| 신규 방문자 대비 가입 | Σ signups ÷ Σ new_persons | 사람 |
| 방문자 중 회원 비중 | member_seg = member 의 Σ persons ÷ Σ persons | 사람·일 |
| W1 · W4 (회원 탭) | 기간 안에 시작한 코호트 중 해당 경과 주가 완결된 것만, Σ retained ÷ Σ cohort_size | 사람 |
| 광고 세션 비중 | channel1 = paid 의 Σ sessions ÷ Σ sessions | 세션 |
| CTR · CAC · ROAS | clicks ÷ impressions · spend ÷ signups · pay_amount ÷ spend | — |
| 재방문 비중 · 주 2일+ 방문 | returning_persons ÷ wau · two_plus_days ÷ wau | 사람 |
| 증감 | 직전 동일 길이 기간 대비(1일은 전일). 직전 기간이 데이터 범위 밖이면 표시하지 않는다 | % / %p |

코호트 히트맵은 선택한 주(월)까지 완결된 칸만 칠한다. 색은 한 색상의 명도 단계(값이 클수록 진함), 칸 안 숫자는 %.

## 4. 데이터 계약 (`dashboard/public/data.json`)

최상위 키 = 마트 이름, 값 = 행 배열. 열 이름은 `docs/architecture.md` §2 마트 열과 같다. 날짜는 `YYYY-MM-DD`(KST), 월은 `YYYY-MM`, 금액은 정수 원.

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
| `monthly_summary` | `month, persons, new_persons, signups, applies, pay_count, pay_amount, cancels, w1_retention, top_channel` |

세그먼트 값: `channel1` ∈ {paid, non_paid}, `device_platform` ∈ {ios, android, web}, `member_seg` ∈ {member, guest}. 세그먼트 속성은 행마다 1개라 조합의 합이 전체다. `channel2` 는 `staging.map_channel` 의 2단계 값(direct·organic_search·organic_social·influencer·paid_social·referral·ai_referral·other), `top_channel` 도 같은 값을 쓴다. `price_tier` ∈ {free, standard, premium}.

**`docs/architecture.md` 와 다른 점**: `hourly_metrics` 에 세그먼트 축 3개가 있다. 시간대 히트맵과 1일 시간별 차트가 세그먼트 필터를 받아야 하므로 마트에 축을 추가한다.

`weekly_cohort.cohort_size` 는 경과 주와 무관하게 같은 값이 반복되며, 화면은 `week_offset = 0` 행의 값을 코호트 크기로 쓴다(월 코호트도 같다).
