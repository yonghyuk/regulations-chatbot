// 취업규칙 챗봇 CI 파이프라인
//
// 트리거 : Gerrit patchset-created (refs/for/master) — 코드 리뷰 전 검증
// 전략   : 변경 영역(frontend/backend/embedding) 자동 감지 → 조건부·병렬 검증 → 통합 E2E
// Agent  : Docker 이미지(ci/Dockerfile). 추후 k8s 전환 시 agent 블록만 교체.

pipeline {

    // ── 현재: Docker agent (로컬 이미지) ────────────────────────────
    //   Jfrog 미구성 → 파일서버 tar를 노드에 docker load 해두고 로컬 태그로 사용.
    //   (배포 절차는 ci/Dockerfile 헤더 참고)
    agent {
        docker {
            image 'aicr-ci:1.0'                        // 로컬 태그 (레지스트리 pull 안 함)
            args  '-u root ' +
                  // 임베딩(Chroma) 영속 캐시 — 파일서버 경로 마운트
                  '-v /opt/aicr/chroma:/chroma_cache ' +
                  // 임베딩 소스 문서(대외비라 git 제외) — 읽기전용 마운트
                  '-v /opt/aicr/data:/ci_data:ro'
        }
    }
    // ── 추후: Jfrog 구성 또는 k8s pod 전환 시 위 블록을 아래로 교체 ──
    // agent {
    //     kubernetes {
    //         yaml '''
    //         spec:
    //           containers:
    //           - name: aicr-ci
    //             image: <your-registry>/aicr-ci:1.0   // Jfrog 구성 후 경로
    //             command: ["cat"]
    //             tty: true
    //         '''
    //     }
    // }

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    triggers {
        gerrit(
            serverName: 'Gerrit',
            gerritProjects: [[
                compareType: 'PLAIN', pattern: '<project>',
                branches: [[compareType: 'ANT', pattern: '**/master']]
            ]],
            triggerOnEvents: [patchsetCreated()]
            // merge 후 검증으로 바꾸려면: triggerOnEvents: [changeMerged()]
        )
    }

    environment {
        GOOGLE_API_KEY         = credentials('aicr-google-api-key')  // Jenkins Secret text
        API_PORT               = '18085'                             // CI 전용(운영 8085와 분리)
        TOKENIZERS_PARALLELISM = 'false'
        UV_CACHE_DIR           = "${WORKSPACE}/.uvcache"
        CHROMA_CACHE           = '/chroma_cache'                     // agent 볼륨 마운트 경로
        GIT_URL                = 'ssh://<gerrit-user>@<gerrit-host>:29418/<project>'
        GERRIT_SSH_CRED        = 'gerrit-ssh-key'                    // Gerrit SSH 키 credential ID
        GERRIT_HOST            = '<gerrit-host>'
        GERRIT_PORT            = '29418'
        GERRIT_USER            = '<gerrit-user>'
        // ⭐ 자동 머지 토글: 전체 검증 통과 시 Code-Review +2 부여 + Submit(자동 머지).
        //    끄려면 'false' 로만 변경하면 됨 (인라인 Job이면 Job 설정에서 한 줄 수정).
        AUTO_MERGE             = 'true'
        // CI 인증 설정 (BL-011) — config Settings 로드 + 토큰 검증용.
        //   로그인(다우 API)은 호출하지 않고, issue_token으로 만든 테스트 토큰을
        //   Playwright가 주입해 인증을 통과한다 → DAOU_* 는 더미면 충분.
        AUTH_ENABLED           = 'true'
        AUTH_SECRET            = credentials('aicr-ci-auth-secret')  // CI 전용 서명키 (Jenkins Secret text)
        DAOU_BASE_URL          = 'http://localhost'              // 더미 (다우 로그인 미호출)
        DAOU_COMPANY_ID        = 'ci'
    }

    stages {

        // 전통적(인라인 Pipeline script) 방식 — checkout scm 미사용.
        // 소스를 직접 git fetch 후, patchset을 타겟 브랜치 위에 cherry-pick → 머지 후 깨짐 검증.
        // Gerrit Trigger가 GERRIT_BRANCH / GERRIT_REFSPEC / GERRIT_PATCHSET_REVISION 주입.
        stage('Checkout & Cherry-pick') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: env.GERRIT_SSH_CRED, keyFileVariable: 'SSH_KEY')]) {
                    sh '''
                        set -e
                        export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
                        git config --global --add safe.directory "$WORKSPACE" 2>/dev/null || true

                        TARGET="${GERRIT_BRANCH:-master}"
                        echo "▶ 소스 fetch + origin/${TARGET} 위에 patchset cherry-pick (${GERRIT_REFSPEC})"

                        # 빈 워크스페이스(cleanWs 후)에서 직접 초기화 — checkout scm 대체
                        git init -q .
                        git remote add origin "$GIT_URL" 2>/dev/null || git remote set-url origin "$GIT_URL"
                        # 타겟 브랜치 + patchset 둘 다 가져오기
                        git fetch -q origin "+refs/heads/${TARGET}:refs/remotes/origin/${TARGET}" "${GERRIT_REFSPEC}"

                        git config user.email 'ci@example.com'
                        git config user.name  'Jenkins CI'
                        # 타겟 tip에서 작업 브랜치 → patchset 적용(충돌 시 실패 = 머지 충돌 검증)
                        git checkout -B ci-verify "origin/${TARGET}"
                        git cherry-pick "${GERRIT_PATCHSET_REVISION}"
                    '''
                }
                script {
                    // cherry-pick 후: HEAD=patchset(타겟 위), HEAD~1=타겟 tip → diff=patchset 변경분
                    def diff = sh(returnStdout: true,
                        script: "git diff --name-only HEAD~1 HEAD").trim()
                    echo "변경 파일:\n${diff}"

                    env.CHANGED_FRONTEND = (diff =~ /(?m)^frontend\//)            ? 'true' : 'false'
                    env.CHANGED_BACKEND  = (diff =~ /(?m)^(api\/|.*\.py$|pyproject\.toml|uv\.lock)/) ? 'true' : 'false'
                    env.CHANGED_EMBED    = (diff =~ /(?m)^(data\/|rag\.py|prompts\/)/) ? 'true' : 'false'
                    // CI 설정/E2E 파일 변경 → 통합 검증으로 파이프라인 자체 동작 확인
                    env.CHANGED_CI       = (diff =~ /(?m)^(Jenkinsfile|ci\/|e2e\/)/) ? 'true' : 'false'

                    echo "→ frontend=${env.CHANGED_FRONTEND}, backend=${env.CHANGED_BACKEND}, embed=${env.CHANGED_EMBED}, ci=${env.CHANGED_CI}"
                }
            }
        }

        // ===== 병렬 빌드 / 정적 검증 =====
        stage('Build & Lint') {
            parallel {

                stage('Frontend') {
                    when { environment name: 'CHANGED_FRONTEND', value: 'true' }
                    steps {
                        dir('frontend') {
                            sh '''
                                node -v && npm -v
                                npm ci
                                npx tsc --noEmit        # 타입 검증
                                npm run build           # vite build → dist/
                                npx eslint . || true    # 경고 비차단(초안)
                            '''
                        }
                        stash name: 'frontend-dist', includes: 'frontend/dist/**'
                    }
                }

                stage('Backend') {
                    when { environment name: 'CHANGED_BACKEND', value: 'true' }
                    steps {
                        sh '''
                            uv sync   # .venv 없으면 생성, 있으면 재사용 (멱등)
                            uv run python -c "import api.main, config, db, rag; print('import OK')"
                            uv run python -m compileall -q api config.py db.py rag.py
                            uv run ruff check . || true   # ruff 미설정이면 비차단
                        '''
                    }
                }
            }
        }

        // ===== 임베딩 검증 (data/rag/prompts 변경 시) =====
        stage('Embedding Smoke') {
            when { environment name: 'CHANGED_EMBED', value: 'true' }
            steps {
                sh '''
                    uv sync   # .venv 없으면 생성, 있으면 재사용 (멱등)
                    # 임베딩 소스 문서 확보 (대외비라 git 제외 → 마운트된 /ci_data 에서 복사)
                    mkdir -p data && cp -r /ci_data/* data/ 2>/dev/null || true
                    # 캐시된 Chroma 재사용(해시 일치 시 재임베딩 스킵)
                    [ -f "$CHROMA_CACHE/chroma.sqlite3" ] && cp -r "$CHROMA_CACHE" ./chroma_langchain_db || true
                    # bge-m3는 이미지에 사전 캐시됨 → 모델 다운로드 없이 임베딩 연산만
                    uv run python -c "from rag import get_engine; get_engine(); print('embedding OK')"
                    # 갱신분 캐시 반영
                    mkdir -p "$CHROMA_CACHE" && cp -r ./chroma_langchain_db/* "$CHROMA_CACHE"/ 2>/dev/null || true
                '''
            }
        }

        // ===== 통합 동작 검증 (가상 서비스 + Playwright) =====
        stage('Integration & E2E') {
            when {
                anyOf {
                    environment name: 'CHANGED_FRONTEND', value: 'true'
                    environment name: 'CHANGED_BACKEND',  value: 'true'
                    environment name: 'CHANGED_EMBED',    value: 'true'
                    environment name: 'CHANGED_CI',       value: 'true'
                }
            }
            steps {
                sh 'uv sync'   // .venv 없으면 생성, 있으면 재사용 (멱등)
                // 빌드 산출물 준비 (frontend stage가 스킵됐으면 직접 빌드)
                script {
                    try { unstash 'frontend-dist' } catch (e) { echo 'no stash, build now' }
                }
                sh '[ -d frontend/dist ] || (cd frontend && npm ci && npm run build)'
                // 임베딩 소스 문서 확보 (대외비라 git 제외 → 마운트된 /ci_data 에서 복사)
                sh 'mkdir -p data && cp -r /ci_data/* data/ 2>/dev/null || true'
                sh '[ -f "$CHROMA_CACHE/chroma.sqlite3" ] && cp -r "$CHROMA_CACHE" ./chroma_langchain_db || true'

                // 백엔드 기동 (백그라운드). JENKINS_NODE_COOKIE=dontKillMe 로
                // ProcessTreeKiller가 sh 스텝 종료 시 uvicorn을 죽이는 것을 방지.
                sh '''
                    JENKINS_NODE_COOKIE=dontKillMe \
                    FRONTEND_DIST=./frontend/dist \
                    nohup uv run uvicorn api.main:app --host 127.0.0.1 --port $API_PORT > aicr_ci.log 2>&1 &
                    echo $! > aicr_ci.pid
                '''
                // 헬스체크 폴링 (임베딩 로딩 대기 포함, 최대 180s). 끝까지 실패하면 비정상 종료.
                sh '''
                    for i in $(seq 1 60); do
                      curl -fsS "http://127.0.0.1:$API_PORT/health" && exit 0
                      sleep 3
                    done
                    echo "❌ 백엔드 health 응답 없음 — 로그(aicr_ci.log) 확인"; cat aicr_ci.log || true; exit 1
                '''
                // 첫 임베딩 결과를 캐시에 반영 (다음 빌드 가속)
                sh 'mkdir -p "$CHROMA_CACHE" && cp -r ./chroma_langchain_db/* "$CHROMA_CACHE"/ 2>/dev/null || true'
                // Playwright 스모크 — 인증(BL-011) 통과를 위해 테스트 토큰을 발급해 주입.
                //   issue_token은 백엔드와 동일한 AUTH_SECRET으로 서명 → verify_token 통과(다우 API 미호출).
                sh '''
                    TEST_TOKEN=$(uv run python -c "from api.auth import issue_token; print(issue_token('ci-test-user'))")
                    cd e2e
                    npm ci
                    BASE_URL="http://127.0.0.1:$API_PORT" TEST_TOKEN="$TEST_TOKEN" npx playwright test
                '''
            }
            post {
                always {
                    sh 'kill $(cat aicr_ci.pid) 2>/dev/null || true'
                    archiveArtifacts artifacts: 'aicr_ci.log, e2e/playwright-report/**',
                                     allowEmptyArchive: true
                }
            }
        }
    }

    post {
        success {
            script {
                if (env.AUTO_MERGE == 'true') {
                    // 전체 stage 통과 → Code-Review +2 + Verified +1 부여 후 Submit(자동 머지)
                    withCredentials([sshUserPrivateKey(credentialsId: env.GERRIT_SSH_CRED, keyFileVariable: 'SSH_KEY')]) {
                        sh '''
                            echo "▶ 검증 통과 → Code-Review +2 + 자동 Merge (patchset: $GERRIT_PATCHSET_REVISION)"
                            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                                -p "$GERRIT_PORT" "$GERRIT_USER@$GERRIT_HOST" \
                                gerrit review --verified +1 --code-review +2 --submit "$GERRIT_PATCHSET_REVISION"
                            echo "✅ 자동 머지 요청 완료"
                        '''
                    }
                } else {
                    echo '✅ 검증 통과 (AUTO_MERGE=false — 자동 머지 비활성, 수동 리뷰/머지)'
                }
            }
        }
        failure { echo '❌ 검증 실패 — 자동 머지 안 함'  /* TODO: Verified -1 + 메일 알림 */ }
        always  { cleanWs(notFailBuild: true) }
    }
}
