# Chrome Web Store Listing — Curio

> 本文件是 Curio 提交 Chrome Web Store 时的素材文案。
> 直接复制粘贴到对应表单字段即可。
> 中英文各一份。如需更多语言，按相同结构补充即可。

---

## 一、核心字段对照表

| 商店字段 | 限制 | 中文取值 | 英文取值 |
|----------|------|----------|----------|
| **Name / 名称** | ≤ 75 字符 | Curio - 书签整理新标签页 | Curio - Bookmark New Tab |
| **Summary / 简短描述** | ≤ 132 字符 | 见下方「中文 · 简短描述」 | 见下方「English · Short description」 |
| **Category / 分类** | 单选 | Productivity（效率工具） | Productivity |
| **Language / 语言** | 多选 | 至少选 zh-CN / en；建议加 zh-TW / ja | — |
| **Privacy Policy URL** | URL | `https://<your-pages>/PRIVACY` | 同左 |
| **Homepage URL** | URL | `https://github.com/yuqiao-yq/curio` | 同左 |
| **Support URL** | URL | `https://github.com/yuqiao-yq/curio/issues` | 同左 |
| **Single purpose / 单一用途** | 1 句话 | 将浏览器新标签页替换为可自定义、可搜索、可分类的书签整理面板 | Replaces the browser's new-tab page with a customizable, searchable, categorized bookmark dashboard. |

---

## 二、中文版文案

### 中文 · 简短描述（Summary，≤ 132 字符）

> 替代浏览器新标签页，把零散书签整理成卡片墙：自定义分类、拖拽排序、智能搜索、可选 AI 助手，数据 100% 本地。

（实际字符数：60，留足空间）

### 中文 · 详细描述（Detailed description）

> 直接粘到商店「Detailed description」字段。Chrome 支持简单换行，不解析 Markdown，但保留缩进与符号。

```
🏠 Curio — 把新标签页变成你专属的书签整理面板

每次打开新标签页，看到的不再是默认空白，而是你自己整理好的、分类清晰的书签卡片墙。

━━━━━━━━━━━━━━━━━━━━
✨ 核心功能
━━━━━━━━━━━━━━━━━━━━

🎨 DIY 新标签页
  • 自定义分类 + 卡片网格，所有布局都可调
  • 支持精简 / 标准 / 大图三档卡片，按使用习惯切换
  • 跟随系统的深色 / 浅色主题

🖱️ 顺手的拖拽体验
  • 卡片可在分类内或跨分类自由拖拽
  • 从其他网页直接拖链接进来即可建书签
  • 分类侧栏拖拽排序，所见即所得

🔍 多模式搜索
  • 标题 / URL 实时模糊匹配
  • 用 #标签 按 tag 收敛
  • 用 @ai 走语义搜索（需自行配置 AI Provider）
  • 用 @web 直接打开搜索引擎

📥 一键导入 + 数据自由
  • 从浏览器原生书签批量导入
  • JSON 导入 / 导出，跨浏览器迁移无障碍
  • 可选「自动镜像到浏览器书签栏」让原生书签栏跟随

🔄 跨设备同步
  • 通过 Chrome 自带的账号同步，零成本在多个浏览器配置间同步偏好和分类
  • 同步由 Chrome 自己加密，Curio 不接触你的数据

🪄 可选 AI 助手（默认完全关闭）
  • 自动整理 / 打标签 / 语义搜索 / 相关阅读
  • 可走 Chrome 内置 Gemini Nano（完全本地）
  • 也可填自己的 OpenAI / DeepSeek / Ollama 等 API Key 走云端
  • 你的 API Key 仅本地存储，永不上传

━━━━━━━━━━━━━━━━━━━━
🔒 隐私承诺
━━━━━━━━━━━━━━━━━━━━

Curio 是一个本地优先的工具，我们：
✓ 不收集任何用户数据
✓ 没有任何后端服务器、统计上报、追踪 SDK
✓ 所有书签、分类、偏好都只存在你本机（IndexedDB / chrome.storage）
✓ 「内容抓取」和「包含浏览历史」等敏感能力默认关闭，需你主动启用
✓ 完整隐私政策见 GitHub 仓库 PRIVACY.md

权限说明：
• bookmarks：核心功能，读取和写入你的浏览器书签
• storage：保存你的分类与偏好
• history：可选；仅在你开启「包含浏览历史」时按需查询
• tabs：popup 的「添加当前页面」按钮用来读取当前 tab 标题与 URL
• favicon：本地渲染网站图标，不走第三方服务
• <all_urls>：可选；仅在你启用「内容抓取」后，对你已收藏的书签发起公共 fetch

━━━━━━━━━━━━━━━━━━━━
⌨️ 快捷键
━━━━━━━━━━━━━━━━━━━━

• ⌘J / Ctrl+J  →  唤起 AI 助手浮窗
• /            →  聚焦顶部搜索框
• Esc          →  关闭弹层 / 取消编辑

━━━━━━━━━━━━━━━━━━━━
🆓 开源 & 免费
━━━━━━━━━━━━━━━━━━━━

Curio 在 MIT 协议下完全开源。问题反馈、功能建议或贡献代码：
https://github.com/yuqiao-yq/curio
```

---

## 三、English version

### English · Short description (Summary, ≤ 132 chars)

> Turn your new tab into a customizable bookmark dashboard. Categories, drag & drop, smart search, optional AI. 100% local data.

(actual length: 127 chars, fits)

### English · Detailed description

```
🏠 Curio — Turn your new tab into a personal bookmark dashboard

Every time you open a new tab, instead of an empty page, you see your own
clean, categorized wall of bookmark cards.

━━━━━━━━━━━━━━━━━━━━
✨ Core features
━━━━━━━━━━━━━━━━━━━━

🎨 A new-tab page you fully own
  • Custom categories + card grid, every layout is adjustable
  • Compact / Standard / Large card sizes
  • Auto dark mode, follows your system

🖱️ Smooth drag & drop
  • Drag cards inside a category or across categories
  • Drag any link from another tab to instantly create a bookmark
  • Reorder the sidebar with the mouse, WYSIWYG

🔍 Multi-mode search
  • Live fuzzy match on title / URL
  • Filter by #tag
  • Use @ai for semantic search (your own AI Provider required)
  • Use @web to jump straight to a search engine

📥 One-click import + free data
  • Bulk-import from native browser bookmarks
  • JSON import / export, painless migration across browsers
  • Optional "Auto-mirror to native bookmarks" keeps your bookmark bar
    in sync

🔄 Cross-device sync
  • Uses Chrome's built-in sync to share preferences and categories
    across browser profiles signed into the same account
  • Encryption and transport are handled by Chrome itself; Curio does
    not see your data

🪄 Optional AI assistant (off by default)
  • Auto-organize / auto-tag / semantic search / related reading
  • Runs locally via Chrome's built-in Gemini Nano (no network)
  • Or plug in your own OpenAI / DeepSeek / Ollama API key for cloud
    inference
  • API keys are stored locally and never uploaded

━━━━━━━━━━━━━━━━━━━━
🔒 Privacy promise
━━━━━━━━━━━━━━━━━━━━

Curio is local-first. We:
✓ Do not collect any user data
✓ Have no backend server, no analytics, no tracking SDKs
✓ Store every bookmark, category, and preference locally
  (IndexedDB / chrome.storage)
✓ Keep sensitive capabilities like "Content fetching" and "Include
  browser history" disabled by default; you turn them on explicitly
✓ Full privacy policy in PRIVACY.md on the GitHub repo

Permissions explained:
• bookmarks      — Core. Read & write your browser bookmarks.
• storage        — Persist categories and preferences.
• history        — Opt-in. Only used when you enable "Include browser
                   history" in the Recent module.
• tabs           — Used by the toolbar popup's "Add current page"
                   button to read the active tab's title and URL.
• favicon        — Render site icons locally, no third-party services.
• <all_urls>     — Opt-in. Only used when you enable "Content
                   fetching"; performs a plain public fetch of
                   bookmarks you have already saved. No cookies,
                   no uploads.

━━━━━━━━━━━━━━━━━━━━
⌨️ Shortcuts
━━━━━━━━━━━━━━━━━━━━

• ⌘J / Ctrl+J  →  Open the AI assistant
• /            →  Focus the top search box
• Esc          →  Close dialogs / cancel editing

━━━━━━━━━━━━━━━━━━━━
🆓 Open source & free
━━━━━━━━━━━━━━━━━━━━

Curio is fully open source under the MIT license. Issues, feature
requests, and pull requests are welcome:
https://github.com/yuqiao-yq/curio
```

---

## 四、Privacy Practices 表单（关键，最容易卡审核）

在 Dashboard 的 **Privacy practices** Tab 里，每一项都要填。下面给你**逐项**的标准答案。

### 4.1 Single purpose / 单一用途

```
Replaces the browser's new-tab page with a customizable, searchable,
categorized bookmark dashboard.
```

### 4.2 Permission justifications / 权限解释

| Permission | Justification |
|-----------|----------------|
| `bookmarks` | Core functionality. Read and write the user's browser bookmarks to render them as an organized dashboard and (optionally) mirror user changes back to the native bookmark bar. |
| `storage` | Persist user-created categories, layout preferences, and (optional) AI provider configuration via `chrome.storage`. No remote storage. |
| `history` | Opt-in feature only. When the user enables "Include browser history" in the Recent Items module, we call `chrome.history.search` to render recently visited pages on the new-tab page. The result is never copied off-device. |
| `tabs` | Used by the toolbar popup's "Add current page" button to read the active tab's `title` and `url` so the page can be saved as a new bookmark. We do not enumerate other tabs. |
| `favicon` | Render bookmark site icons via the local `chrome-extension://EXT_ID/_favicon/` URL scheme, avoiding network requests to third-party favicon services. |
| `host_permissions: <all_urls>` | Opt-in feature only. When the user enables "Content fetching" in Settings, the extension performs a plain `fetch` of the public HTML of bookmarks the user has already saved, extracts readable text via Mozilla Readability, and stores the result locally in IndexedDB so the optional AI search can find it. No cookies, no authentication headers, nothing is uploaded. The feature can be disabled at any time and all cached content can be cleared from Settings. |

### 4.3 Remote code / 远程代码

选 **"I am not using Remote code"**。Curio 不动态 eval、不远程加载 JS，全部脚本随包发布。

### 4.4 Data usage / 数据使用声明

> 这是最关键的一栏，错填一个会被打回。

**勾选项**：

- [x] Does **not** collect or use **Personally identifiable information**
- [x] Does **not** collect or use **Health information**
- [x] Does **not** collect or use **Financial and payment information**
- [x] Does **not** collect or use **Authentication information**
- [x] Does **not** collect or use **Personal communications**
- [x] Does **not** collect or use **Location**
- [x] Does **not** collect or use **Web history**
  - 注：`chrome.history.search` 仅在用户主动开启时按需读取并 **on-the-fly 渲染**，**不持久化、不上传**。这种用法在 Chrome Web Store 的定义里**不算 "collect"**。
- [x] Does **not** collect or use **User activity**
- [x] Does **not** collect or use **Website content**
  - 注：内容抓取功能仅在用户主动开启后对**用户已保存的书签** URL 抓取，且**仅存本地**，同样不算 "collect"。

**底部三项 Certifications** 全部勾上：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## 五、截图建议（5 张，1280 × 800）

按以下顺序拍，每张配一句中英双语标题：

1. **主界面全景** — 新标签页 + 已分类的卡片墙
   - 中：把零散书签整理成你专属的卡片墙
   - 英：Turn scattered bookmarks into a dashboard you own
2. **拖拽体验** — 一张卡片正被跨分类拖动（DragOverlay 浮起态）
   - 中：拖拽即分类，告别右键菜单
   - 英：Drag & drop instead of right-click menus
3. **搜索模式** — 顶部搜索框输入 `#标签` 的筛选效果
   - 中：标题 / URL / #标签 / @ai 多模式搜索
   - 英：Search by title, URL, #tag, or @ai semantic mode
4. **AI 助手** — 浮窗展开 + 一段"整理建议"的对话
   - 中：可选的 AI 助手 · 整理 / 打标签 / 语义搜索
   - 英：Optional AI assistant for organizing & semantic search
5. **设置 · 隐私** — 「内容抓取 / 浏览历史」开关都 OFF 的截图
   - 中：所有数据 100% 在你的设备上
   - 英：100% local data, no servers, no tracking

---

## 六、提交前自检 Checklist

- [ ] `pnpm compile` 通过（TS 无错）
- [ ] `pnpm build` 通过
- [ ] 加载 `.output/chrome-mv3/` 到 chrome://extensions 做最后一遍回归
- [ ] [`PRIVACY.md`](PRIVACY.md) 已通过 GitHub Pages 发布，URL 可访问
- [ ] [`wxt.config.ts`](wxt.config.ts) 的 `homepage_url` 指向真实仓库
- [ ] [`package.json`](package.json) 的 `version` 是想发布的版本号
- [ ] `pnpm zip` 生成 `.output/curio-x.y.z-chrome.zip`
- [ ] 5 张截图已准备 (1280×800)
- [ ] 440×280 推广小图已准备
- [ ] Privacy practices 表单按本文 §4 填写
