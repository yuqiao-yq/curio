import { defineConfig } from 'wxt'
import { visualizer } from 'rollup-plugin-visualizer'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  outDir: '.output',
  // `ANALYZE=1 pnpm build` 触发：产物输出到 stats.html，浏览器打开看 chunk treemap
  // 平时不启用，避免每次 build 都生成无用文件 / 拖慢 CI
  vite: () =>
    process.env.ANALYZE
      ? {
          plugins: [
            visualizer({
              filename: 'stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ],
        }
      : {},
  // ─── 跨浏览器 manifest ─────────────────────────────
  // 用函数式 manifest 让 chrome / firefox 各自合法：
  // - chrome MV3：保留 'favicon' 权限（用于 chrome-extension://EXT_ID/_favicon/）
  // - firefox MV2：移除 'favicon'（不被支持，会触发 manifest 校验警告）
  manifest: ({ browser }) => ({
    name: 'Curio - 书签整理新标签页',
    short_name: 'Curio',
    description: '替代浏览器新标签页，DIY 你的个人书签整理面板',
    // 上架 Chrome Web Store 时审核会看的元信息：
    // - author：用于商店「开发者」一栏
    // - homepage_url：用户在扩展详情页点「来源」会跳到这里
    // - minimum_chrome_version：避免老版 Chrome 安装后 LanguageModel / favicon
    //   等 API 缺失而白屏；保守取 120（覆盖了 MV3 + 现代 ECMA + favicon URL）
    author: 'yuqiao-yq',
    homepage_url: 'https://github.com/yuqiao-yq/curio',
    ...(browser === 'chrome' ? { minimum_chrome_version: '120' } : {}),
    permissions: [
      'bookmarks',
      'storage',
      ...(browser === 'chrome' && process.env.GOOGLE_DRIVE_CLIENT_ID ? ['identity'] : []),
      // 'tabs' 用于工具栏 popup「添加当前页面」功能：读取 active tab 的 title/url
      'tabs',
      ...(browser === 'chrome' ? ['favicon'] : []),
    ],
    // 网站与历史权限由用户使用对应功能时申请。
    // Firefox MV2 把可选网站匹配模式放在 optional_permissions 中。
    ...(browser === 'firefox'
      ? { optional_permissions: ['history', '<all_urls>'] }
      : { optional_host_permissions: ['<all_urls>'], optional_permissions: ['history'] }),
    ...(browser === 'chrome' && process.env.GOOGLE_DRIVE_CLIENT_ID
      ? {
          oauth2: {
            client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
            scopes: ['https://www.googleapis.com/auth/drive.appdata'],
          },
        }
      : {}),
    // WXT 默认会按文件名自动从 public/icon/*.png 生成 icons 字段，
    // 但商店审核偶尔会因「未显式声明」打回；这里显式列出 16/32/48/96/128。
    // 文件实际存在于 public/icon/ 下（由 scripts/generate-icons.mjs 产出）。
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
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
  // 真正发布到 AMO 时，需按可选同步和模型请求补充正式数据声明。
  // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
  suppressWarnings: {
    firefoxDataCollection: true,
  },
})
