# Curio - AI 接入开发计划

> 本文档是 [`ROADMAP.md`](./ROADMAP.md) 中 V3.0 「AI 自动分类」「智能去重」等条目的展开版，
> 覆盖完整的 AI 能力规划、技术架构、隐私与成本设计，以及可勾选的实施 checklist。
>
> 维护节奏：每完成一项任务勾掉对应 `[ ]`；阶段完成后在阶段标题前加 ✅。

---

## 1. 愿景与定位

| 阶段 | 定位 |
|------|------|
| 今天 | DIY 新标签页 + 书签整理工具 |
| **AI 接入后** | **个人浏览数据的智能管家** —— 让 N 千个书签从负担变成可搜索、可对话的资产 |

核心 slogan：**「AI 帮你整理、提炼、检索你这些年攒下的整个互联网」**

---

## 2. 总体架构与原则

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                  UI Layer (React Components)            │
│  ✨ FAB │ Floating Panel │ Tabs │ Diff Viewer │ Chat   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              AI Service Layer (业务编排)                 │
│  organizer / labeler / searcher / chatter / suggester   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Provider Abstraction (统一接口)             │
│  chat() │ embedding() │ stream()                        │
└─────────────────────────────────────────────────────────┘
                           ↓
┌────────────┬────────────┬────────────┬─────────────────┐
│  OpenAI    │ DeepSeek   │ window.ai  │  Local (Ollama) │
│  Compatible│ /Moonshot/ │ (Chrome    │                 │
│  Adapter   │ Azure...   │  Built-in) │                 │
└────────────┴────────────┴────────────┴─────────────────┘
```

### 2.2 核心原则

| 原则 | 含义 |
|------|------|
| **Opt-in** | 所有 AI 功能默认关闭；首次使用前显式同意 |
| **隐私优先** | 默认匿名模式（URL 仅取 domain）；用户可主动放开为完整模式 |
| **本地优先** | Chrome `window.ai` 可用时优先本地，降本兼降隐私风险 |
| **可撤销** | AI 改动数据前必留 snapshot；至少 60s 撤销窗 |
| **成本透明** | 每次操作前显示 token 估算 + 成本估算 |
| **能力外露** | 提供本地 HTTP API，让 Cursor / Raycast 等生态接入 |
| **交互浮窗化** | 所有 AI 交互收敛到一个**可拖动浮窗** + 内部 Tab，主区永远不被打扰 |

---

## 3. 阶段路线图（一览）

| 阶段 | 主题 | 关键能力 | 预计工期 |
|------|------|---------|---------|
| V1.0 | **浮窗壳子 + 基础设施 + 整理助手** | 浮窗框架 / API 入口 / AI 整理 / AI 加书签 / 自动标签 | 3-4 周 |
| V1.5 | **智能搜索增强** | 语义搜索 / 被动整理建议 / window.ai 优先 | 1-2 周 |
| V2.0 | **个人知识库** | 网页内容抓取 / RAG 问答 / AI 总结备注 / 重复检测 | 3-4 周 |
| V3.0 | **生态扩展** | 本地 HTTP API / MCP Server 桥接 / 相关推荐 / 多浮窗 | 2-3 周 |

---

## ✅ 4. 阶段一：V1.0 AI MVP（3-4 周）

### ✅ 任务 4.0 浮窗壳子（FAB + Floating Panel + Tab）⭐ 前置

**优先级**：P0（所有 AI 功能的前置依赖）  ·  **工期**：4-5 天  ·  **依赖**：无

#### 用户故事
> 作为用户，我希望有一个**永远在角落随时可调用**的 AI 助手浮窗，
> 它**不抢主区空间**，我可以**拖到任何位置 / 自由调整大小**，
> 也可以最小化为小角标继续浏览，不被它打扰。

#### 验收标准（DoD）
- [ ] 右下角悬浮按钮（FAB）：52×52，圆形，brand 色，✨ 图标
- [ ] FAB 状态机：
  - **未配置 AI**：灰色，点击 → 浮窗打开「⚙ 设置」tab，引导配置
  - **已配置、浮窗关闭**：彩色，点击 → 浮窗打开
  - **浮窗展开中**：FAB 隐藏（避免双入口）
  - **浮窗最小化**：FAB 隐藏（小 chip 自身就是入口）
  - **AI 处理中**：呼吸光晕动画
- [ ] 浮窗（Floating Panel）：
  - 默认尺寸 380 × 520，最小 280×360，最大 720×80vh
  - 默认位置：距右 24，距底 96（避开 FAB）
  - 整个 header 都是拖动区
  - 右下 + 右边缘 + 下边缘 三处 resize 手柄
  - 双击 header → 切换最大化（70vw × 80vh）
  - 右键 header → 「恢复默认位置 / 永远置顶 / 关闭」
  - **失焦不关闭**（与 modal 不同）
  - 点击浮窗 → 自动 z-index 置顶
  - ESC 不关闭（持续存在是核心价值）
- [ ] 最小化形态：右下角小 chip `[ ✨ AI 助手 (思考中…) ▴ ] [×]`
- [ ] 内部 Tab 体系：`[💬 对话][🗂 整理][🏷 标签][⚙ 设置][+]`
- [ ] 全局快捷键 `Cmd/Ctrl+J` 唤起 / 隐藏浮窗
- [ ] 浮窗位置 / 尺寸 / 当前 Tab 持久化到 `chrome.storage.local`
- [ ] 边界保护：浮窗位置不能超出视口（至少留 100px 在视口内）
- [ ] 视口变化（resize）时：超出视口的浮窗自动吸附回来

#### 技术要点

**1. 拖动 / Resize**

```ts
// 用 transform 不用 left/top，避免 reflow，60fps 流畅
element.style.transform = `translate3d(${x}px, ${y}px, 0)`
element.style.willChange = 'transform'

// 拖动期间禁文本选中
document.body.style.userSelect = 'none'
```

**2. 状态管理（zustand）**

```ts
interface AIPanelState {
  visible: boolean
  minimized: boolean
  maximized: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  activeTab: string
  tabs: AIPanelTab[]
  zIndex: number  // 多浮窗时用（V2）

  open: () => void
  close: () => void
  toggleMinimize: () => void
  toggleMaximize: () => void
  setPosition: (p: Position) => void
  setSize: (s: Size) => void
  addTab: (tab: AIPanelTab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
}
```

**3. z-index 体系**

- ToastContainer：`z-[10000]`
- CardMenu / IconPicker：`z-[9999]`
- AI Panel：`z-[10100]`（高于 toast，因为浮窗持续存在不应被遮挡）
- AI Panel 拖动到上面时：临时拉到 `10200`

#### 文件清单
```
src/ai/
├── types.ts                       # AI 公共类型
└── panel/
    ├── usePanelStore.ts           # 浮窗状态 + 持久化
    ├── useDraggable.ts            # 拖动 hook（headless）
    └── useResizable.ts            # 缩放 hook（headless）

src/components/ai/
├── AIFAB.tsx                      # 右下角 ✨ 浮按钮
├── AIPanel.tsx                    # 浮窗容器
├── AIPanelHeader.tsx              # 拖动条 + 控制按钮
├── AIPanelTabs.tsx                # tab 切换条
├── AIPanelMinimized.tsx           # 最小化小 chip
└── tabs/
    ├── ChatTab.tsx                # 占位
    ├── OrganizeTab.tsx            # 占位
    ├── LabelsTab.tsx              # 占位
    └── SettingsTab.tsx            # 占位
```

#### Checklist
- [ ] zustand panel store + 持久化
- [ ] AIFAB 组件（含 4 种状态视觉）
- [ ] useDraggable hook（带边界保护）
- [ ] useResizable hook（三处手柄）
- [ ] AIPanel 容器（含 max-z-index 提升逻辑）
- [ ] AIPanelHeader（拖动 + 双击最大化 + 右键菜单）
- [ ] AIPanelTabs（基础 tab 切换 UI）
- [ ] AIPanelMinimized chip
- [ ] 全局快捷键 Cmd/Ctrl+J（在 App.tsx 注册）
- [ ] 视口变化吸附逻辑
- [ ] 4 个空 tab 占位组件（带 "敬请期待" 文案）
- [ ] 集成到 App.tsx（FAB + Panel 通过 portal 挂到 body）

---

### ✅ 任务 4.1 第三方 API 入口（设置 Tab）

**优先级**：P0  ·  **工期**：3-4 天  ·  **依赖**：4.0

#### 用户故事
> 作为用户，我希望能填入自己的 OpenAI 兼容服务（DeepSeek / 智谱 / 自部署 Ollama 等），
> 让 Curio 用我自己的额度跑 AI 功能。

#### 验收标准
- [ ] 浮窗「⚙ 设置」Tab 实现 Provider 配置 UI
- [ ] 支持添加多个 Provider（增删改）
- [ ] Provider 字段：name / type / baseURL / apiKey / model / 是否默认
- [ ] 提供「测试连接」按钮（发一条 hello 验证）
- [ ] 任务级路由：可分别为「对话」「分类」「Embedding」选不同 Provider
- [ ] API key 仅存 `chrome.storage.local`，**绝不进 sync 也不进 export json**
- [ ] 未配置任何 Provider 时，FAB 灰色 + 点击浮窗自动落到 ⚙ Tab 并显示引导

#### 技术要点
- 抽象 `Provider` 接口（`chat`、`embedding`、`stream`）
- 实现 `OpenAICompatibleProvider`（覆盖 95% 提供商）
- 实现 `WindowAIProvider`（Chrome 138+ Gemini Nano）

#### 文件清单
```
src/ai/
├── providers/
│   ├── base.ts                   # 抽象接口
│   ├── openai-compatible.ts      # 主力实现
│   └── window-ai.ts              # Chrome 内置
├── manager.ts                    # 全局 Provider 注册 + 路由
└── usage-tracker.ts              # 累计 token / 成本统计

src/components/ai/tabs/
└── SettingsTab.tsx               # 不再是独立弹窗，而是浮窗内 tab
```

#### Checklist
- [ ] `Provider` 抽象接口定义
- [ ] OpenAI Compatible adapter 实现
- [ ] Window.ai adapter 实现（带 fallback 检测）
- [ ] AISettings 类型 + zustand store（与 useBookmarkStore 解耦）
- [ ] AISettings 持久化到 chrome.storage.local
- [ ] SettingsTab 组件（Provider 列表 + 表单）
- [ ] 测试连接逻辑
- [ ] FAB 状态联动「是否已配置」

---

### ✅ 任务 4.2 AI 整理书签助手（整理 Tab）⭐ 核心

**优先级**：P0  ·  **工期**：5-7 天  ·  **依赖**：4.0 + 4.1

#### 用户故事
> 作为有 N 千个书签的重度用户，我希望让 AI 帮我自动按主题分组，
> 但**整理结果必须先预览**，我能挑选接受哪些建议，并随时撤销。

#### 验收标准
- [ ] 浮窗「🗂 整理」Tab 承载完整流程：
  1. **配置阶段**：整理范围（全部 / 当前分类 / 仅未分类）+ 风格倾向
  2. **执行前提示**：发送条目数 + 估算 token + 估算成本
  3. **执行中**：进度条（分批 prompt），可取消
  4. **Diff 预览**：按 section 分组（新建分类、移动、删除空分类）
  5. **应用 / 部分应用 / 取消**
- [ ] Diff 视图列表很长时，浮窗可双击 header 最大化（70vw）查看
- [ ] 单条建议可独立 ✓/✗
- [ ] 应用后写入 IndexedDB snapshot，60s 内可一键撤销（撤销提示用 toast 显示倒计时）
- [ ] 整理任务即使关闭浮窗也保留进度，重开后自动恢复到对应阶段

#### 技术要点

**1. 数据准备（控制 token 成本）**
```ts
type BookmarkSlice = {
  id: string
  title: string  // 截断到 80 字符
  domain: string // 仅 domain，不发完整 URL（隐私 + 省 token）
}
```

**2. Prompt 设计（强约束 JSON Schema）**：见附录 A.1

**3. 分批策略**
- 每批 100 条书签调一次 API
- 多批之间复用上一批的 newCategories 作为 context

**4. Diff Plan 数据结构**
```ts
type OrganizePlan = {
  id: string
  createdAt: number
  source: { type: 'all' | 'category', id?: string }
  newCategories: Array<{
    tempId: string
    name: string
    icon?: string
    bookmarkIds: string[]
  }>
  moves: Array<{
    bookmarkId: string
    fromCategory: string
    toCategoryNewTempId?: string
    toCategoryExistingId?: string
  }>
  deletions: string[]
  meta: { provider: string; tokens: number; cost: number }
}
```

#### 文件清单
```
src/ai/services/
├── organizer.ts                  # 调 LLM + 解析 + 分批
└── plan.ts                       # Plan 类型 + 应用 / 撤销

src/components/ai/tabs/
└── OrganizeTab.tsx               # 整理 Tab（多阶段）

src/components/ai/
├── DiffViewer.tsx                # diff 视图（按 section 分组）
└── OrganizeProgress.tsx          # 进度 + 取消
```

#### Checklist
- [ ] OrganizePlan 类型 + plan store
- [ ] 数据切片函数（去 URL，截标题）
- [ ] Prompt 模板 + JSON Schema 约束（zod 校验返回值）
- [ ] organizer service：分批 + 合并 + 去重
- [ ] OrganizeTab 多阶段组件（config / running / preview / done）
- [ ] 进度条 + 取消按钮
- [ ] DiffViewer 组件（按 section 分组展示）
- [ ] 单条 ✓/✗ 交互
- [ ] applyPlan 实现（含 IndexedDB snapshot）
- [ ] undoPlan 实现（60s 内可触发）
- [ ] 撤销 toast（持久 + 倒计时显示）
- [ ] 关闭浮窗保留任务状态（store 持久化）

---

### ✅ 任务 4.3 AI 添加书签辅助（popup）

**优先级**：P1  ·  **工期**：1-2 天  ·  **依赖**：4.1

> popup 自成体系，不接入浮窗范式（弹窗本身已经是浮层）

#### 用户故事
> 在 popup 里点「添加当前页面」时，我希望 AI 自动建议：
> - 应该归到哪个分类
> - 一句话简介当备注
> - 推荐的 tags

#### 验收标准
- [x] popup 「添加当前页面」表单内增加 ✨「AI 建议」按钮
- [x] 点击后调一次 LLM，自动填入 suggestedCategory / description / tags
- [x] 用户可修改后再保存
- [x] AI 未启用时按钮隐藏

#### Checklist
- [x] suggester service（单条调用）
- [x] popup UI：✨ 按钮 + loading 态 + 错误重试
- [x] 自动填充逻辑（不覆盖用户已修改的字段）

---

### ✅ 任务 4.4 自动打标签 + Tag 系统（标签 Tab）

**优先级**：P1  ·  **工期**：3-4 天  ·  **依赖**：4.0 + 4.1

#### 用户故事
> 我希望每个书签有 3-5 个标签（已经在数据模型预留 `tags?: string[]`），
> AI 可以批量为我没打标签的书签自动打。
> 我也能在卡片上看到、点击 tag 筛选。

#### 验收标准
- [ ] 卡片右下角显示 1-2 个 tag chip（hover 显示全部）
- [ ] 点 tag → 全局筛选（与搜索相似的扁平视图）
- [ ] 浮窗「🏷 标签」Tab 提供：
  - 「批量自动打标签」按钮
  - 标签管理面板（合并、改名、删除）
  - 标签使用统计
- [ ] 同样按 100 条/批 处理
- [ ] 顶部新增 ✨ 模式 chip：`# tag` 前缀进入标签搜索

#### Checklist
- [x] 卡片渲染 tag chip（≥1 个 tag 时显示）
- [x] tag 点击事件 → 全库筛选视图
- [x] tagger service（批量调用）
- [x] LabelsTab 组件（含批量 + 管理）
- [x] 搜索框支持 `#tag` 前缀
- [x] tags 合并 / 改名 store action

---

## ✅ 5. 阶段二：V1.5 智能搜索增强（1-2 周）

### ✅ 任务 5.1 语义搜索

**优先级**：P0  ·  **工期**：4-5 天  ·  **依赖**：4.1

#### 用户故事
> 我记不清原标题，只记得是"那篇讲 React 性能的文章"，
> 应该也能搜到。

#### 验收标准
- [x] 后台批量为所有书签生成 embedding（一次性，写入 IndexedDB）
- [x] 搜索框模式 chip 增加 `✨ AI`
- [x] AI 模式下按向量近似排序
- [x] 新建 / 修改书签后自动补 embedding（用 contentHash 自动标记 stale，⚙ 设置一键补缺；
  这样把"何时花钱"的决策权留给用户，符合"成本透明 / opt-in"红线）
- [x] 浮窗「⚙ 设置」Tab 增加「Embedding 管理」section（重新生成、查看进度）

#### 技术要点
- embedding 模型：默认 `text-embedding-3-small`（1536 维，便宜）
- 存储：IndexedDB 新表 `embeddings: { bookmarkId, vector: Float32Array, model, contentHash, createdAt }`
- 检索：余弦相似度，top K=20，本地计算
- 失败兜底：embedding 缺失的书签按原有 substring 搜索打补丁

#### Checklist
- [x] EmbeddingProvider 接口（`AIProvider.embedding`，OpenAICompatibleProvider 已实现）
- [x] 批量生成任务（带进度条，可在浮窗 ⚙ Tab 内查看）
- [x] IndexedDB embeddings table（dexie）
- [x] 余弦相似度计算函数（`cosineSimilarity`）
- [x] 搜索框 ✨ AI 模式（`@ai 关键字`）
- [x] BookmarkGrid 适配语义搜索结果排序（`AISearchView` + score 角标 + substring 兜底）
- [x] embedding 增量更新 hook（contentHash 比对自动识别 stale；⚙ 设置「补缺」按钮一键增量同步）

---

### ✅ 任务 5.2 被动整理建议

**优先级**：P2  ·  **工期**：2-3 天  ·  **依赖**：4.2

#### 验收标准
- [x] 每次新增书签累计 ≥ 10 条 / 距上次提示 ≥ 7 天 时触发
- [x] FAB 上加一个红点角标，点击浮窗自动落到「🗂 整理」Tab，并预填范围
- [x] 浮窗顶部有一条提示横幅（简化文案；未做"AI 主题聚类"自动分组提示，
  那需要先跑 embedding + 聚类，复杂度过高且会主动消费 token，留待后续）
- [x] 用户可全局关闭被动建议（在 ⚙ 设置 Tab → 通用 → 「被动整理建议」）

---

### ✅ 任务 5.3 Chrome window.ai 优先

**优先级**：P2  ·  **工期**：2 天  ·  **依赖**：4.1

#### 验收标准
- [x] AI 设置加「优先使用浏览器内置 AI」开关（`preferLocal`）
- [x] 启动时检测 `window.ai` 可用性，浮窗 footer 显示徽标 ✓ Local / ☁ Cloud / ⚠ Local 不可用
- [x] 路由层（`getProviderFor`）：preferLocal=true 时对 chat 任务优先用 type='window-ai'
  Provider；organize / embedding 仍走远程（Gemini Nano 不擅长大批量 / 中文 / embedding）
- [x] 用户没配 window-ai Provider 时，preferLocal 静默不生效（不影响现有云端配置）
- [x] window.ai 不可用时 footer 显示 ⚠ 徽标提示（路由仍走云端）

---

## ✅ 6. 阶段三：V2.0 个人知识库（3-4 周）

### ✅ 任务 6.1 网页内容抓取

**优先级**：P0  ·  **工期**：5-7 天  ·  **依赖**：4.1

#### 用户故事
> 我希望 Curio 能后台为我收藏过的网页保存正文摘要，
> 这样我能问 "上周看的 React 文章里谁推荐了 useReducer？"

#### 验收标准
- [x] manifest 增加 `host_permissions: ['<all_urls>']`，**首次使用前显示隐私说明**
- [x] 浮窗「⚙ 设置」Tab 加「内容抓取」section：
  - 范围选择（仅未抓取 / 重试失败 / 全部 / 按某顶层分类）
  - 抓取队列进度（done/total + 当前抓取中的标题）
- [x] 抓取流程：
  - 用 `fetch` + `credentials: 'omit'` 拉 HTML（不带登录态）
  - 用 `@mozilla/readability` 提取正文
  - 截断到前 8000 字符
  - 写入 IndexedDB `pageContents` table（独立 dexie db）
- [x] 抓取失败的卡写 status='failed' + error；下次「重试上次失败的」可重抓
- [x] 已索引的卡片在网格上显示 📄 角标（hover 实化），由 usePageIndex store 广播

#### 技术要点
- 浏览器扩展可绕过 CORS：用 `host_permissions` + `fetch`
- 失败处理：HTTP 4xx/5xx / content-type 非 HTML / 30s 超时 / Readability 解析失败 都进入 failed
- 增量：基于 status='ok' 集合自动跳过已索引（除非显式选 'all' 模式覆盖）
- 隐私 alert：CrawlPrivacyDialog 显式说明「将下载 N 个网页内容到本机 IndexedDB」
- 并发：3 个 worker pool 并行（默认）；超过 5 易被站点限流
- AISettings 加 `crawl: { agreed, agreedAt }`：用户同意 → 后续不再弹；可随时撤回

#### Checklist
- [x] manifest host_permissions 调整 + 升级提示
- [x] Readability.js 集成（`@mozilla/readability` 0.6.0）
- [x] crawler service（带并发 worker pool + 单条 abortController + 立即落库）
- [x] pageContents IndexedDB table（独立 dexie db `curio-pages`）
- [x] 抓取进度页（SettingsTab > 内容抓取 section）
- [x] 卡片角标显示索引状态（usePageIndex store + 📄 角标）

---

### ✅ 任务 6.2 RAG 问答（对话 Tab）

**优先级**：P0  ·  **工期**：5-7 天  ·  **依赖**：5.1 + 6.1

#### 用户故事
> 我希望在浮窗「💬 对话」Tab 用自然语言提问，
> AI 基于我已收藏的网页内容回答，并附上参考链接。

#### 验收标准
- [x] 浮窗「💬 对话」Tab 提供完整聊天界面（v0.9 已实现，本次接通 RAG）：
  - [x] 上方：对话历史流（user / assistant 消息气泡）
  - [x] 下方：输入框 + 发送按钮
  - [x] 引用书签列表：紧贴每条 assistant 消息下方（不放底部，避免历史回看时找不到对应来源）
- [x] 多对话支持（v0.9 panel store 已实现 tab 维度独立 state）
  - [x] Tab 标题自动从首条提问生成
- [x] 每次问答流程：
  1. [x] 提问通过 embedding 检索 top K（默认 8 篇文档；minScore=0.25 过滤噪音）
  2. [x] 检索范围：card-level（升级了 §5.1 buildContent，把已抓取正文拼进 embedding 输入）
  3. [x] 文档片段作为 system prompt 拼接（每篇截断 1500 字符；topK=8 → ~12k 字符 ≈ 6k tokens）
  4. [x] 流式输出答案
  5. [x] 答案中要求模型用 [1] [2] 引用；底部 ReferencesList 渲染同序号
- [x] 多轮对话支持（user → assistant 历史完整传给模型，仅替换 system 为 RAG context）
- [x] 「清空对话」「导出为 markdown」按钮（含 retrieved 引用脚注）
- [x] 顶部 RAG 开关：未抓取时 disabled；开启后输入 placeholder 提示"基于本地索引提问"

#### 技术要点
- 不做 chunk 切分：复用 §5.1 card-level embedding，单文档作为最小检索单元
  → 避免新建 chunks 表；对 8000 字以下的 page 召回质量已够用；后续若需要 chunk-level 再升级
- 检索：余弦 top K + minScore 阈值过滤；不做 LLM rerank（"可选"项；保持简单）
- prompt 模板：retriever.buildRagSystemPrompt（含约束：必须引用、不复述、片段无关时明确说"未找到"）
- 流式：复用现有 chatStream（SSE 解析）
- 召回失败兜底：retrieveContext 返回空时仍回答，但 system prompt 引导模型说明"本回答不来自您的收藏"

#### Checklist
- [x] ~~chunk 切分函数~~（用 card-level embedding 替代，更简洁）
- [x] retrieve service（`retrieveContext`，embedding + 余弦 + 拉 PageContent）
- [x] ~~rerank service~~（先用简单 top-K，文档说"可选"）
- [x] chat prompt 模板（`buildRagSystemPrompt`）
- [x] ChatTab 组件升级（RAG 开关 + 引用列表 + 导出 + 引导文案）
- [x] 流式渲染（沿用 v0.9 + 中止能保留已生成片段）
- [x] 对话持久化（沿用 panel store tab.state；StoredMessage 加 retrieved 字段）
- [x] 多对话 Tab 管理（v0.9 已实现）

---

### ✅ 任务 6.3 AI 自动备注

**优先级**：P2  ·  **工期**：2-3 天  ·  **依赖**：6.1

- [x] 基于已抓取正文（§6.1），AI 为每张卡生成 1 句话摘要（≤ 25 字）
- [x] 写入 `card.description`（不覆盖用户已写的；只处理 description 为空的卡）
- [x] 浮窗「⚙ 设置」Tab → 「AI 自动备注」section + autoSummarize 开关
- [x] 联动设计取舍：autoSummarize=true 时，crawler 完成后弹 toast 提示「N 条可生成」
  + action 按钮跳到 SummarySection，**不直接静默调 LLM** —— 让用户保留最终决策权，
  避免无声消耗 token（与 §6.1 隐私同意红线一致）

---

### ✅ 任务 6.4 重复 / 失效检测

**优先级**：P1  ·  **工期**：3-4 天  ·  **依赖**：4.2

- [x] ⚙ 设置加「整理质检」section（独立流程；不放在 OrganizeTab 是因为
  OrganizeTab 已有 6 阶段状态机，再叠加完全不同的 plan 类型 UX 会过载；
  ⚙ 设置已是"管理类工具中心"——Embedding / Crawl / Summary 都在这里）
- [x] 重复判定：
  · URL 完全一致 → exact_url 组
  · URL 不同但 embedding cosine ≥ 0.9 → similar_content 组（用 union-find 簇化）
  · similar_content 仅对已生成 embedding 的卡片生效；未 embed 的不参与
- [x] 失效检测：HEAD 请求 + GET 兜底（部分服务器不响应 HEAD）；
  4xx/5xx / 网络错 / 15s 超时都进入 failed；并发 5 + 用户可中止
- [x] 三色分组渲染：🔴 失效 · 🟡 疑似重复 · 🔵 长期未访问 (≥ 6 月)
- [x] 「批量删除」「批量归档到指定分类」操作（用户在下拉中选目标分类）
- [x] 重复组内默认提示"保留第一个"，其余建议处理（用户仍可自由勾选）

---

## 7. 阶段四：V3.0 生态扩展（2-3 周）

### 任务 7.1 本地 HTTP API

**优先级**：P0  ·  **工期**：5-7 天  ·  **依赖**：所有 V1 能力

#### 用户故事
> 我希望在 Cursor / Raycast / Alfred 里直接搜我的 Curio 书签

#### 技术方案
- 浏览器扩展不能直接开 HTTP server
- 方案 A：Native Messaging 桥（一个 cli 应用作为代理）
- 方案 B：用 Service Worker + WebSocket（仅限同浏览器）

倾向方案 A，更标准。

#### API 端点
```
GET  /v1/categories              列出所有分类
GET  /v1/bookmarks?q=xxx&tag=xxx 搜索（支持语义）
GET  /v1/bookmarks/:id           单个详情
POST /v1/bookmarks               新增
GET  /v1/chat?q=xxx              RAG 问答（SSE 流式）
```

#### Checklist
- [ ] 设计 Native Messaging 协议
- [ ] cli 桥应用（Rust / Node 都行，倾向 Rust 体积小）
- [ ] HTTP server（仅 localhost，加 token 鉴权）
- [ ] Cursor / Raycast 接入示例

---

### 任务 7.2 MCP Server 桥接

**优先级**：P2  ·  **工期**：5 天  ·  **依赖**：7.1

- [ ] 在 7.1 桥应用里加 MCP stdio 协议支持
- [ ] 暴露工具：`search_bookmarks` / `get_content` / `add_bookmark` / `list_categories`
- [ ] 适配 Claude Desktop / Cline / Continue 客户端

---

### ✅ 任务 7.3 多浮窗支持

**优先级**：P1  ·  **工期**：3-4 天  ·  **依赖**：4.0

> V1 是「一个浮窗 + 内部多 Tab」；V3 升级为「**可以同时开多个浮窗**」

- [x] AIPanelTabs 加「⤴ 分离」按钮（hover 出现，仅未分离时显示）
- [x] z-index 自动管理：focusPanel(panelId) bump 到 zCounter+1，焦点浮窗自动置顶
- [x] 多浮窗位置 / 尺寸独立持久化（独立 storage key `curio:ai-secondary-panels`，
  debounce 200ms）
- [x] 已分离 tab 在主 tab bar 上显示 ⤴ 标记 + tooltip"已在副浮窗显示"，
  作为"任务栏"作用 —— 不另设全局任务栏，避免视觉冗余

#### 设计取舍：副浮窗 = 一窗一 tab + 共享主 store 数据

实施方案不是"完全独立的多浮窗"（那要重写 panelStore 为 multi-instance + 改所有 selector），
而是更轻的"分离视图"模型：

- **数据 ownership**：副浮窗只是另一个"渲染窗口"，tab.state（messages 等）
  仍在主 useAIPanelStore；主副浮窗看的是同一份数据，编辑实时同步
- **一窗一 tab**：副浮窗没有 tab bar / 「+ 新建」；想开多个 → 分别从主浮窗分离
- **没有最大化**：多个副浮窗都最大化会互相遮挡，意义不大
- **关闭副浮窗 ≠ 删除 tab**：副浮窗 ✕ 只关闭分离视图；想完全删 tab 用主浮窗的 tab ✕
- **主浮窗 closeTab 时**：SecondaryPanelsHost useEffect 自动清理对应副浮窗
- **复用主浮窗基础设施**：useDraggable / useResizable / 4 个 TabContent 组件
  全部复用，不复制代码
- **视觉区分**：副浮窗 header 用 fuchsia 色调 + 「副」徽标

---

### ✅ 任务 7.4 相关阅读推荐

**优先级**：P1  ·  **工期**：2-3 天  ·  **依赖**：5.1

- [x] BookmarkCardItem 卡片菜单加「✨ 相关阅读」项 → 弹 RelatedReadingDialog
  （没有现成的"详情态"概念；用菜单触发 + portal 弹层比新增"详情态"更轻）
- [x] 基于 embedding 余弦相似度从全库找 top 3（默认 minScore=0.4，比 RAG 严）
- [x] 纯本地 cosine，不调任何 LLM / 外部服务（findSimilarCards in embedder.ts）
- [x] 三态 UI：loading / 目标卡未 embed → 引导去 ⚙ 生成 / 无候选 → 引导补全
- [x] 推荐项点击直接打开 url + 记录"最近使用"，关闭弹层

---

## 8. 关键技术架构详解

### 8.1 Provider 抽象层

```ts
// src/ai/types.ts
export interface AIProvider {
  id: string                          // 用户给的别名，如 "我的 DeepSeek"
  type: 'openai-compatible' | 'window-ai' | 'ollama'

  chat(opts: ChatOptions): Promise<ChatResponse>
  chatStream(opts: ChatOptions): AsyncIterable<ChatChunk>
  embedding?(input: string[]): Promise<number[][]>

  testConnection(): Promise<{ ok: boolean; message?: string }>
}

export interface ChatOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
  jsonSchema?: object
}
```

### 8.2 浮窗状态模型

```ts
// src/ai/panel/usePanelStore.ts
export interface AIPanelTab {
  id: string
  type: 'chat' | 'organize' | 'labels' | 'settings'
  title: string
  /** Tab 自有 state，关闭浮窗 / 切换 tab 不丢失（持久化到 storage） */
  state: any
  createdAt: number
}

export interface AIPanelState {
  visible: boolean
  minimized: boolean
  maximized: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  activeTabId: string | null
  tabs: AIPanelTab[]

  open: (tabType?: AIPanelTab['type']) => void
  close: () => void
  toggleMinimize: () => void
  toggleMaximize: () => void
  setPosition: (p: Position) => void
  setSize: (s: Size) => void
  addTab: (tab: AIPanelTab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
}
```

### 8.3 数据模型扩展

```ts
// src/types/ai.ts (新增)
export interface AISettings {
  enabled: boolean
  providers: AIProviderConfig[]
  routing: {
    chat: string       // provider id
    organize: string
    embedding: string
  }
  privacy: {
    anonymousMode: boolean      // domain only
    allowContentCrawl: boolean  // V2 用
    showCostEstimate: boolean
  }
  preferLocal: boolean   // window.ai 优先
  panel: {
    /** 持久化的浮窗位置 + 尺寸 */
    position?: { x: number; y: number }
    size?: { width: number; height: number }
  }
}

export interface AIProviderConfig {
  id: string
  name: string
  type: 'openai-compatible' | 'window-ai' | 'ollama'
  baseURL?: string
  apiKey?: string  // 不进 export json
  model: string
  embeddingModel?: string
  isDefault: boolean
}

export interface OrganizePlan {
  id: string
  createdAt: number
  source: { type: 'all' | 'category', id?: string }
  newCategories: Array<{ tempId: string; name: string; icon?: string }>
  bookmarkAssignments: Array<{ bookmarkId: string; targetTempId?: string; targetCategoryId?: string }>
  deletions: string[]
  meta: { provider: string; tokens: number; cost: number }
}
```

### 8.4 隐私与匿名化

```ts
// src/ai/privacy.ts
export function anonymizeBookmark(card: BookmarkCard, mode: 'full' | 'domain' | 'hash'): object {
  switch (mode) {
    case 'full':   return { id: card.id, title: card.title, url: card.url }
    case 'domain': return { id: card.id, title: card.title, domain: new URL(card.url).hostname }
    case 'hash':   return { id: card.id, title: card.title, urlHash: sha256(card.url).slice(0,12) }
  }
}
```

### 8.5 成本控制

```ts
// src/ai/usage-tracker.ts
export const usageTracker = {
  estimate(messages: ChatMessage[]): { tokens: number; cost: number } {
    // 简单估算：1 token ≈ 0.75 个字符（中文）/ 4 个字符（英文）
    // 价格表硬编码常见模型
  },
  record(provider: string, model: string, usage: { promptTokens; completionTokens }): void {
    // 写入 IndexedDB usage 表，支持按月查询
  },
}
```

### 8.6 用户必看的成本提示

```
┌──────────────────────────────────────────┐
│ 即将操作：AI 整理 873 个书签              │
│                                            │
│ 发送数据：标题 + 域名（域名匿名化已开）   │
│ 估算 tokens：12,400 prompt + 3,000 output │
│ 估算成本：¥0.05 (DeepSeek)                │
│                                            │
│ 本月已用：¥0.32 / 累计 47 次操作         │
│                                            │
│  [ 取消 ]    [ 确认执行 ]                 │
└──────────────────────────────────────────┘
```

---

## 9. UX/视觉设计原则

### 9.0 整体交互范式：可拖动浮窗 + 多 Tab 多任务

**核心设计**：所有 AI 交互**收敛到同一个浮窗内**，主区永远不被打扰。

```
┌───────────────────────────────────────────────┐
│  Curio 主区（不被任何 AI UI 遮挡或挤压）      │
│                                                │
│  ┌─────────────┬───────────────────────┐      │
│  │             │                       │      │
│  │  侧栏       │  最近使用 / 卡片网格   │      │
│  │             │                       │      │
│  │             │              ╔══════════╗   │
│  │             │              ║ ⠿ ✨ AI  ║ ← 可自由拖动
│  │             │              ╠══════════╣   │
│  │             │              ║[💬][🗂][⚙]║ ← 多 Tab 切换
│  │             │              ╠══════════╣   │
│  │             │              ║          ║   │
│  │             │              ║ 内容区   ║   │
│  │             │              ║          ║   │
│  │             │              ║          ║   │
│  │             │              ║[输入框]  ║   │
│  │             │              ╚══════════╝   │
│  │             │                              │
│  │             │                       ┌──┐   │
│  └─────────────┴───────────────────────┤✨│ ← FAB
│                                        └──┘   │
└───────────────────────────────────────────────┘
```

**三种状态**：

| 状态 | 形态 | FAB |
|------|------|-----|
| 关闭 | 无 | 显示 |
| 默认 | 浮窗在用户上次位置（380×520） | 隐藏 |
| 最小化 | 右下角小 chip `[ ✨ AI 助手 ▴ ]` | 隐藏 |
| 最大化 | 居中 70vw × 80vh + 半透明遮罩 | 隐藏 |

**多任务**：浮窗内通过 Tab 并存，例如：
```
[💬 对话1] [💬 对话2] [🗂 整理-进行中] [🏷 自动打标签-已完成] [⚙][+]
```
- 关闭浮窗 / 切换 Tab 不丢失任务进度
- V3 升级为「分离 Tab 成独立浮窗」（多浮窗并存）

### 9.1 入口设计

| 入口位置 | 触发 |
|---------|------|
| **右下角 ✨ FAB** | 主入口；点击打开浮窗；状态联动「是否已配置 AI」 |
| **`Cmd/Ctrl+J` 快捷键** | 全局唤起 / 隐藏浮窗（与 Notion AI 对齐） |
| **浮窗最小化 chip** | 浮窗最小化时点击恢复 |
| **搜索框 chip `✨ AI`** | 语义搜索（不走浮窗，主区原地切搜索结果） |
| **搜索框 chip `# tag`** | 标签搜索 |
| **popup「添加当前页面」** | ✨ 建议分类按钮（popup 自成体系，不接入浮窗） |
| **BookmarkCardItem 详情** | 「相关阅读」+ 「✨ 总结」（V2，原地展开，不走浮窗） |

> **不再使用**：原顶部 ✨ 下拉菜单（已废弃，统一到 FAB + Floating Panel）；
> 齿轮菜单也**不再有「AI 设置」入口**（移到浮窗内 ⚙ Tab）。

### 9.2 颜色与图标

| 场景 | 视觉 |
|------|------|
| FAB 未配置 | 灰色 |
| FAB 已配置 | brand 色 + ✨ 图标 |
| FAB AI 处理中 | 呼吸光晕动画 |
| FAB 有被动建议 | 右上小红点 |
| 浮窗 header | 与卡片同款轻盈背景，dragging 时光标变 grabbing |
| 浮窗最大化遮罩 | bg-black/30 |
| AI 建议（待确认） | 紫色高亮（区别于普通新增的绿色） |
| AI 出错 | 红色 toast + 「重试」「换 Provider」按钮 |
| 本地 AI 标识 | 浮窗 footer 绿色 ✓ Local 徽标 |
| 远程 AI 标识 | 浮窗 footer ☁ Cloud 徽标 |

---

## 10. 红线与避坑清单

| ❌ 禁止做的 | ✅ 必须做的 |
|----|----|
| 默认开启任何 AI 功能 | 所有 AI 默认关闭，opt-in |
| 把完整 URL 路径上传 | 默认匿名（domain only） |
| API key 进 storage.sync 或 export json | 仅本地 storage.local，永不出包 |
| 静默扣费 | 每次操作前显示估算成本 |
| AI 直接写库不可撤销 | 强制 IndexedDB snapshot + 60s 撤销窗 |
| 用 token 做"打字机"特效 | 流式必有「停止」按钮 |
| 让 AI 决定删用户分类 | 删除一律先标 deletion，需用户勾 ✓ 才落库 |
| 网页爬虫默认开 | manifest 升级时强制弹隐私说明 |
| 发送给 AI 时丢失上下文 | 单 prompt 控制在 8K tokens 以内，分批 |
| **浮窗失焦自动关闭**（与 modal 不同） | 浮窗持续存在，仅显式 × 才关闭 |
| **浮窗位置 / 尺寸丢失** | 必须持久化到 storage.local |
| **浮窗超出视口找不回来** | 边界保护：至少 100px 在视口内；resize 时自动吸附 |
| **浮窗与 Toast / CardMenu 抢 z-index** | 用统一 z-index 体系（10000-10200） |
| **关闭浮窗丢失任务进度** | Tab 内 state 持久化，下次打开恢复到对应阶段 |

---

## 11. 进度追踪 Checklist

### ✅ 阶段 V1.0
- [x] 4.0 浮窗壳子（FAB + Floating Panel + Tab）⭐ 前置
- [x] 4.1 第三方 API 入口（设置 Tab）
- [x] 4.2 AI 整理书签助手（整理 Tab）
- [x] 4.3 AI 添加书签辅助（popup）
- [x] 4.4 自动打标签 + Tag 系统（标签 Tab）

### ✅ 阶段 V1.5
- [x] 5.1 语义搜索
- [x] 5.2 被动整理建议
- [x] 5.3 window.ai 优先

### ✅ 阶段 V2.0
- [x] 6.1 网页内容抓取
- [x] 6.2 RAG 问答（对话 Tab）
- [x] 6.3 AI 自动备注
- [x] 6.4 重复 / 失效检测

### 阶段 V3.0
- [ ] 7.1 本地 HTTP API
- [ ] 7.2 MCP Server 桥接
- [x] 7.3 多浮窗支持
- [x] 7.4 相关阅读推荐

---

## 附录 A：Prompt 模板

### A.1 AI 整理书签

```
[SYSTEM]
你是一个浏览器书签整理助手。用户会发给你一组书签（title + domain），
你需要按内容主题为它们提议新的分类结构。

约束：
1. 输出必须是合法 JSON，符合给定 Schema
2. 新分类名简洁（≤6 字），优先复用已有分类
3. 单个分类至少 3 条；少于 3 条的归到「杂项」
4. 保持 bookmark id 不变
5. 不要发明新的书签，只能重新组织提供的书签
6. 整理风格：{userPreference}

返回 JSON Schema：
{
  "newCategories": [
    { "tempId": "tmp_1", "name": "前端开发", "icon": "💻", "rationale": "包含 React/Vue/Webpack 相关学习与文档" }
  ],
  "assignments": [
    { "bookmarkId": "bk_xxx", "targetTempId": "tmp_1" }
  ],
  "deletions": ["category_id_to_remove_if_empty"]
}

[USER]
现有分类（供参考，可复用其名）：
{existingCategories}

待整理书签（共 N 条）：
{bookmarkList}
```

### A.2 RAG 问答

```
[SYSTEM]
你是用户的私人书签知识库助手。回答用户问题时，必须基于以下提供的内容片段，
并在答案中以 [1] [2] 等标号引用对应的来源。

来源片段：
{chunks}

约束：
1. 如果片段中没有相关信息，明确说"我的书签库里没找到相关内容"
2. 引用必须准确（标号对应片段顺序）
3. 简洁回答，避免冗余

[USER]
{question}
```

### A.3 单条标签生成

```
[SYSTEM]
为这个书签生成 3-5 个简短的中文标签（每个 ≤4 字）。
返回 JSON：{ "tags": ["...", "..."] }

约束：
- 标签是「主题分类」性质（如「前端」「设计」「工具」），不要描述（如「实用」「有趣」）
- 优先复用已有标签

已有标签库：{existingTags}

[USER]
书签：{title} - {domain}
```

---

## 附录 B：参考资料

- [Chrome 内置 AI: window.ai](https://developer.chrome.com/docs/ai/built-in)
- [OpenAI API 兼容协议](https://platform.openai.com/docs/api-reference/chat)
- [DeepSeek 定价](https://platform.deepseek.com/pricing)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [MCP Spec](https://modelcontextprotocol.io)

### 浮窗交互参考
- [Notion AI](https://www.notion.so/product/ai) — Cmd+J 浮窗
- [Linear Cmd+K](https://linear.app/) — 居中可拖浮窗
- [Cursor Inline Edit](https://cursor.sh/) — 编辑器上的浮层
- [Slack 浮动通话窗](https://slack.com/) — 经典可拖 + 最小化为角标

---

## 附录 C：版本历史

| 日期 | 修改 |
|------|------|
| 2026-05-14 | 初版，规划 V1.0 - V3.0 完整路线（顶部下拉 + 弹窗范式） |
| 2026-05-14 | **重大调整**：交互范式改为「FAB + 可拖动浮窗 + 内部多 Tab」；新增 §4.0 浮窗壳子任务作为所有 AI 功能的前置依赖；§9 视觉设计原则全面重写；§10 红线增加 5 条浮窗专属约束 |
