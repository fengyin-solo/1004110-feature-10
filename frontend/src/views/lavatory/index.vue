<template>
  <section class="page" data-module="lavatory">
    <header class="page-head">
      <div>
        <h2>排污服务管理</h2>
        <p class="page-desc">维护排污记录，围绕排污编号、关联航班、服务车型、操作人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排污记录</button>
        <button class="btn" type="button" @click="exportRows">导出排污服务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="locatedRow" class="locate-banner">
      <span>
        已定位 {{ locatedRow['排污编号'] }}（{{ locatedRow['关联航班'] }}）· 当前状态：{{ locatedRow.status }}
        <template v-if="locatedFilteredOut">，不在当前筛选结果中</template>
      </span>
      <button v-if="locatedFilteredOut" class="link" type="button" @click="resetFilters">重置条件</button>
      <button class="link" type="button" @click="clearLocate">清除定位</button>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :id="`lavatory-row-${row.id}`"
          :key="String(row.id)"
          :class="{ 'row-located': Number(row.id) === locateId }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button class="link" type="button" @click="locateRow(Number(row.id))">定位</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排污服务数据，可先登记排污记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detailError" class="detail-panel">
      <header class="detail-head">
        <h3>排污记录详情</h3>
        <button class="link" type="button" @click="closeDetail">关闭</button>
      </header>
      <p class="error-text">{{ detailError }}</p>
    </section>

    <section v-else-if="detail" class="detail-panel">
      <header class="detail-head">
        <h3>排污记录详情 · {{ detail.row['排污编号'] }}</h3>
        <div class="detail-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="link"
            type="button"
            @click="runAction(action, detail.row)"
          >
            {{ action }}
          </button>
          <button class="link" type="button" @click="locateRow(Number(detail.row.id), true)">返回列表并定位</button>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </div>
      </header>
      <dl class="detail-grid">
        <template v-for="column in columns" :key="column">
          <dt>{{ column }}</dt>
          <dd>{{ detail.row[column] ?? '—' }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ detail.conclusion.status }}</dd>
        <dt>负责班组</dt>
        <dd>{{ detail.row['负责班组'] ?? '—' }}</dd>
      </dl>
      <h4 class="detail-subtitle">操作历史</h4>
      <ul v-if="detail.logs.length" class="op-log">
        <li v-for="(log, index) in detail.logs" :key="index">
          {{ log.time }} · {{ log.operator }}（{{ log.team }}）· {{ log.action }}：{{ log.from }} → {{ log.to }}
        </li>
      </ul>
      <p v-else class="detail-empty">暂无操作记录</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条排污服务记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  getEntryDetail,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, OpLogEntry, StatusConclusion } from '@/data/types'
import { useSessionStore } from '@/stores/session'

type DetailView = { row: EntryRow; conclusion: StatusConclusion; logs: OpLogEntry[] }

const meta = moduleMeta('lavatory')
const columns = ["排污编号", "关联航班", "服务车型", "操作人员", "开始时间", "结束时间", "排污量", "服务状态"]
const actions = ["开始服务", "确认完成", "报修设备"]
const statuses = ["待服务", "服务中", "已完成", "设备异常"]

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
// 筛选条件覆盖：排污编号、关联航班、服务车型、操作人员
const filterFields = columns.slice(0, 4)
const detail = ref<DetailView>()
const detailError = ref('')
const locateId = ref<number | null>(null)

// 统计与图例走未筛选的全量数据，和列表筛选互不影响。
const stats = computed(() => [
  { label: '待服务航班', value: countByStatus('待服务') },
  { label: '服务中航班', value: countByStatus('服务中') },
  { label: '设备异常数', value: countByStatus('设备异常') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

// 定位与列表、详情读同一份数据：设备异常记录也在这份结论里，不会丢。
const locatedRow = computed(() =>
  locateId.value === null ? undefined : allRows.value.find((row) => Number(row.id) === locateId.value),
)
const locatedFilteredOut = computed(
  () => locatedRow.value !== undefined && !rows.value.some((row) => Number(row.id) === locateId.value),
)

function countByStatus(status: string): number {
  return allRows.value.filter((row) => String(row.status) === status).length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排污记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.viewer)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// 详情和列表用同一结论；越权查看由数据层拒绝，这里只展示拒绝原因。
function openDetail(row: EntryRow) {
  const result = getEntryDetail(meta.key, Number(row.id), session.viewer)
  if (!result.ok || !result.row || !result.conclusion) {
    detail.value = undefined
    detailError.value = result.message
    return
  }
  detailError.value = ''
  detail.value = { row: result.row, conclusion: result.conclusion, logs: result.logs ?? [] }
}

function refreshDetail() {
  if (detail.value) {
    openDetail(detail.value.row)
  }
}

function closeDetail() {
  detail.value = undefined
  detailError.value = ''
}

// 定位只记记录编号，展示时从最新数据里取结论；从详情返回也不清掉。
function locateRow(id: number, closePanel = false) {
  locateId.value = id
  if (closePanel) {
    closeDetail()
  }
  nextTick(() => {
    document.getElementById(`lavatory-row-${id}`)?.scrollIntoView({ block: 'center' })
  })
}

function clearLocate() {
  locateId.value = null
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRows.value = listEntries(meta.key).items
    refreshDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排污服务列表读取失败'
  }
}

// 切换值班身份后重新校验详情权限，越权的详情立即关闭并提示。
watch(
  () => session.operator,
  () => reload(),
)

onMounted(reload)
</script>
