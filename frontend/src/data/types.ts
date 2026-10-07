/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 状态结论口径：登记了的模块由 statusConclusion 统一推导 pending/abnormal，
  // 列表、详情、定位、看板都用同一结论；没登记的模块维持旧逻辑，避免误伤。
  doneStatus?: string
  abnormalStatus?: string
}

/** 一条记录的状态结论：所有入口共用，不允许各算各的。 */
export type StatusConclusion = {
  status: string
  pending: boolean
  abnormal: boolean
}

/** 当前查看人：越权校验只看角色和班组，不看页面从哪进来。 */
export type Viewer = {
  operator: string
  role: 'admin' | 'staff'
  team: string
}

/** 操作历史：操作人和班组按发生时的快照落库，历史操作人仍归原班组，事后不改。 */
export type OpLogEntry = {
  action: string
  from: string
  to: string
  operator: string
  team: string
  time: string
}

export type DetailResult = {
  ok: boolean
  message: string
  row?: EntryRow
  conclusion?: StatusConclusion
  logs?: OpLogEntry[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
