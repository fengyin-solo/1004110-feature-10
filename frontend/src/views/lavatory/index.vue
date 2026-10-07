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

    <form class="filter-bar" @submit.prevent="reload()">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

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
          :id="`row-${row.id}`"
          :key="String(row.id)"
          :class="{ 'row-focus': String(row.id) === focusId }"
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
            <RouterLink class="link" :to="detailTarget(row)">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排污服务数据，可先登记排污记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排污服务记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('lavatory')
const columns = ["排污编号", "关联航班", "服务车型", "操作人员", "所属班组", "开始时间", "结束时间", "排污量", "服务状态"]
const actions = ["开始服务", "确认完成", "报修设备"]
const statuses = ["待服务", "服务中", "已完成", "设备异常"]

const route = useRoute()
const router = useRouter()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 4)

// 统计卡、状态分布与列表同源：都按当前结果集的 status 结论计数，不再各算各的。
const stats = computed(() => [
  { label: '待服务航班', value: countByStatus('待服务') },
  { label: '服务中航班', value: countByStatus('服务中') },
  { label: '设备异常数', value: countByStatus('设备异常') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countByStatus(status),
  })),
)

// 定位点：详情返回时 query 里带着 focus，回来还高亮并滚动到那条记录。
const focusId = computed(() => String(route.query.focus ?? ''))

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function restoreFilters() {
  const restored: Record<string, string> = {}
  for (const field of filterFields) {
    const value = route.query[field]
    if (typeof value === 'string' && value !== '') {
      restored[field] = value
    }
  }
  filters.value = restored
}

function syncQuery(extra: Record<string, string> = {}) {
  const query: Record<string, string> = {}
  for (const field of filterFields) {
    const value = (filters.value[field] ?? '').trim()
    if (value !== '') {
      query[field] = value
    }
  }
  Object.assign(query, extra)
  router.replace({ name: 'lavatory', query })
}

function detailTarget(row: EntryRow) {
  // 把当前筛选条件和定位点一起带给详情，返回时原样带回，设备异常记录不会丢。
  return {
    name: 'lavatory-detail',
    params: { id: Number(row.id) },
    query: { ...route.query, focus: String(row.id) },
  }
}

function resetFilters() {
  filters.value = {}
  reload(false)
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排污记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload(keepFocus = true) {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    syncQuery(keepFocus && focusId.value ? { focus: focusId.value } : {})
    void scrollToFocus()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排污服务列表读取失败'
  }
}

async function scrollToFocus() {
  if (!focusId.value) {
    return
  }
  await nextTick()
  document.getElementById(`row-${focusId.value}`)?.scrollIntoView({ block: 'center' })
}

onMounted(() => {
  restoreFilters()
  reload()
})
</script>
