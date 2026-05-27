# Curio - 开发路线图

> 本文档跟踪 Curio 的**整体产品规划**。AI 相关能力有独立计划文档
> [`AI_INTEGRATION_PLAN.md`](./AI_INTEGRATION_PLAN.md)（其中的"V1.0/V1.5/V2.0/V3.0"是 AI
> 子阶段编号，与本路线图的 V 编号是两套体系，互不冲突）。
>
> 当前实际进展见 [version history](#当前进度速览-202605)。
>
> **进度速记**：V1.0 ✅、V1.5 ✅、V2.0 未开始、V3.0/AI 12/14 已交付。
> v0.22.x 收尾批：首次进入引导（Spotlight + 渐进式）/ 拖入链接快速添加 /
> 浏览器书签自动同步 / 卡片标签编辑器 全部到位。

---

## ✅ V1.0 - MVP（本地版）

**目标**：可用的本地书签整理新标签页，覆盖 80% 个人使用场景。
**状态**：已交付 ✓

### 必做功能
- [x] 项目脚手架搭建（WXT + React + TS + Tailwind）
- [x] 接管浏览器 New Tab
- [x] 读取浏览器原生书签（chrome.bookmarks）
- [x] 自定义分类（创建、重命名、删除、排序、跨层级拖拽、多选批量）
- [x] 卡片网格展示（favicon + 标题）
- [x] 拖拽：卡片排序、跨分类移动（dnd-kit）
- [x] 添加 / 编辑 / 删除卡片（含就地编辑、备注、图标）
- [x] 搜索（标题 / URL 模糊匹配；按 URL 去重展示）
- [x] 数据持久化（chrome.storage.local + IndexedDB）
- [x] JSON 导入导出（含「合并 / 替换」二选一）
- [x] 浅色 / 深色 / 跟随系统 三套主题
- [x] 上架 Chrome Web Store 准备就绪（构建产物 `.output/chrome-mv3`）
- [ ] 中英文 i18n（暂为简体中文 only；用户基数稳定后再排）

### 加分功能
- [x] 自定义壁纸（6 个预设 + 调色盘渐变 + URL + 本地上传 2MB）
- [x] 自定义文字颜色（6 预设 + 调色盘 + Hex 文本框）
- [x] 浏览器工具栏 popup「添加当前页面」（v0.5+；v0.12+ 含 AI 建议 ✨）
- [x] 「最近使用」模块（含可选合并浏览器历史）
- [ ] 多布局切换（grid / list）
- [x] 卡片大小调节
- [x] 拖入链接快速添加（v0.22.x：从 tab / 桌面拖 link → 自动建书签，可指定 section 或落到当前分类）
- [x] Firefox 兼容（已用 wxt MV2 适配；尚未上 AMO）

---

## ✅ V1.5 - 同浏览器多设备同步（chrome.storage.sync）

**目标**：在同一浏览器账号（Chrome / Edge sign-in、Firefox Sync）下，
打开了浏览器同步的多台设备间自动同步偏好与全部书签数据。
**状态**：已交付 ✓

### 已实现
- [x] 同步开关 + 状态卡片（数据管理弹窗内）
- [x] 偏好同步（白名单：theme / layout / language / cardSize / cardIconSize / cardGlass / fontColor / backgroundBlur / subSectionDefaultExpanded / recentIncludeBrowserHistory）
- [x] 书签数据同步（分类 + 卡片整包）：manifest + N chunks 原子写入
- [x] 客户端配额预检 + 容量进度条（黄/红预警，超 100KB 拒写）
- [x] storage.onChanged 实时双向同步 + 自回声防抖（lastPushTs 守门）
- [x] 推 / 拉 / 整包覆盖 / 清空云端 四种手动操作
- [x] 整包 LWW 冲突策略 + 覆盖前 danger confirm 文案提示丢数据风险
- [x] Push debounce（偏好 800ms / 书签 1500ms）+ beforeunload/visibilitychange flush
- [x] 启动 bootstrap：两条管线独立 LWW 拉齐

### 范围限制（设计取舍，不算 bug）
- **不同步**：壁纸（体积可超配额）、侧栏宽度（与屏宽相关）、browserSync* 字段、AI 设置（含 apiKey，红线）
- **整包 LWW**：两端同时改时后写覆盖先写，未推送的本地修改会丢失（UI 已警示）
- **配额 100KB 硬上限**：书签量大的重度用户会撞墙 → 由 V2.0 接管

> 一种更轻量的"同步"始终保留：手动「导出 / 导入 JSON」（§3.3 / §3.4），
> 适合不想登录浏览器账号的用户。

---

## V2.0 - 跨浏览器云同步 / 突破 100KB 配额

**目标**：解决 V1.5 的两大限制：
1. 跨浏览器互通（Chrome ↔ Firefox 没有共享的 storage.sync）
2. 书签量超过 chrome.storage.sync 100KB 配额时的容灾出口
**状态**：未开始

### Free 套餐 - Google Drive
- [ ] OAuth 登录（chrome.identity / launchWebAuthFlow）
- [ ] DriveRepository 实现（复用 V1.5 已定义的 SyncProvider 接口）
- [ ] appdata folder 隐藏存储（无 100KB 限制）
- [ ] 增量同步 + 冲突合并（升级到 row-level LWW，按 entity.updatedAt）
- [ ] 离线编辑队列

### Pro 套餐 - Supabase
- [ ] Supabase 项目搭建
- [ ] 账号系统（邮箱 + Google + GitHub）
- [ ] 实时订阅（多端实时同步）
- [ ] 端到端加密（用户密码派生密钥）
- [ ] 订阅管理（Stripe）

### 通用
- [ ] 同步冲突 UI 提示（取代 V1.5 的"后写覆盖"）
- [ ] 同步历史与版本回滚
- [ ] V1.5 ↔ V2.0 迁移：超出 100KB 时自动引导用户切换到 Drive

---

## V3.0 - 协作与智能化

### ✅ AI 接入（独立专题）

**状态**：12/14 任务已交付（v0.8 → v0.20）。详见 [`AI_INTEGRATION_PLAN.md`](./AI_INTEGRATION_PLAN.md)。

| AI 阶段 | 关键能力 | 状态 |
|---|---|---|
| AI V1.0 (v0.8 ~ v0.12) | 浮窗壳子 / Provider 设置（18 预设）/ AI 整理（带 60s 撤销）/ AI 加书签 / 自动打标签 + Tag 系统 | ✅ |
| AI V1.5 (v0.13 ~ v0.14) | 语义搜索（embedding + IndexedDB + `@ai` 模式）/ 被动整理建议 / Chrome window.ai 优先 | ✅ |
| AI V2.0 (v0.15 ~ v0.18) | 网页正文抓取（Readability + 隐私同意）/ RAG 问答 / AI 自动备注 / 整理质检（含重复 / 失效 / 长期未访问） | ✅ |
| AI V3.0-7.3/7.4 (v0.19 ~ v0.20) | 相关阅读推荐（本地 cosine）/ 多浮窗（分离 tab 到独立浮窗） | ✅ |
| AI V3.0-7.1/7.2 | 本地 HTTP API（Native Messaging 桥）/ MCP Server 桥接 | ⬜ 待定（涉及独立 cli 工程 + 跨平台分发，留到 v1.0 站稳后再排） |

### 协作（未开始）
- [ ] 分享分类（生成可访问链接）
- [ ] 团队协作（多人编辑）

### 其他智能化
- [x] 智能去重（已在 AI §6.4「整理质检」交付：URL 一致 + embedding cosine ≥ 0.9 + 失效检测 + 长期未访问）
- [ ] 网页快照（保存收藏时刻的页面截图）
- [ ] 浏览数据洞察（最常打开、长时间未访问等；"长时间未访问"已在整理质检中提供）

---

## 非功能性目标

- [ ] 启动时间 < 100ms（当前未测量）
- [ ] 单元测试覆盖率 > 70%（当前 0 —— 主要靠 TS 类型 + 手动测试，0.x 阶段优先功能）
- [ ] 包体积 < 500KB（含 Readability 与 dexie 后预计偏大，需测量；非阻塞）
- [ ] Lighthouse 性能分 > 90

---

## 当前进度速览（2026-05）

```
v0.22.x  feat 首次进入引导（L1 5 步 Spotlight + L1.5 渐进式 + placeholder 轮换）
v0.22.x  feat 拖入链接快速添加（HTML5 drag + 与 dnd-kit 完全独立）
v0.22.x  feat 浏览器书签自动同步开关（scheduleBookmarksSyncPush 汇聚点 + 3s debounce）
v0.22.x  feat 卡片菜单加「编辑标签」入口（TagsEditorDialog + 常用 tags 推荐）
v0.21.x  feat V1.5 跨设备同步（settings + bookmarks 整包 LWW，chrome.storage.sync）
v0.21.x  refactor 大文件按职责拆分 + 卡片尺寸三档 + 背景毛玻璃 / 卡片毛玻璃开关 + AI 搜索网格 + 虚拟滚动
v0.20.0  feat §7.3 多浮窗（分离 tab 到独立可拖动浮窗）
v0.19.0  feat §7.4 相关阅读推荐
v0.18.0  feat §6.4 整理质检（重复 / 失效 / 长期未访问）
v0.17.0  feat §6.3 AI 自动备注
v0.16.0  feat §6.2 RAG 问答（对话 Tab 接通本地知识库）
v0.15.0  feat §6.1 网页内容抓取（Readability + IndexedDB + 隐私同意）
v0.14.0  feat §5.2 被动整理建议 + §5.3 window.ai 优先
v0.13.0  feat §5.1 语义搜索（embedding + IndexedDB + @ai 模式）
v0.12.0  feat §4.3 popup AI 建议
v0.11.0  feat §4.4 自动打标签 + Tag 系统
v0.10.0  feat 扩展 Provider 预设到 18 个 + 分组渲染
v0.9.0   feat 对话 Tab V1（多轮 + 流式 + 中止 + 持久化）
v0.8.0   feat §4.2 AI 整理书签助手（diff 预览 + 单条勾选 + 60s 撤销）
...
v0.1.0   MVP（书签 / 分类 / 拖拽 / 主题 / 壁纸）
```

> 当前版本号仍控制在 0.x.x。等用户基数 + 稳定性验证到位后再切到 1.0.0。
