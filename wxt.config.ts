import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  outDir: '.output',
  // ─── 跨浏览器 manifest ─────────────────────────────
  // 用函数式 manifest 让 chrome / firefox 各自合法：
  // - chrome MV3：保留 'favicon' 权限（用于 chrome-extension://EXT_ID/_favicon/）
  // - firefox MV2：移除 'favicon'（不被支持，会触发 manifest 校验警告）
  manifest: ({ browser }) => ({
    name: 'Curio - 书签整理新标签页',
    short_name: 'Curio',
    description: '替代浏览器新标签页，DIY 你的个人书签整理面板',
    permissions: [
      'bookmarks',
      'storage',
      // 'history' 用于「最近使用」模块的「包含浏览器历史」可选功能
      // 默认关闭，用户在 UI 中主动开启后才会调用 history.search
      'history',
      // 'tabs' 用于工具栏 popup「添加当前页面」功能：读取 active tab 的 title/url
      'tabs',
      ...(browser === 'chrome' ? ['favicon'] : []),
    ],
    /**
     * V2.0 §6.1「网页内容抓取」需要跨域 fetch 用户已收藏的网页，
     * 必须声明 host_permissions: <all_urls>。这是一个用户授权层面的重大变更，
     * 用户在浏览器扩展管理页能直接看到「读取所有网站的数据」。
     *
     * 我们的承诺（产品红线，写在 SettingsTab 的隐私弹窗里）：
     * - 默认完全不抓取；用户在「⚙ 设置 → 内容抓取」主动同意 + 选范围才会触发
     * - 抓到的正文仅写入本机 IndexedDB（pageContents 表），永不上传
     * - 不会读 cookie / Authorization 头，仅 fetch 公开 HTML
     */
    host_permissions: ['<all_urls>'],
    chrome_url_overrides: {
      newtab: 'newtab.html',
    },
    // 工具栏图标点击后弹出的小窗口；entrypoint 由 entrypoints/popup/ 提供
    action: {
      default_title: 'Curio',
      default_popup: 'popup.html',
    },
  }),
  // 抑制 Firefox 2025-11 起新增的 data_collection_permissions 提示
  // （本扩展不收集任何用户数据，全部本地存储）
  // 真正发布到 AMO 时再补充正式声明
  // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
  suppressWarnings: {
    firefoxDataCollection: true,
  },
})
