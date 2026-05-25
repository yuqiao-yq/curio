# Tab It - 架构与技术方案

> 一款替代浏览器新标签页（New Tab）的书签整理工具，支持 Chrome / Edge / Firefox / Brave / Opera 等主流浏览器。

---

## 1. 产品定位

- **核心场景**：用户打开新标签页时，看到的不是默认页面，而是自己整理好的、分类清晰的书签卡片墙。
- **核心价值**：
  1. 替代凌乱的浏览器原生书签栏
  2. 把书签按"个人项目 / 工作 / 学习 / 娱乐"等维度可视化分类
  3. 数据可在不同设备、不同浏览器之间互通
- **目标用户**：信息工作者、研究者、需要管理大量在线资源的人。

---

## 2. 技术栈选型

| 层 | 技术 | 选型理由 |
|---|---|---|
| 扩展规范 | **Manifest V3 + WebExtension API** | Chrome / Edge 强制 MV3，Firefox 已兼容，可一套代码多浏览器 |
| 脚手架 | **WXT** | 跨浏览器、自动生成 manifest、内置 HMR、零配置 |
| 框架 | **React 18 + TypeScript** | 生态最全，组件库丰富，类型安全 |
| 构建 | **Vite**（WXT 内置） | 快、HMR 体验好 |
| 样式 | **TailwindCSS** | 快速搭页面、产物体积小 |
| 状态管理 | **Zustand** | 轻量、API 直观，适合中小型应用 |
| 拖拽 | **@dnd-kit** | 比 react-dnd 更现代、a11y 友好 |
| 本地存储 | **chrome.storage.local + Dexie (IndexedDB)** | storage 存元数据，IndexedDB 存大数据（缩略图等） |
| 浏览器 API | **chrome.bookmarks / chrome.storage / favicon** | 原生书签读取与图标获取 |
| 同浏览器多设备同步（V1.5 已交付） | **chrome.storage.sync** | 同一浏览器账号下零成本同步偏好 + 全部书签（manifest + 分块） |
| 跨浏览器同步（V2 规划） | **Google Drive (appdata) + Supabase 双轨** | 突破 100KB 配额；免费用户走 Drive，Pro 走 Supabase 实时同步 |
| 跨浏览器兼容 | **webextension-polyfill** | 抹平 chrome.* 与 browser.* 差异 |

---

## 3. 整体架构

```
┌──────────────────────────────────────────────────┐
│         New Tab Page (entrypoints/newtab/)       │
│  ┌─────────────────────────────────────────┐     │
│  │   React App                             │     │
│  │   - 分类侧栏 / 卡片网格 / 拖拽          │     │
│  │   - 搜索 / 设置 / 主题                  │     │
│  └────────────────┬────────────────────────┘     │
│                   │                              │
│  ┌────────────────▼────────────────────────┐     │
│  │   Zustand Store（视图状态）             │     │
│  └────────────────┬────────────────────────┘     │
│                   │                              │
│  ┌────────────────▼────────────────────────┐     │
│  │   Repository 抽象层（统一数据 IO）       │     │
│  │   ┌────────┬─────────┬─────────────┐    │     │
│  │   │ Local  │ Browser │ Cloud(V2)   │    │     │
│  │   │Storage │Bookmarks│Drive/Supabase│   │     │
│  │   └────────┴─────────┴─────────────┘    │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
            ▲
            │ chrome.* API
┌───────────┴──────────────────────────────────────┐
│   Background Service Worker                      │
│   - 监听 chrome.bookmarks 变化                   │
│   - 处理同步定时任务（V2）                        │
└──────────────────────────────────────────────────┘
```

### 关键模块

| 模块 | 路径 | 职责 |
|------|------|------|
| New Tab 页 | `entrypoints/newtab/` | 主界面，React 应用 |
| Background | `entrypoints/background.ts` | Service Worker，监听书签变化 |
| Popup（可选） | `entrypoints/popup/` | 点扩展图标的快捷面板 |
| Options（可选） | `entrypoints/options/` | 完整设置页 |
| 数据层 | `src/repositories/` | Repository 模式，封装本地存储（chrome.storage.local + Dexie） |
| 同步层 | `src/services/SyncService.ts` | V1.5 跨设备同步：偏好白名单 + 书签 manifest/分块，整包 LWW |
| 业务层 | `src/services/` | 搜索、导入导出、网页抓取（AI）、整理质检 等 |
| UI 层 | `src/components/` | 通用组件 |
| 状态 | `src/stores/` | Zustand stores |

---

## 4. 数据模型

> 设计原则：**视图层（自定义分类与卡片）与浏览器原生书签解耦**，避免在其他设备改了书签后破坏 DIY 布局。

```ts
// 自定义分类（独立于浏览器书签的虚拟分组）
interface Category {
  id: string                // uuid
  name: string
  icon?: string             // emoji 或图标名
  color?: string            // hex 色值
  order: number             // 排序
  createdAt: number
  updatedAt: number
}

// 卡片（一个书签的展示形态）
interface BookmarkCard {
  id: string                // uuid
  categoryId: string        // 所属分类
  title: string
  url: string
  icon?: string             // 用户自定义图标（默认用 favicon）
  thumbnail?: string        // 用户自定义缩略图（base64 或 URL）
  description?: string
  tags?: string[]
  order: number
  bookmarkId?: string       // 关联的浏览器原生书签 id（可选）
  createdAt: number
  updatedAt: number
}

// 用户设置
interface UserSettings {
  theme: 'light' | 'dark' | 'auto'
  layout: 'grid' | 'list'
  cardSize: 'sm' | 'md' | 'lg'
  wallpaper?: string
  language: 'zh-CN' | 'en'
  syncProvider?: 'local' | 'drive' | 'supabase'
}
```

### 同步预留字段
所有同步实体都带：
- `id`：全局唯一（uuid v4）
- `updatedAt`：最后更新时间戳，冲突合并用
- `deletedAt?`：软删除（同步时需要 tombstone）

---

## 5. 存储抽象层（Repository 模式）

为了在未来无痛切换/混用本地、Drive、Supabase，业务层只依赖统一接口：

```ts
interface BookmarkRepository {
  // 分类
  getCategories(): Promise<Category[]>
  saveCategory(cat: Category): Promise<void>
  deleteCategory(id: string): Promise<void>

  // 卡片
  getCards(categoryId?: string): Promise<BookmarkCard[]>
  saveCard(card: BookmarkCard): Promise<void>
  deleteCard(id: string): Promise<void>

  // 批量
  bulkImport(data: ExportData): Promise<void>
  bulkExport(): Promise<ExportData>

  // 同步（V2 实现）
  sync?(): Promise<SyncResult>
}
```

**实现类：**
- `LocalRepository`：基于 chrome.storage.local + Dexie（V1，已交付）
- `DriveRepository`：基于 Google Drive appdata（V2，规划中）
- `SupabaseRepository`：基于 Supabase（V2，规划中）

业务层通过依赖注入获取 Repository，**切换实现不影响 UI**。

> **V1.5 同步层与 Repository 的关系**：V1.5 跨设备同步走的是独立的
> `SyncService`（见 §6），它把本地 Repository 当作真相源，定时把白名单字段 / 整包书签
> 序列化推到 `chrome.storage.sync`；远端变更触发时再通过
> `applyRemoteSettings` / `applyRemoteBookmarks` 回灌到本地 Repository。
> Repository 接口本身没新增方法 —— 这是个旁路设计，避免给 V2 真正的云端
> Repository 方案污染抽象层。

---

## 6. 同步策略

### V1（MVP）：本地 + 导入导出（已交付）
- 数据全部存 `chrome.storage.local` + Dexie（缩略图等大对象）
- 提供 JSON 导入导出，作为跨浏览器迁移的兜底方案

### V1.5：同浏览器多设备自动同步（已交付）

> 适用场景：同一 Chrome / Edge 账号、或 Firefox Sync 开启的多台设备之间。
> 不解决跨浏览器问题（Chrome ↔ Firefox 没有共享存储），那留给 V2。

**两条独立管线，都跑在 `chrome.storage.sync` 上：**

1. **偏好管线**（`KEY_SETTINGS_PAYLOAD`，1 个 item，< 1KB）
   - 白名单字段（`SYNCABLE_SETTINGS_KEYS`）：`theme / layout / language / cardSize /
     cardIconSize / cardGlass / fontColor / backgroundBlur /
     subSectionDefaultExpanded / recentIncludeBrowserHistory`
   - **黑名单**：壁纸（可超配额）、侧栏宽度（设备相关）、`browserSync*`（本机偏好）、
     **AI 设置含 apiKey（隐私红线）**
2. **书签管线**（`KEY_BM_MANIFEST` + N 个 `KEY_BM_CHUNK_PREFIX{i}`）
   - 整包 categories + cards 序列化后按 8KB 切片，分块写入 +
     一份 manifest 描述总块数 / 字节数 / `updatedAt`
   - 所有块和 manifest 在**同一次 `storage.sync.set`** 里原子提交
   - 推送时若新版本块数少于旧版，会清理多余的 stale chunks

**关键不变量：**
- **配额 100KB 硬上限**：客户端预检 + UI 容量进度条（>75% 黄 / >100% 红），超额 push
  直接拒写并把 `quotaHint` 冒泡到 `meta.lastError`
- **整包 LWW 冲突策略**：两端同时改 → 后写者覆盖先写者。已在 UI 文案明示
  "整包覆盖意味着本机近期未推送上去的书签会丢失"
- **自回声防抖**：每条管线独立维护 `lastPushTs`，`storage.onChanged` 触发时
  比对 `remoteUpdatedAt <= lastPushTs` 直接跳过，避免推完又被自己的 echo 拉回来
- **推送 debounce**：偏好 800ms / 书签 1500ms，叠加 `beforeunload` /
  `visibilitychange` 强制 flush
- **拉取前取消挂起的 push**：`pullBookmarksForce` / `pullSettingsForce` 调用前
  必须先 `cancelPendingSyncPush`，否则正在挂起的本地新值会抢先飞上云端把"覆盖"做空

**Meta 数据结构**（存 `chrome.storage.local`，本机视角）：
```ts
interface SyncMeta {
  enabled: boolean
  settings: { lastPushTs?, lastPullTs?, lastSizeBytes? }
  bookmarks: { lastPushTs?, lastPullTs?, lastSizeBytes? }
  lastError?: string   // 显示在 UI 红字
}
```

### V2：云端同步双轨（规划中）
| 套餐 | 存储 | 用户成本 | 我方成本 |
|------|------|---------|---------|
| Free | Google Drive (appdata) | 0 | 0 |
| Pro | Supabase | 订阅费 | 用 Pro 收入抵消 |

**好处：**
1. 免费用户走 Drive，**永远不花我们的钱**
2. 付费用户走 Supabase，**收入覆盖成本**
3. Repository 抽象，业务代码完全不感知底层差异

### 冲突解决演进
- V1.5：**整包 LWW**（一次写整个 categories+cards，后写覆盖先写）
- V2：升级到 **row-level LWW**（按 entity.updatedAt 合并，丢失面减小）
- V3+：CRDT（再考虑）

---

## 7. 权限申请

```json
{
  "permissions": [
    "bookmarks",       // 读写浏览器原生书签
    "storage",         // 本地存储
    "favicon"          // 获取网站 favicon (MV3)
  ],
  "optional_permissions": [
    "identity"         // 同步登录用（仅 Pro 启用）
  ],
  "host_permissions": [],
  "chrome_url_overrides": {
    "newtab": "newtab.html"
  }
}
```

> 原则：**最小权限**。能不要的权限不要，能做成 optional 的就 optional，提升上架审核通过率与用户信任度。

---

## 8. 隐私与合规

1. **隐私政策**：上架必备，明确告知数据流向
2. **本地优先**：默认数据不离开本机
3. **云同步可选**：用户主动开启，明确知情
4. **端到端加密**（V2 Pro）：用户密码派生密钥，服务器只存密文
5. **GDPR**：提供数据导出与一键清除

---

## 9. 性能考量

- 卡片虚拟滚动（卡片 > 200 时启用 `react-virtuoso`）
- favicon 本地缓存（避免每次重新请求）
- 拖拽用 CSS transform，避免触发布局
- 启动时间目标：**< 100ms 首屏**

---

## 10. 测试策略

- 单元测试：Vitest（Repository、纯函数）
- 组件测试：Testing Library
- E2E：Playwright（加载扩展并模拟用户操作）
- 多浏览器矩阵：Chrome / Edge / Firefox 各跑一遍

---

## 11. 发布渠道

| 平台 | 费用 | 审核周期 |
|------|------|---------|
| Chrome Web Store | $5（一次性） | 1-3 天 |
| Microsoft Edge Add-ons | 免费 | 1-7 天 |
| Firefox Add-ons (AMO) | 免费 | 自动审核，敏感权限需人工 |
| Opera / Brave | 免费 | 直接装 Chrome 商店即可 |

---

## 12. 目录结构

```
tab-it/
├── docs/                    # 设计文档
├── entrypoints/             # WXT 入口
│   ├── newtab/              # 新标签页（主界面）
│   ├── background.ts        # Service Worker
│   ├── popup/               # 扩展图标弹出（可选）
│   └── options/             # 设置页（可选）
├── src/
│   ├── components/          # UI 组件
│   ├── stores/              # Zustand 状态
│   ├── repositories/        # 数据层（存储抽象）
│   ├── services/            # 业务逻辑
│   ├── types/               # 类型定义
│   ├── hooks/               # React hooks
│   ├── utils/               # 工具函数
│   └── styles/              # 全局样式
├── public/                  # 静态资源（图标等）
├── wxt.config.ts            # WXT 配置
├── tailwind.config.js
├── tsconfig.json
└── package.json
```
