#!/usr/bin/env bash
# 취업규칙 챗봇 실행 스크립트 (React + FastAPI 단일 서버)
#
# 사용법:
#   ./run.sh build   — 프론트엔드 빌드 (frontend/dist 생성)
#   ./run.sh dev      — 개발 모드 (FastAPI + Vite dev 동시 안내)
#   ./run.sh          — 운영 모드 (빌드된 dist를 FastAPI가 서빙)
set -e

cd "$(dirname "$0")"
PORT="${SERVER_PORT:-8085}"

case "${1:-serve}" in
  build)
    echo "▶ 프론트엔드 빌드..."
    cd frontend && npm install && npm run build
    echo "✅ frontend/dist 생성 완료"
    ;;
  dev)
    echo "▶ 개발 모드"
    echo "  터미널 1: TOKENIZERS_PARALLELISM=false .venv/bin/python -m uvicorn api.main:app --reload --port $PORT"
    echo "  터미널 2: cd frontend && npm run dev   (http://localhost:5173)"
    ;;
  serve|*)
    if [ ! -d frontend/dist ]; then
      echo "⚠ frontend/dist 없음 — 먼저 './run.sh build' 실행 필요"
      exit 1
    fi
    echo "▶ 운영 모드: http://localhost:$PORT (API + 프론트 단일 서버)"
    TOKENIZERS_PARALLELISM=false .venv/bin/python -m uvicorn api.main:app --host 0.0.0.0 --port "$PORT"
    ;;
esac
