# Privacy Policy / 隐私政策

**Effective date / 生效日期**: 2026-06-09
**Extension / 扩展名称**: Curio - Bookmark New Tab (`curio`)
**Contact / 联系方式**: open an issue at <https://github.com/yuqiao-yq/curio/issues>

---

## English

### 1. TL;DR

Curio is a **local-first** new-tab bookmark organizer.
**We do not collect, transmit, sell, or share any personal data.**
Everything you do in Curio stays on your own device, with two clearly-bounded
exceptions that **only run when you explicitly enable them** (Sync via your
own browser account, and optional AI features with your own API key).

### 2. What data does Curio handle?

All data is stored **locally on your device** using browser-provided APIs:

| Data | Where it is stored | Who can read it |
|------|--------------------|-----------------|
| Bookmark cards, categories, tags, notes | `IndexedDB` on your device | Only you, in this browser profile |
| User preferences (theme, layout, AI settings) | `chrome.storage.local` / `chrome.storage.sync` | Only you, in this browser profile |
| Cached page favicons | Browser `_favicon` cache | Only you, in this browser profile |
| Optional: extracted webpage text (for AI search) | `IndexedDB` (table `pageContents`) | Only you, in this browser profile |
| Recently visited entries (if "include history" is enabled) | Read on demand from `chrome.history`, **not copied or stored** | Only you, in this browser profile |

We do **not** maintain any backend server, analytics, telemetry, crash
reporting, or third-party tracking SDK. There is no Curio account.

### 3. Permissions we request, and why

Curio's manifest declares the following permissions. Each is used for a
specific, user-visible feature, and most are only invoked after you
explicitly opt in.

| Permission | Why we need it |
|-----------|----------------|
| `bookmarks` | Core functionality. Read and write your browser bookmarks so Curio can organize them into a visual dashboard and (optionally) mirror your changes back to the native bookmark bar. |
| `storage` | Persist your categories, preferences, and AI configuration in `chrome.storage`. |
| `history` | **Opt-in.** Only used when you toggle "Include browser history" in the Recent module. We call `chrome.history.search` on demand to render recently visited pages; results are never copied off-device. |
| `tabs` | Used by the toolbar popup's "Add current page" button to read the active tab's `title` and `url` so it can be saved as a new bookmark. |
| `favicon` | Render bookmark site icons via the local `chrome-extension://EXT_ID/_favicon/` URL scheme, avoiding third-party favicon-fetching services. |
| `host_permissions: <all_urls>` | **Opt-in.** Only used when you enable "Content fetching" in Settings. Curio then performs a plain `fetch` of the public HTML of bookmarks you have already saved, extracts readable text via Mozilla Readability, and stores the result **locally** in IndexedDB so AI search can find it. No cookies, no authentication headers, no uploads. You can disable this feature at any time and clear all cached content from Settings. |

### 4. Optional AI features

Curio's AI features are **disabled by default**. If you choose to enable
them, two distinct execution modes are available:

1. **Local (Chrome built-in Gemini Nano)**: Runs entirely inside your
   browser via the Chrome `LanguageModel` API. No network requests are made
   for inference.
2. **Remote provider (OpenAI / DeepSeek / Ollama / any OpenAI-compatible
   endpoint)**: Only when you manually add a Provider with your own API key
   and base URL. In this mode, the prompt content (which may include
   bookmark titles, URLs, and extracted page text relevant to your query)
   is sent **directly from your browser to the endpoint you configured**.
   Curio is not a proxy; we do not see this traffic.

You are responsible for understanding the privacy policy of any third-party
LLM provider you configure. Your API keys are stored locally via
`chrome.storage` and are never transmitted to us (we have no server).

### 5. Browser sync (`chrome.storage.sync`)

Curio uses Chrome's built-in `chrome.storage.sync` to keep your preferences
and bookmark structure in sync across browser profiles signed into the same
Google account. This data is encrypted and synchronized **by Chrome
itself**; Curio does not see, store, or transmit it. See
<https://support.google.com/chrome/answer/165139> for details on how Google
handles Chrome Sync data.

### 6. Data sharing and sale

We do not sell, rent, trade, or otherwise share any data, because we do not
collect or transmit any to begin with.

### 7. Children's privacy

Curio is not directed at children under 13. We do not knowingly collect
any data from anyone.

### 8. Changes to this policy

If we materially change this policy in the future, we will update the
"Effective date" at the top and announce the change in the GitHub
repository's release notes.

### 9. Your rights

Because all data lives locally on your device, you can erase it at any time
by:

- Settings → "Clear local content cache" / "Reset preferences"
- Removing the Curio extension from `chrome://extensions/`
- Exporting all data to JSON at any time (Settings → Data → Export)

---

## 中文

### 1. 一句话总结

Curio 是一个**本地优先**的新标签页书签整理工具。
**我们不收集、不上传、不出售、不分享任何个人数据。**
你的所有数据都保留在自己的设备上。只有两类例外功能会与外部交互，并且**仅在你主动开启后才会运行**：浏览器账号同步（由 Chrome 自己加密同步）和可选 AI 功能（使用你自己提供的 API Key）。

### 2. Curio 会处理哪些数据？

所有数据都通过浏览器原生 API 存储在**你本机**：

| 数据 | 存储位置 | 谁能读取 |
|------|----------|----------|
| 书签卡片、分类、标签、备注 | 本机 `IndexedDB` | 仅当前浏览器配置下的你 |
| 用户偏好（主题、布局、AI 设置） | `chrome.storage.local` / `chrome.storage.sync` | 仅当前浏览器配置下的你 |
| 网站 favicon 缓存 | 浏览器内置 `_favicon` 缓存 | 仅当前浏览器配置下的你 |
| 可选：网页正文（供 AI 搜索使用） | 本机 `IndexedDB`（`pageContents` 表） | 仅当前浏览器配置下的你 |
| 浏览历史条目（仅在开启「包含浏览历史」时） | 按需通过 `chrome.history` 读取，**不复制、不持久化** | 仅当前浏览器配置下的你 |

我们**没有**任何后端服务器、统计上报、崩溃日志、第三方追踪 SDK。Curio 没有"账号"概念。

### 3. 权限说明

| 权限 | 用途 |
|------|------|
| `bookmarks` | 核心功能。读取与写入浏览器原生书签，用于可视化展示与（可选的）双向镜像。 |
| `storage` | 通过 `chrome.storage` 持久化分类、偏好和 AI 配置。 |
| `history` | **需主动开启**。仅当你在「最近使用」模块勾选「包含浏览历史」时使用，调用 `chrome.history.search` 按需读取，**结果不会被复制或上传**。 |
| `tabs` | 工具栏 popup 的「添加当前页面」按钮用来读取当前 tab 的 `title` 和 `url`，以便快速保存为书签。 |
| `favicon` | 通过 `chrome-extension://EXT_ID/_favicon/` 在本地渲染网站图标，避免向第三方 favicon 服务发请求。 |
| `host_permissions: <all_urls>` | **需主动开启**。仅当你在「设置」中开启「内容抓取」时使用：对你**已收藏的书签** URL 发起公共 `fetch` 请求，借助 Mozilla Readability 抽取正文，结果仅写入**本地** IndexedDB 供 AI 搜索使用。**不会**携带 cookie、不会带 Authorization 头、不会上传任何数据。你可以在「设置」中随时关闭并清空所有抓取过的内容。 |

### 4. 可选的 AI 功能

Curio 的 AI 功能**默认完全关闭**。开启后有两种独立运行模式：

1. **本地（Chrome 内置 Gemini Nano）**：完全运行在你的浏览器内部，通过 Chrome `LanguageModel` API 推理，**不发任何网络请求**。
2. **远程 Provider（OpenAI / DeepSeek / Ollama / 任何 OpenAI 兼容端点）**：只有你手动添加 Provider 并填入自己的 API Key 与 Base URL 后才会启用。此时，请求内容（可能包含与查询相关的书签标题、URL 与正文）会**直接从你的浏览器发送到你配置的端点**。Curio 不充当代理，我们看不到这部分流量。

你需要自行了解所选第三方 LLM 服务商的隐私政策。你的 API Key 仅通过 `chrome.storage` 存储在本地，**永远不会发送给我们**（我们也没有服务器接收）。

### 5. 浏览器账号同步（`chrome.storage.sync`）

Curio 使用 Chrome 内置的 `chrome.storage.sync` 在同一 Google 账号下的多个浏览器配置之间同步偏好和书签结构。该过程的**加密与同步由 Chrome 自身完成**，Curio 不接触、不存储、不上传该数据。详见 <https://support.google.com/chrome/answer/165139>。

### 6. 数据共享与销售

我们**不**销售、出租、交易或分享任何数据 —— 因为我们根本不收集、不上传任何数据。

### 7. 儿童隐私

Curio 不面向 13 岁以下儿童。我们不会有意收集任何人的数据。

### 8. 政策变更

如未来本政策有实质性变更，我们会更新顶部「生效日期」并在 GitHub 仓库的 Release Notes 中公告。

### 9. 你的权利

所有数据都在你本机，你可以随时彻底清除：

- 设置 → 「清除本地内容缓存」/「重置偏好」
- 在 `chrome://extensions/` 移除 Curio 扩展
- 任何时候都可以通过 设置 → 数据 → 导出 把所有数据导出为 JSON 备份
