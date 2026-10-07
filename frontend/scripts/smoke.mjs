// 排污服务修复的冒烟验证：不依赖浏览器，直接用 esbuild 把本地数据层打包后在 Node 里断言。
// 运行：node scripts/smoke.mjs
import { build } from 'esbuild'
import { unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(root, '..', 'src')
const outfile = path.join(root, '.smoke-bundle.mjs')

await build({
  entryPoints: [path.join(src, 'api', 'local-service.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': src },
  outfile,
  logLevel: 'silent',
})

const service = await import(outfile)

let failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failed += 1
    console.error(`✗ ${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

const admin = { operator: '值班管理员', role: 'admin', team: '保障一班' }
const staffOne = { operator: '保障一班操作员', role: 'staff', team: '保障一班' }

// 1. 残留状态清除：列表里每行的「服务状态」字段都与 status 是同一个结论
const listed = service.listEntries('lavatory')
check(
  '列表/字段同一结论（服务状态 === status）',
  listed.items.every((row) => row['服务状态'] === row.status),
  true,
)
check(
  '种子里的残留异常标记已清除（服务中不算异常）',
  listed.items.find((row) => row.id === 2).abnormal,
  false,
)

// 2. 四个筛选字段都可用（含操作人员）
check(
  '按操作人员筛选生效',
  service.listEntries('lavatory', { 操作人员: '样例2' }).items.map((row) => row.id),
  [2],
)

// 3. 报修后：列表、详情、概览同一结论；设备异常仍是服务待办
service.runAction('lavatory', 1, '开始服务')
const reported = service.runAction('lavatory', 1, '报修设备')
check('报修设备成功', reported.ok, true)
const afterRepair = service.getEntry('lavatory', 1, admin).row
check('详情状态=设备异常', afterRepair.status, '设备异常')
check('详情的服务状态字段同步', afterRepair['服务状态'], '设备异常')
check('设备异常仍是服务待办', afterRepair.pending, true)
check('设备异常计入异常量', afterRepair.abnormal, true)
check(
  '列表结论与详情一致',
  service.listEntries('lavatory').items.find((row) => row.id === 1).status,
  '设备异常',
)

// 4. 历史操作人仍归原班组：动作不改写操作人员与所属班组
check('操作人员未被改写', afterRepair['操作人员'], '排污服务样例1')
check('所属班组未被改写', afterRepair['所属班组'], '保障一班')

// 5. 重复报修只生效一次
const duplicate = service.runAction('lavatory', 1, '报修设备')
check('重复报修被拒绝', [duplicate.ok, duplicate.message.includes('不用重复操作')], [false, true])

// 6. 越权查看必须拒绝：一班操作员看二班记录被拒，看本班放行，管理员放行
const denied = service.getEntry('lavatory', 2, staffOne)
check('越权查看被拒绝', [denied.ok, denied.message.includes('越权查看已拒绝')], [false, true])
check('本班组记录可查看', service.getEntry('lavatory', 1, staffOne).ok, true)
check('管理员可查看全部', service.getEntry('lavatory', 2, admin).ok, true)

// 7. 概览（其余入口）同步服务待办：排污待处理含设备异常，异常量=1
const overview = service.loadOverview()
const lavatoryStat = overview.modules.find((item) => item.name === '排污服务')
check('概览待处理同步（含设备异常）', lavatoryStat.pending, 2)
check('概览异常量同步', lavatoryStat.abnormal, 1)

// 8. 确认完成后不再是待办
service.runAction('lavatory', 2, '确认完成')
const done = service.getEntry('lavatory', 2, admin).row
check('已完成后待办清除', done.pending, false)
check('完成后服务状态字段同步', done['服务状态'], '已完成')

unlinkSync(outfile)
if (failed > 0) {
  console.error(`\n${failed} 项未通过`)
  process.exit(1)
}
console.log('\n全部通过')
