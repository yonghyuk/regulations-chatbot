import { create } from 'zustand'
import api from '@/services/api'

// 화면 표시용 조직 정보. 백엔드 .env(COMPANY_NAME / REGULATION_SCOPE)에서 온다.
// 조회 실패 시 기본값(범용 문구)으로 동작한다.
interface AppInfoState {
  companyName: string
  regulationScope: string
  load: () => Promise<void>
}

export const useAppInfoStore = create<AppInfoState>()((set) => ({
  companyName: '',
  regulationScope: '취업규칙',
  load: async () => {
    try {
      const { data } = await api.get<{ company_name: string; regulation_scope: string }>('/app-info')
      set({ companyName: data.company_name, regulationScope: data.regulation_scope })
      document.title = `${data.company_name ? `${data.company_name} ` : ''}${data.regulation_scope} 챗봇`
    } catch {
      // 기본값 유지
    }
  },
}))
