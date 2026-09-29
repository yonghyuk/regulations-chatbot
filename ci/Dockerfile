# 취업규칙 챗봇 CI 빌드 노드 이미지
#
# 배포: agent의 docker image는 "해당 빌드 노드 docker 데몬에 존재"가 전제 (Jfrog 미구성 → pull 불가).
#
# [현재] 단일 노드 — 빌드한 docker = Jenkins agent docker 가 동일하므로 build 한 번이면 끝.
#   docker build -t aicr-ci:1.0 -f ci/Dockerfile .
#   → 이후 agent { docker { image 'aicr-ci:1.0' } } 가 그대로 사용 (save/load 불필요)
#
# [확장] 빌드 노드가 늘거나 분리되면, 각 노드 docker에 이미지를 넣어줘야 함:
#   docker save aicr-ci:1.0 | gzip > /opt/aicr/images/aicr-ci-1.0.tar.gz   # 배포
#   docker load -i /opt/aicr/images/aicr-ci-1.0.tar.gz                      # 각 노드에서 1회
#   (또는 Jfrog 구성 후 docker push/pull 로 자동화 — agent image 경로만 교체)
#
# 포함: python3.12 + uv + node20 + chromium(Playwright) + bge-m3 임베딩 모델 사전 캐시
#
# ⚠️ 베이스를 bookworm으로 고정: python:3.12-slim 태그가 trixie(Debian 13)로 이동했는데
#    playwright 1.48 install-deps가 trixie에 없는 패키지(ttf-unifont 등) 설치 시도 → 실패.
FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/root/.local/bin:${PATH}" \
    HF_HOME=/opt/hf-cache \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    PIP_NO_CACHE_DIR=1

# Playwright 버전 핀 — 런타임 e2e/package.json과 반드시 동일하게 유지
ARG PLAYWRIGHT_VERSION=1.48.0

# --- 시스템 + node20 + uv ---
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl git ca-certificates build-essential openssh-client \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# --- bge-m3 임베딩 모델 사전 다운로드 (런타임 네트워크 의존 제거) ---
#     config.py embedding_model="BAAI/bge-m3" 와 일치
RUN pip install "huggingface_hub[cli]" \
    && python -c "from huggingface_hub import snapshot_download; snapshot_download('BAAI/bge-m3')"

# --- Playwright chromium + 시스템 의존성 ---
#     install-deps(apt)와 install(브라우저)을 분리. apt 목록은 직전에 update.
RUN apt-get update \
    && npx --yes playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
    && npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
