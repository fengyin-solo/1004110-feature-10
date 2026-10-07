import { defineStore } from 'pinia'

import type { Viewer } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: 'admin' as Viewer['role'],
    team: '保障一班',
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    viewer(): Viewer {
      return { operator: this.operator, role: this.role, team: this.team }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Viewer['role']) {
      this.role = role
      this.operator = role === 'admin' ? '值班管理员' : `${this.team}操作员`
    },
  },
})
