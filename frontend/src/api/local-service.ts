import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  Viewer,
} from '@/data/types'

// 状态结论的唯一来源是 row.status。下面两组词表把状态分成「已办结」和「异常」，
// 待办（pending）与异常（abnormal）都从它推导，列表、详情、定位、概览看到的才是同一个结论。
const DONE_STATUS_HINTS = ['完成', '就绪', '签收', '复核', '解除', '闭环', '释放', '到达', '断电', '离岗', '送达', '取消']
const ABNORMAL_STATUS_HINTS = ['异常', '故障', '停用', '滞留', '中断', '复查', '延误', '超时', '整改', '报修']

// 记录归属班组用的字段名：非管理员只能查看本班组的记录详情。
const TEAM_FIELD = '所属班组'

export function isDoneStatus(status: string): boolean {
  return DONE_STATUS_HINTS.some((hint) => status.includes(hint))
}

export function isAbnormalStatus(status: string): boolean {
  return ABNORMAL_STATUS_HINTS.some((hint) => status.includes(hint))
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 模块字段里以「状态」结尾的那一列（如排污的「服务状态」）只是 status 的展示副本，
// 历史数据里可能留着旧结论，读写时都要清掉，统一回 status。
function statusFieldOf(meta: ModuleMeta): string | null {
  return meta.fields.find((field) => field.endsWith('状态')) ?? null
}

function normalizeRow(meta: ModuleMeta, row: EntryRow): { row: EntryRow; changed: boolean } {
  const status = String(row.status)
  const statusField = statusFieldOf(meta)
  const next: EntryRow = {
    ...row,
    pending: !isDoneStatus(status),
    abnormal: isAbnormalStatus(status),
  }
  if (statusField) {
    next[statusField] = status
  }
  const changed =
    next.pending !== row.pending ||
    next.abnormal !== row.abnormal ||
    (statusField !== null && row[statusField] !== status)
  return { row: changed ? next : row, changed }
}

// 所有读取入口都走这里：发现残留状态（旧结论、错的待办/异常标记）就规范化并落盘一次。
function normalizedRows(key: string): EntryRow[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  let dirty = false
  const next = rows.map((row) => {
    const result = normalizeRow(meta, row)
    if (result.changed) {
      dirty = true
    }
    return result.row
  })
  if (dirty) {
    saveRows(key, next)
  }
  return next
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
  const matched = filterRows(normalizedRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function canViewRow(meta: ModuleMeta, row: EntryRow, viewer: Viewer): boolean {
  if (viewer.role === 'admin') {
    return true
  }
  if (!meta.fields.includes(TEAM_FIELD)) {
    return true
  }
  return String(row[TEAM_FIELD] ?? '') === viewer.team
}

export function getEntry(key: string, id: number, viewer: Viewer): EntryResult {
  const meta = moduleMeta(key)
  const row = normalizedRows(key).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}`, row: null }
  }
  if (!canViewRow(meta, row, viewer)) {
    return {
      ok: false,
      message: `越权查看已拒绝：该${meta.entity}归属「${String(row[TEAM_FIELD])}」，当前身份无权查看`,
      row: null,
    }
  }
  return { ok: true, message: '', row }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = normalizedRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 只推进状态结论；操作人员、所属班组等历史字段原样保留，仍归原班组。
  const { row: updated } = normalizeRow(meta, { ...rows[index], status: target })
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of normalizedRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
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
    const entries = normalizedRows(meta.key)
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
