import { test, expect } from '@playwright/test'

// 가상 서비스 기본 동작 스모크 — selector는 실제 컴포넌트 기준:
//   입력창 : textarea[placeholder^="취업규칙"]  (MessageInput.tsx)
//   전송   : button[aria-label="전송"]
//   응답   : .prose 컨테이너 (MessageBubble.tsx, assistant 전용)

// 인증(BL-011): App은 토큰이 없으면 LoginPage만 렌더한다. CI는 백엔드와 동일한
// AUTH_SECRET으로 발급한 TEST_TOKEN을 useUserStore(zustand persist, 키 'regulations-auth')에
// 주입해 인증 게이트를 통과한다. (다우 API는 호출하지 않음)
const TEST_TOKEN = process.env.TEST_TOKEN || ''

test.beforeEach(async ({ page }) => {
  if (TEST_TOKEN) {
    await page.addInitScript((token) => {
      localStorage.setItem(
        'regulations-auth',
        JSON.stringify({ state: { token, username: 'ci-test' }, version: 0 }),
      )
    }, TEST_TOKEN)
  }
})

test('앱이 로딩되고 입력창이 보인다', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder(/취업규칙/)).toBeVisible()
})

test('질문을 보내면 스트리밍 응답이 채워진다', async ({ page }) => {
  await page.goto('/')

  const input = page.getByPlaceholder(/취업규칙/)
  await input.fill('연차휴가 규정 알려줘')
  await page.getByRole('button', { name: '전송' }).click()

  // user 버블이 아닌 assistant(.prose) 응답에 텍스트가 채워질 때까지 대기
  const answer = page.locator('.prose').last()
  await expect(answer).toContainText(/\S/, { timeout: 60_000 })
})
