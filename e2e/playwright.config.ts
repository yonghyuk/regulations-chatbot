import { defineConfig, devices } from '@playwright/test'

// CI에서 Jenkins가 BASE_URL(=백엔드 기동 주소)를 주입한다.
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:18085'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,              // SSE 스트리밍 응답 대기 여유
  expect: { timeout: 60_000 },
  fullyParallel: false,        // 단일 가상 서비스 대상이므로 순차
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
