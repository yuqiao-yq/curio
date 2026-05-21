/**
 * 核心数据模型
 *
 * 设计原则：
 * - 视图层（Category + BookmarkCard）与浏览器原生书签解耦
 * - 所有同步实体带 id / updatedAt，便于 V2 云同步冲突合并
 */

/** 自定义分类（虚拟分组） */
export interface Category {
  id: string
  name: string
  icon?: string   // emoji 或图标名
  color?: string  // hex 色值
  /** 用户自定义备注/描述（与书签卡同款 UX，鼠标 hover 时可添加） */
  description?: string
  /** 父分类 ID；undefined 或空字符串表示顶层 */
  parentId?: string
  order: number
  /**
   * 关联的浏览器原生书签文件夹 id。
   * - 仅当用户开启「同步到浏览器书签」并完成过一次同步后才会写入
   * - 同步逻辑会按此 id 复用浏览器原生文件夹，避免每次同步都重建（保留 dateAdded 等元信息）
   * - 如果该 id 在浏览器中已不存在（用户手动删了），同步逻辑会按"同级同名"重新匹配并回写新 id
   */
  bookmarkId?: string
  createdAt: number
  updatedAt: number
}

/** 卡片：一个书签的展示形态 */
export interface BookmarkCard {
  id: string
  categoryId: string
  title: string
  url: string
  /** 用户自定义图标（缺省用 favicon） */
  icon?: string
  /** 用户自定义缩略图（base64 / URL） */
  thumbnail?: string
  description?: string
  tags?: string[]
  order: number
  /** 关联的浏览器原生书签 id */
  bookmarkId?: string
  createdAt: number
  updatedAt: number
}

/** 用户设置 */
export interface UserSettings {
  theme: 'light' | 'dark' | 'auto'
  layout: 'grid' | 'list'
  cardSize: 'sm' | 'md' | 'lg'
  wallpaper?: string
  /**
   * 自定义文字颜色（hex 或任意合法 CSS 颜色字符串）。
   * - 空 / undefined → 用 global.css 的默认色（亮色：slate-900；暗色：slate-100）
   * - 设置后 → 通过 inline style 覆盖 body 颜色，影响所有未显式设色的文字
   * 显式带 text-* 类的辅助文字、按钮品牌色等不会被覆盖，这是预期行为。
   */
  fontColor?: string
  language: 'zh-CN' | 'en'
  syncProvider: 'local' | 'drive' | 'supabase'
  /**
   * 左侧分类栏宽度（px）。
   * 取值范围参考 SIDEBAR_WIDTH_MIN / SIDEBAR_WIDTH_MAX，
   * 默认值见 SIDEBAR_WIDTH_DEFAULT。折叠态由组件内 collapsed 状态控制，
   * 不写入此字段，避免折叠后丢失展开时的偏好。
   */
  sidebarWidth?: number
  /**
   * 「最近使用」模块是否合并展示浏览器全局历史（任意网站）。
   * - false（默认）：只展示用户在本扩展内点击过的书签卡片
   * - true        ：再叠加 browser.history.search 的结果
   * 隐私敏感，默认关闭，需要用户在 UI 中主动开启。
   */
  recentIncludeBrowserHistory?: boolean
  /**
   * 当前分类内的子文件夹 section 是否默认展开。
   * - false / undefined（默认）：子 section 默认折叠（点击 header 才展开）
   * - true：子 section 默认展开，进入分类立即看到子文件夹的全部书签
   *
   * 老用户保持原行为（默认折叠），需要在样式管理里主动开启展开。
   */
  subSectionDefaultExpanded?: boolean

  /**
   * 背景毛玻璃强度（px）。
   * - 0 / undefined（默认）：不应用模糊，背景清晰显示
   * - >0：在背景与内容之间叠一层 fixed 全屏 div，应用 `backdrop-filter: blur(Npx)`
   * 推荐范围 0~32px；过大会让背景几乎消失，反而失去自定义背景的意义。
   */
  backgroundBlur?: number

  /**
   * 书签卡片 / 文件夹卡 / 历史卡 是否启用毛玻璃效果。
   * - true / undefined（默认）：半透明 + backdrop-blur，与自定义背景融合更优雅
   * - false：纯实色背景，无 backdrop 模糊，文字对比度更高、性能更好
   * 通过 body 上的 `tabit-cards-solid` class 一处控制所有 .card 派生节点。
   */
  cardGlass?: boolean

  /**
   * 「同步到浏览器书签」目标根：
   * - 'bookmarks_bar'（默认）→ 书签栏（顶部常用）
   * - 'other'              → 其他书签（不在书签栏可见）
   * 仅记录用户偏好，实际写入时再解析为浏览器原生 id（不同浏览器 / 不同账号 id 不同）。
   */
  browserSyncRoot?: 'bookmarks_bar' | 'other'
  /**
   * 同步到浏览器时使用的根文件夹名（默认 'Tab It'）。
   * 在 browserSyncRoot 下复用 / 创建该名称的文件夹，作为本扩展的镜像目录，
   * 避免污染用户原有的书签结构。
   */
  browserSyncFolderName?: string
}

/** 左侧分类栏宽度边界（与 CategorySidebar 中的拖拽限制保持一致） */
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 240

/** 导入导出数据 */
export interface ExportData {
  version: string
  exportedAt: number
  categories: Category[]
  cards: BookmarkCard[]
  settings?: UserSettings
}

/** 同步结果（V2 用） */
export interface SyncResult {
  success: boolean
  pulled: number
  pushed: number
  conflicts: number
  message?: string
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'auto',
  layout: 'grid',
  cardSize: 'md',
  language: 'zh-CN',
  syncProvider: 'local',
}
