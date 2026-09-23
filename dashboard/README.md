# dashboard — NightPulse KPI 대시보드 (정적 웹)

**합성 데이터 · 실제 서비스 데이터 아님.** 마트를 JSON 한 파일로 뽑아 정적 웹에서 읽는다. 실시간 조회는 없다.

- 스택: Vite + React 19 + TypeScript + Tailwind 3 + Recharts
- 입력: `public/data.json` 한 파일 (계약은 `docs/dashboard.md`)
- 탭·지표·필터 원칙: `docs/dashboard.md`

## data.json 을 만드는 두 경로

| 경로 | 명령 | 언제 |
|---|---|---|
| 합성 샘플 | `uv run dashboard/scripts/make_sample_data.py --out /tmp/sample.json` | 마트 완성 전 화면 개발. 시드 고정(20260923)·사람 3,500명·52주, 같은 인자면 같은 파일 |
| BigQuery 마트 | `uv run dashboard/scripts/extract.py` | 마트 적재 후. `scripts/bq.sh`(개인 GCP 래퍼)로 `marts.*` 13개를 SELECT 해 같은 계약으로 쓴다 |

둘 다 저장소 루트에서 실행한다. 추출의 기본 출력은 `dashboard/public/data.json`, 샘플의 기본 출력은 `/tmp/nightpulse_sample_data.json` 이다. 정적 배포가 이 파일을 그대로 쓰므로 커밋한다(현재 BigQuery 추출본). 샘플은 `--out /tmp/…` 로 따로 뽑아 덮어쓰지 않는다. `meta.source` 가 `sample` / `bigquery` 로 구분된다.

## 실행

```bash
cd dashboard
npm ci
npm run dev          # 개발 서버
npm run build        # tsc + vite build → dist/
npm run capture      # dist 를 preview 로 띄워 탭 6개 라이트 캡처 → captures/ (gitignore)
npm run capture -- --all   # + 보기 전환·1일·1년·다크·폰 폭
```

`dist/` 는 `base: './'` 로 빌드되어 어떤 정적 호스트 하위 경로에도 올릴 수 있다. `data.json` 은 `dist/` 에 함께 복사된다.

## 구조

```
src/
  App.tsx              탭·보기 정의, 필터 바 조립
  About.tsx            소개 페이지 (?page=about)
  lib/state.ts         URL 쿼리 ↔ 필터 상태
  lib/agg.ts           기간 해석·세그먼트 필터·합산·일/주 버킷
  lib/labels.ts        채널·가격대·퍼널 라벨, 색 슬롯
  components/          FilterBar · ui(타일·카드·범례) · charts(추이·히트맵·퍼널) · DataTable · ReachTable(도달률 히트맵 표) · PathSankey(경로 생키)
  tabs/                탭 6개 (각 탭 = 스코어보드 → 추이 → 표)
scripts/
  make_sample_data.py  합성 샘플 data.json
  extract.py           BigQuery 마트 → data.json
  capture.mjs          헤드리스 캡처
```
