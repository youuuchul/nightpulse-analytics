# SQL 카탈로그 작업 — 남은 단계 (임시, 완료 후 삭제)

1. 온라인 생성 `python3 bigquery/build_catalog.py` — INFORMATION_SCHEMA.TABLES/COLUMNS 실물 대조와 마지막 실행 요약 첫 실행(아직 한 번도 안 돌림, 쿼리 문법 미검증).
2. 생성된 `bigquery/README.md` 렌더 확인 — 표 카탈로그 폭, mermaid 계보(간선 약 50개) 가독성, 검사 표 헤더 줄.
3. `docs/pipeline.md` 정리 — 단계·검사 표를 README 링크로 바꾸고 절차(실행·재실행·실패 조치·비용)만 남긴다. 아직 손대지 않았다.
4. `bigquery/load_all.sh --only 8` 로 검사 단계 재실행 확인(파일 이동이 없어 경로 변경은 없음).
5. build_catalog.py 의 검사 표 구분선 줄(`if False` 잔재) 정리, ruff 확인, 이 파일 삭제.
