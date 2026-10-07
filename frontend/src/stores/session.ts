import { defineStore } from 'pinia'

import type { Viewer } from '@/data/types'

// 可切换的值班身份：管理员看全部，班组人员只能看本班组的记录详情。
export const IDENTITIES: Viewer[] = [
  { operator: '值班管理员', role: 'admin', team: '调度中心' },
  { operator: '张伟', role: 'staff', team: '排污一班' },
  { operator: '李强', role: 'staff', team: '排污二班' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: IDENTITIES[0].operator,
    role: IDENTITIES[0].role as Viewer['role'],
    team: IDENTITIES[0].team,
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    viewer: (state): Viewer => ({ operator: state.operator, role: state.role, team: state.team }),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(operator: string) {
      const identity = IDENTITIES.find((item) => item.operator === operator)
      if (!identity) {
        return
      }
      this.operator = identity.operator
      this.role = identity.role
      this.team = identity.team
    },
  },
})
