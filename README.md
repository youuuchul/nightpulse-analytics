# nightpulse-analytics

GA4 export 형태의 **합성 이벤트 로그**를 BigQuery 층 구조(raw → staging → marts → ops)로 정제해 KPI 대시보드(정적 웹)까지 만드는 포트폴리오 프로젝트.

**이 저장소의 데이터는 전부 생성기가 만든 합성 데이터이며 실제 서비스·회사 데이터를 포함하지 않는다.** 설계는 업무 경험에서 온 일반적 패턴이고 특정 회사의 코드·데이터·식별자는 들어 있지 않다.

## 구조

```
generator/   시드 분포(generator/seed/*.csv) → 이벤트 로그 + 원장 생성 (Python)
bigquery/    자체 SQL: raw 적재 → staging → marts → ops, 1회 실행 스크립트
dashboard/   마트 → JSON 추출 → Vite + React 정적 웹
docs/        지표 정의서 · 파이프라인 · 설계 의도
data/        생성물 (gitignore, MANIFEST.txt 만 커밋)
scripts/     bq.sh — 개인 GCP 전용 래퍼 (설정 폴더·프로젝트 고정)
```

## 시드 분포

`generator/seed/` 의 CSV 는 이벤트 비중·전이 확률·요일×시 패턴·채널 구성·리텐션 곡선·세션 형태·카테고리 비중 같은 **비율·분위수** 뿐이다. 절대값·식별자·이름은 없다.

## 실행

준비 중. 단계: 생성기 → 적재 → 마트 → 대시보드 → 배포.

## 라이선스

MIT
