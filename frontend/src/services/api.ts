import axios from 'axios'
import { useUserStore } from '@/stores/useUserStore'

// axios 베이스 인스턴스. 모든 요청에 다우 로그인 토큰(Authorization)을 주입한다.
const api = axios.create({
  baseURL: '/api',
})

api.interceptors.request.use((config) => {
  const token = useUserStore.getState().token
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// 토큰 만료/무효(401) → 로그아웃 처리하여 로그인 화면으로 전환
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      useUserStore.getState().logout()
    }
    return Promise.reject(err)
  },
)

export default api
