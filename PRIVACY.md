# Privacy Policy / 隐私政策

**Effective date / 生效日期**: 2026-09-07
**Extension / 扩展名称**: Curio - Bookmark New Tab (`curio`)
**Contact / 联系方式**: open an issue at <https://github.com/yuqiao-yq/curio/issues>

---

## English

### 1. TL;DR

Curio is a **local-first** new-tab bookmark organizer.
The developers operate no data-collection server and do not sell your data.
Curio stores your library locally. Optional browser sync sends selected data
through your browser account; remote AI sends prompts directly to your selected
provider. Content fetching, link checking, web search and external images contact
the sites involved when you use those features.

### 2. What data does Curio handle?

The local data stores are listed below. Opt-in sync and AI requests are described separately:

| Data | Where it is stored | Who can read it |
|------|--------------------|-----------------|
| Bookmark cards, categories, tags, notes | `browser.storage.local` | This browser profile; selected data may be synced when enabled |
| Automatic backups (last 10 versions) | Local IndexedDB, `curio-backups` | This browser profile; includes library preferences, excludes AI API keys |
| Preferences and AI configuration | `browser.storage.local`; a preference whitelist may use `storage.sync` | This browser profile and, for synced preferences, your browser account; AI configuration and keys are excluded from sync |
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
| Optional website access (`<all_urls>`) | **Requested at runtime.** AI provider setup requests access to the selected endpoint; content fetching and link checks request website access when invoked. Curio then performs a plain `fetch` of the public HTML of bookmarks you have already saved, extracts readable text via Mozilla Readability, and stores the result **locally** in IndexedDB so AI search can find it. Content fetching omits cookies and authentication headers. Extracted text is sent to your configured AI model only after you enable the separate page-content permission. You can disable this feature at any time and clear all cached content from Settings. |

### 4. Optional AI features

The separate **Allow AI to use fetched page content** setting defaults to off. When off, indexing and retrieval use bookmark metadata without sending cached page text. When enabled, relevant text may be sent to your configured chat, embedding and summary endpoints. Revoking permission does not recall data already sent.

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

When you enable browser sync, Curio writes bookmark structure and selected
preferences to `browser.storage.sync`. Your browser handles transmission through
its account service; the Curio developers do not receive a copy. Chrome and Firefox
use separate sync services. AI configuration, API keys, fetched page content and
local backups are excluded. Google Drive currently has a configuration entry only:
no Drive authorization or upload runs in this version.

### 6. Data sharing and sale

The developers do not sell, rent or trade your data. Optional sync, AI and
website requests send data to the services described above.

### 7. Children's privacy

Curio is not directed at children under 13. We do not knowingly collect
any data from anyone.

### 8. Changes to this policy

If we materially change this policy in the future, we will update the
"Effective date" at the top and announce the change in the GitHub
repository's release notes.

### 9. Your rights

You can manage local data using the following controls. Uninstalling removes
local backups; it does not recall data previously sent to an AI provider or remove
independent exports. Use Data → Sync to manage synced data separately.

- Settings → "Clear local content cache" / "Reset preferences"
- Removing the Curio extension from `chrome://extensions/`
- Exporting all data to JSON at any time (Settings → Data → Export)

---

## 中文

### 1. 一句话总结

Curio 是一个**本地优先**的新标签页书签整理工具。
开发者没有数据收集服务器，也不出售你的数据。书签库默认保存在本地。启用浏览器同步后，指定数据经浏览器账号服务传输；使用远程 AI 时，请求直接发送给你选择的服务商。使用网页抓取、失效检测、网络搜索或外部图片时，也会连接相关网站。

### 2. Curio 会处理哪些数据？

本地数据的存储方式如下；可选同步和 AI 请求另见后文：

| 数据 | 存储位置 | 谁能读取 |
|------|----------|----------|
| 书签卡片、分类、标签、备注 | `browser.storage.local` | 当前浏览器配置；启用同步后可传给浏览器账号服务 |
| 自动备份（最近 10 个版本） | 本机 IndexedDB：`curio-backups` | 当前浏览器配置；包含书签偏好，不含 AI API Key |
| 用户偏好与 AI 配置 | `browser.storage.local`；偏好白名单可写入 `storage.sync` | 当前浏览器配置及已启用的浏览器账号；AI 配置和密钥不参与同步 |
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
| Optional website access (`<all_urls>`) | **运行时申请**。添加/测试 AI 模型时申请对应端点，内容抓取与失效检测时申请网站访问。内容抓取：对你**已收藏的书签** URL 发起公共 `fetch` 请求，借助 Mozilla Readability 抽取正文，结果仅写入**本地** IndexedDB 供 AI 搜索使用。抓取请求**不会**携带 cookie 或 Authorization 头；另行开启「允许 AI 使用已抓取正文」后，正文片段可发送给你配置的模型。你可以在「设置」中随时关闭并清空所有抓取过的内容。 |

### 4. 可选的 AI 功能

「允许 AI 使用已抓取正文」默认关闭。关闭时不向模型发送已抓取正文；开启后可把相关片段发送给所配置的对话、摘要和向量模型。撤回许可不会撤回已发送的数据。删除、导入与覆盖前的自动备份仅保存在本地 IndexedDB，不含 API Key，保留最近 10 个版本。

Curio 的 AI 功能**默认完全关闭**。开启后有两种独立运行模式：

1. **本地（Chrome 内置 Gemini Nano）**：完全运行在你的浏览器内部，通过 Chrome `LanguageModel` API 推理，**不发任何网络请求**。
2. **远程 Provider（OpenAI / DeepSeek / Ollama / 任何 OpenAI 兼容端点）**：只有你手动添加 Provider 并填入自己的 API Key 与 Base URL 后才会启用。此时，请求内容（可能包含与查询相关的书签标题、URL 与正文）会**直接从你的浏览器发送到你配置的端点**。Curio 不充当代理，我们看不到这部分流量。

你需要自行了解所选第三方 LLM 服务商的隐私政策。你的 API Key 仅通过 `chrome.storage` 存储在本地，**永远不会发送给我们**（我们也没有服务器接收）。

### 5. 浏览器账号同步（`chrome.storage.sync`）

开启同步后，Curio 把书签结构和偏好白名单写入 `browser.storage.sync`，浏览器通过其账号服务传输，Curio 开发者不接收副本。Chrome 与 Firefox 使用各自独立的同步服务。AI 配置、API Key、抓取正文和本地备份不参与同步。Google Drive 目前只有配置入口，本版本尚未执行 Drive 授权或上传。

### 6. 数据共享与销售

开发者不销售、出租或交易你的数据。可选同步、AI 与网站访问会按上述说明把相关请求发送给所选服务。

### 7. 儿童隐私

Curio 不面向 13 岁以下儿童。我们不会有意收集任何人的数据。

### 8. 政策变更

如未来本政策有实质性变更，我们会更新顶部「生效日期」并在 GitHub 仓库的 Release Notes 中公告。

### 9. 你的权利

你可以通过下列入口管理本地数据。卸载会删除本地备份，但不会撤回已经发送给 AI 服务商的数据，也不会删除独立导出的文件。浏览器同步数据需在「数据管理 → 同步」中单独管理。

- 设置 → 「清除本地内容缓存」/「重置偏好」
- 在 `chrome://extensions/` 移除 Curio 扩展
- 任何时候都可以通过 设置 → 数据 → 导出 把所有数据导出为 JSON 备份
