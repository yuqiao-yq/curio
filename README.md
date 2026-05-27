# Curio

> 替代浏览器新标签页的书签整理工具，支持 Chrome / Edge / Firefox / Brave / Opera。

打开新标签页，看到的不是默认页面，而是你自己整理好的、分类清晰的书签卡片墙。

## 特性

- 🎨 **DIY 新标签页**：自定义分类 + 卡片网格
- 🖱️ **拖拽排序**：卡片可在分类内或跨分类拖拽
- 🔍 **快速搜索**：标题 / URL / `#标签` / `@ai 语义` 多模式
- 📥 **一键导入**：从浏览器原生书签批量导入
- 🪄 **拖入链接快速添加**（v0.22.x+）：从其他 tab / 桌面拖 link 到主区，自动建书签
- 💾 **数据自由**：JSON 导入 / 导出，跨浏览器迁移
- 🔄 **跨设备同步**：同一浏览器账号下自动同步偏好和书签（chrome.storage.sync）
- 🔁 **浏览器书签镜像**（v0.22.x+ 支持自动模式）：数据变更后 3s debounce 自动同步到浏览器原生书签
- 🌗 **深色模式**：自动跟随系统
- 🔌 **跨浏览器**：一套代码，多浏览器通用（基于 WebExtension）
- ✨ **可选 AI**（v0.8+）：自动整理 / 打标签 / 语义搜索 / RAG 问答 / 相关阅读 / 整理质检（**opt-in 默认关闭**）
- 🧭 **首次进入引导**（v0.22.x+）：5 步 Spotlight 主 Tour + 渐进式 mini 提示，齿轮菜单可重看
- ☁️ **云同步**（V2 规划中）：Google Drive 免费 / Supabase 付费双轨，突破 100KB 配额

## 下载安装

不想自己编译？直接到 [Releases 页面](https://github.com/yuqiao-yq/curio/releases/latest) 下载最新版 zip。

### Chrome / Edge / Brave / Opera

1. 下载 `curio-x.y.z-chrome.zip` 并解压到任意目录（**不要删除**这个目录，扩展运行时依赖它）
2. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`）
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择刚才解压出来的目录
5. 打开新标签页即可看到 Curio

### Firefox

1. 下载 `curio-x.y.z-firefox.zip`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击 **临时载入附加组件**，选择 zip 内的 `manifest.json`

注：Firefox 临时载入只在当前会话有效，重启浏览器后会失效。后续会考虑上架到 Chrome 应用商店 / Firefox AMO。

## 技术栈

- **WXT** + **React 18** + **TypeScript** + **Vite**
- **TailwindCSS** 3
- **Zustand**（状态管理）
- **@dnd-kit**（拖拽）
- **chrome.bookmarks / chrome.storage / favicon API**

## 目录结构

```
curio/
├── docs/                   # 设计文档（架构、Roadmap）
├── entrypoints/
│   ├── newtab/             # 新标签页主界面
│   └── background.ts       # Service Worker
├── src/
│   ├── components/         # UI 组件
│   ├── stores/             # Zustand 状态
│   ├── repositories/       # 数据层（存储抽象）
│   ├── services/           # 业务逻辑（导入等）
│   ├── types/              # 类型定义
│   ├── utils/              # 工具函数
│   └── styles/             # 全局样式
├── wxt.config.ts
├── tailwind.config.js
└── package.json
```

## 开发指南

### 1. 安装依赖

```bash
pnpm install
```

> 推荐使用 pnpm。npm / yarn 也可以。

### 2. 启动开发模式

```bash
# Chromium（Chrome / Edge / Brave / Opera）
pnpm dev

# Firefox
pnpm dev:firefox
```

WXT 会自动启动浏览器并加载扩展，支持 HMR。

### 3. 手动加载（如果不用 WXT 自动启动）

```bash
pnpm build
```

#### Chrome / Edge
1. 打开 `chrome://extensions/`（或 `edge://extensions/`）
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目下的 `.output/chrome-mv3` 目录
5. 打开新标签页即可看到 Curio 界面

#### Firefox
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 **临时载入附加组件**
3. 选择 `.output/firefox-mv3/manifest.json`

### 4. 打包发布

```bash
pnpm build       # Chrome 产物：.output/chrome-mv3
pnpm zip         # 生成上架用 zip：.output/*.zip

pnpm build:firefox
pnpm zip:firefox
```

## 使用说明

打开新标签页后：

1. **首次使用**：跟着自动启动的 5 步引导 Tour 走一遍（v0.22.x+），或点 "从浏览器一键导入书签" 把现有书签导入
2. **创建分类**：左侧栏点击 `+` 新建分类（创建第一个分类时会弹「双击改名」mini 提示）
3. **添加卡片**：三种方式 —— 卡片网格里的 `+` / 从其他 tab 直接**拖入链接** / popup「添加当前页面」
4. **拖拽排序**：按住卡片拖动调整顺序，支持跨分类移动
5. **搜索**：顶部搜索框实时过滤；`#标签` 按 tag 筛选；`@ai 关键词` 走语义搜索；`@web` 走全网
6. **AI 助手**：右下角 ✨ 按钮（或 `⌘J / Ctrl+J`）唤起浮窗，整理、打标签、对话、相关阅读……
7. **同步**：浏览器账号同步内（V1.5）零成本；也可开「自动镜像到浏览器书签」让原生书签栏跟随；
   或纯本地手动 JSON 导入 / 导出做最稳妥的备份

## 路线图

详见 [docs/ROADMAP.md](docs/ROADMAP.md)。

- **V1.0** ✅ 本地版 MVP
- **V1.5** ✅ 同浏览器多设备同步（chrome.storage.sync）
- **V2.0** ⬜ 跨浏览器云同步（Drive Free + Supabase Pro），突破 100KB 配额
- **V3.0** 🟡 协作 / 分享 + **AI**（12/14 任务已交付：自动整理 / 打标签 / 语义搜索 / RAG / 相关阅读 / 整理质检 等）

## 架构与设计

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

核心设计：
- **Repository 模式**：存储层抽象，未来切换到云端不影响业务代码
- **视图与原生书签解耦**：自定义分类独立存在，不受浏览器原生书签变动影响
- **同步预留**：所有实体带 `id` + `updatedAt`，便于 V2 冲突合并

## License

MIT
