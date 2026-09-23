#!/usr/bin/env bash
# 개인 GCP 전용 래퍼. 회사 기본 gcloud 설정(~/.config/gcloud)을 건드리지 않도록 설정 폴더와 프로젝트를 고정한다.
#   scripts/bq.sh login                  최초 1회: 개인 Gmail 로그인 + ADC
#   scripts/bq.sh whoami                 현재 계정·프로젝트 확인
#   scripts/bq.sh query "SELECT ..."     표준 SQL 실행
#   scripts/bq.sh <bq 서브커맨드> ...     그 밖의 bq 명령 그대로 전달 (load·mk·show 등)
set -euo pipefail
export CLOUDSDK_CONFIG="${HOME}/.config/gcloud-personal"
PROJECT="nightpulse-analytics"
LOCATION="asia-northeast3"
mkdir -p "$CLOUDSDK_CONFIG"
case "${1:-}" in
  login)
    gcloud auth login
    gcloud config set project "$PROJECT"
    gcloud auth application-default login
    ;;
  whoami)
    gcloud config list 2>/dev/null | grep -E 'account|project'
    ;;
  query)
    shift
    bq --project_id="$PROJECT" --location="$LOCATION" query --use_legacy_sql=false "$@"
    ;;
  "")
    sed -n '2,6p' "$0"; exit 1
    ;;
  *)
    bq --project_id="$PROJECT" --location="$LOCATION" "$@"
    ;;
esac
