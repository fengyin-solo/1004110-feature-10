import { SEED_ROWS } from './seed'
import type { EntryRow, OpLogEntry } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'
// 操作历史单独存：只追加不改写，历史操作人仍归原班组。
const OPLOG_KEY = 'airport-ground-handling:oplogs'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

type OpLogBook = Record<string, Record<string, OpLogEntry[]>>

let opLogCache: OpLogBook | null = null

function readOpLogs(): OpLogBook {
  if (opLogCache !== null) {
    return opLogCache
  }
  let book: OpLogBook = {}
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(OPLOG_KEY)
    if (raw) {
      try {
        book = JSON.parse(raw) as OpLogBook
      } catch {
        book = {}
      }
    }
  }
  opLogCache = book
  return book
}

export function listOpLogs(key: string, id: number): OpLogEntry[] {
  const book = readOpLogs()
  return clone(book[key]?.[String(id)] ?? [])
}

// 只追加：同一条历史一旦写入就不再改动，班组归属以写入时为准。
export function appendOpLog(key: string, id: number, entry: OpLogEntry): void {
  const book = readOpLogs()
  const moduleLogs = { ...(book[key] ?? {}) }
  moduleLogs[String(id)] = [...(moduleLogs[String(id)] ?? []), entry]
  const next = { ...book, [key]: moduleLogs }
  opLogCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(OPLOG_KEY, JSON.stringify(next))
  }
}
