import { MODULE_BY_KEY } from '@/data/modules'
import { appendOpLog, listOpLogs, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DetailResult,
  EntryRow,
  ModuleMeta,
  OpLogEntry,
  OverviewResult,
  PageResult,
  StatusConclusion,
  Viewer,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 没登记班组信息的查看人按调度管理员处理（其余 17 个模块的旧页面不传查看人）。
const DEFAULT_VIEWER: Viewer = { operator: '值班管理员', role: 'admin', team: '调度中心' }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 模块是否登记了状态结论口径（doneStatus/abnormalStatus）。登记了的走统一结论，
// 没登记的维持旧逻辑：本次只给排污服务登记，其它模块行为不变。
function hasConclusion(meta: ModuleMeta): boolean {
  return Boolean(meta.doneStatus || meta.abnormalStatus)
}

// 状态结论只在这里算一次：列表、详情、定位、看板、航班保障清单都用它。
export function statusConclusion(meta: ModuleMeta, status: string): StatusConclusion {
  if (hasConclusion(meta)) {
    return {
      status,
      pending: status !== meta.doneStatus && status !== meta.abnormalStatus,
      abnormal: status === meta.abnormalStatus,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  return { status, pending: status !== lastStatus, abnormal: false }
}

// 模块字段里承担「状态列」的那个字段（如排污记录的「服务状态」）。
function statusFieldOf(meta: ModuleMeta): string | undefined {
  return meta.fields.find((field) => field.endsWith('状态'))
}

// 残留状态清除：按统一结论校正每一行的 pending/abnormal，并把状态列字段
// 对齐到当前 status（历史遗留的样例文案、旧标记一并清掉）。有改动就落库一次。
function normalizeModuleRows(meta: ModuleMeta): EntryRow[] {
  const rows = listRows(meta.key)
  if (!hasConclusion(meta) || rows.length === 0) {
    return rows
  }
  const statusField = statusFieldOf(meta)
  let changed = false
  const normalized = rows.map((row) => {
    const conclusion = statusConclusion(meta, String(row.status))
    const next: EntryRow = { ...row, pending: conclusion.pending, abnormal: conclusion.abnormal }
    if (statusField) {
      next[statusField] = conclusion.status
    }
    if (
      next.pending !== row.pending ||
      next.abnormal !== row.abnormal ||
      (statusField && row[statusField] !== conclusion.status)
    ) {
      changed = true
    }
    return next
  })
  if (changed) {
    saveRows(meta.key, normalized)
  }
  return normalized
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(normalizeModuleRows(moduleMeta(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情：和列表走同一份数据、同一个结论；越权查看直接拒绝，不回记录内容。
export function getEntryDetail(key: string, id: number, viewer: Viewer = DEFAULT_VIEWER): DetailResult {
  const meta = moduleMeta(key)
  const rows = normalizeModuleRows(meta)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const ownerTeam = String(row['负责班组'] ?? '')
  if (viewer.role !== 'admin' && ownerTeam && ownerTeam !== viewer.team) {
    return {
      ok: false,
      message: `越权查看被拒绝：${meta.entity}「${row[meta.fields[0]] ?? id}」属于${ownerTeam}，当前身份是${viewer.team}`,
    }
  }
  return {
    ok: true,
    message: '',
    row,
    conclusion: statusConclusion(meta, String(row.status)),
    logs: listOpLogs(key, id),
  }
}

export function runAction(key: string, id: number, action: string, viewer: Viewer = DEFAULT_VIEWER): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = normalizeModuleRows(meta)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    // 重复报修/重复操作只生效一次：状态没变化，不改数据、不记历史。
    return { ok: false, message: `${meta.entity}已经是「${target}」，重复${action}不生效` }
  }
  const conclusion = statusConclusion(meta, target)
  // 只改状态相关的字段：操作人员、负责班组等归属信息保持原样，历史操作人仍归原班组。
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: conclusion.pending,
    abnormal: hasConclusion(meta)
      ? conclusion.abnormal
      : NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const statusField = statusFieldOf(meta)
  if (hasConclusion(meta) && statusField) {
    updated[statusField] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const log: OpLogEntry = {
    action,
    from: current,
    to: target,
    operator: viewer.operator,
    team: viewer.team,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
  appendOpLog(key, id, log)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 排污服务待办按航班汇总：未完成的（待服务/服务中/设备异常）都算待办，
// 航班保障清单等其余入口从这里取，和排污列表天然同步。
export function lavatoryTodosByFlight(): Map<string, string[]> {
  const meta = moduleMeta('lavatory')
  const todos = new Map<string, string[]>()
  for (const row of normalizeModuleRows(meta)) {
    const conclusion = statusConclusion(meta, String(row.status))
    if (!conclusion.pending && !conclusion.abnormal) {
      continue
    }
    const flight = String(row['关联航班'] ?? '').trim()
    if (!flight) {
      continue
    }
    todos.set(flight, [...(todos.get(flight) ?? []), conclusion.status])
  }
  return todos
}

export function lavatoryTodoText(flight: string): string {
  const todos = lavatoryTodosByFlight().get(flight)
  return todos && todos.length > 0 ? todos.join('、') : '无'
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const syncLavatoryTodo = key === 'flight_ops'
  if (syncLavatoryTodo) {
    header.push('排污待办')
  }
  const lines = [header.join(',')]
  for (const row of normalizeModuleRows(meta)) {
    const cells = [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
    if (syncLavatoryTodo) {
      cells.push(lavatoryTodoText(String(row['航班号'] ?? '')))
    }
    lines.push(cells.join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = normalizeModuleRows(meta)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
