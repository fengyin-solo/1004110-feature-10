<template>
  <section class="page" data-module="lavatory-detail">
    <header class="page-head">
      <div>
        <h2>排污记录详情</h2>
        <p class="page-desc">与列表、定位共用同一份状态结论；历史操作人仍归原班组。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="backTarget">返回列表</RouterLink>
      </div>
    </header>

    <p v-if="deniedMessage" class="error-text detail-denied">{{ deniedMessage }}</p>

    <template v-else-if="row">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">服务待办</span>
          <strong class="stat-value">{{ row.pending ? '待处理' : '已办结' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">设备异常</span>
          <strong class="stat-value">{{ row.abnormal ? '是' : '否' }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in meta.fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, moduleMeta } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('lavatory')
const route = useRoute()
const session = useSessionStore()

const row = ref<EntryRow | null>(null)
const deniedMessage = ref('')

// 返回列表时把进来时的 query（筛选条件 + focus 定位点）原样带回。
const backTarget = { name: 'lavatory', query: { ...route.query } }

onMounted(() => {
  const result = getEntry(meta.key, Number(route.params.id), session.viewer)
  if (!result.ok) {
    deniedMessage.value = result.message
    return
  }
  row.value = result.row
})
</script>
