import { browser } from 'wxt/browser'
import { runLegacyMigrationOnce } from '../src/services/legacyMigration'

/**
 * Background Script
 * - Chrome MV3：作为 service worker 运行
 * - Firefox MV2：作为长期持有的 background script 运行
 *
 * 职责：
 * - 启动时跑一次性数据迁移（tabit → curio 命名空间）
 * - 监听浏览器原生书签变化（用于和自定义卡片关联同步）
 * - 处理上下文菜单、跨页通信等后台任务
 */
export default defineBackground(() => {
  console.log('[Curio] Background script started')

  // 一次性数据迁移：把老用户的 tabit:* / tabit-* 数据搬到 curio 命名空间。
  // - 幂等：内部用 curio:_legacy_migrated_at 标记，已迁移即直接返回
  // - 失败：不写标记，下次启动重试；newtab 也会兜底再跑一次
  void runLegacyMigrationOnce()
  // Chrome MV3 service worker 的 onInstalled / onStartup 各自再触发一次，
  // 覆盖「装完插件首次解压」「浏览器冷启动」等 worker 唤起场景
  browser.runtime.onInstalled?.addListener(() => {
    void runLegacyMigrationOnce()
  })
  browser.runtime.onStartup?.addListener(() => {
    void runLegacyMigrationOnce()
  })

  // 监听浏览器书签变化（V1 暂不处理，V2 同步时使用）
  browser.bookmarks?.onCreated?.addListener((id, bookmark) => {
    console.log('[Curio] Bookmark created:', id, bookmark)
  })

  browser.bookmarks?.onRemoved?.addListener((id) => {
    console.log('[Curio] Bookmark removed:', id)
  })

  browser.bookmarks?.onChanged?.addListener((id, changeInfo) => {
    console.log('[Curio] Bookmark changed:', id, changeInfo)
  })
})
