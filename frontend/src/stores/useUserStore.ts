import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 인증 상태(localStorage 영속).
 * 다우오피스 계정 로그인 → 서명토큰(token)을 저장하고, 모든 API 요청의
 * Authorization: Bearer 헤더로 전송한다. user_id 는 서버가 토큰에서 추출한다.
 */
interface UserState {
  token: string
  username: string
  setAuth: (token: string, username: string) => void
  logout: () => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      token: '',
      username: '',
      setAuth: (token, username) => set({ token, username }),
      logout: () => set({ token: '', username: '' }),
    }),
    {
      name: 'regulations-auth',
    },
  ),
)
