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
  /**
   * 书签卡尺寸档位：
   * - compact 精简：只图标 + 名称，hover 出方形阴影；适合大量书签速览
   * - standard 标准：默认尺寸（带域名/备注/tags）
   * - custom 自定义：宽/高由 cardCustomWidthMin/Max/HeightMin/Max 控制；
   *   min === max 即为固定值，min < max 时宽度走 minmax+auto-fill、
   *   高度随内容在 [min, max] 之间撑开
   *
   * 历史：
   *   v0.21.19 之前是 'sm' | 'md' | 'lg'：sm=标准、md=大、lg=大。
   *   v0.21.19~v0.22.x：'compact' | 'standard' | 'large'，large 视觉等价于原 md。
   *   v0.22.x 起：large 被替换为 custom；老 large 在 LocalRepository.getSettings
   *   中自动迁移成 custom + 192×128（与原 large 视觉接近）。
   */
  cardSize: 'compact' | 'standard' | 'custom'
  /**
   * 书签卡片图标尺寸：
   * - small 较小：图标和图标底图层同步缩小（≈ 浏览器 favicon 视觉权重）
   * - standard 标准：与卡片尺寸档默认匹配的常规尺寸
   * 仅影响书签卡（不影响文件夹卡 / 历史卡 / 侧边栏图标）
   */
  cardIconSize?: 'small' | 'standard'
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
   * 通过 body 上的 `curio-cards-solid` class 一处控制所有 .card 派生节点。
   */
  cardGlass?: boolean

  /**
   * 「标准档」书签卡片的宽度策略（仅在 cardSize === 'standard' 时生效）。
   * - 'responsive'（默认 / undefined）：保持现有响应式断点 2/3/4/5/6 列，
   *   每列宽度由屏宽决定，老用户零感知。
   * - 'fluid'：保留响应式列数，但每列宽度被夹在 [min, max] 之间，
   *   屏宽变化时列数不变，仅卡片宽度伸缩。
   * - 'fixed'：固定单卡宽度（auto-fill），列数随容器宽自动变化，
   *   类似瀑布流；与 compact 档同款机制，只是宽度由用户决定。
   *
   * compact / large 档忽略此字段，行为不变。
   */
  cardWidthMode?: 'responsive' | 'fluid' | 'fixed'
  /** fluid 模式下的最小列宽（px）。范围 [CARD_WIDTH_MIN_PX, CARD_WIDTH_MAX_PX]，默认 CARD_WIDTH_FLUID_MIN_DEFAULT */
  cardWidthMin?: number
  /** fluid 模式下的最大列宽（px）。约束：cardWidthMin <= cardWidthMax，默认 CARD_WIDTH_FLUID_MAX_DEFAULT */
  cardWidthMax?: number
  /** fixed 模式下的固定卡片宽度（px），默认 CARD_WIDTH_FIXED_DEFAULT */
  cardWidthFixed?: number

  /**
   * 「自定义档」卡片宽度 / 高度（仅在 cardSize === 'custom' 时生效）。
   * - min === max → 固定值；min < max → 自适应：
   *   · 宽度：CSS Grid 走 `repeat(auto-fill, minmax(min, max))`，
   *     列数 = ⌊容器宽 / min⌋，每列宽度在 [min, max] 之间自动放大；
   *   · 高度：卡片用 inline `min-height/max-height + overflow:hidden`，
   *     备注/tags 多时撑到 max，少时收到 min。
   *
   * 默认与边界见 CARD_WIDTH_MIN_PX / CARD_WIDTH_MAX_PX、
   * CARD_HEIGHT_MIN_PX / CARD_HEIGHT_MAX_PX 和 CUSTOM_*_DEFAULT。
   */
  cardCustomWidthMin?: number
  cardCustomWidthMax?: number
  cardCustomHeightMin?: number
  cardCustomHeightMax?: number

  /**
   * 「同步到浏览器书签」目标根：
   * - 'bookmarks_bar'（默认）→ 书签栏（顶部常用）
   * - 'other'              → 其他书签（不在书签栏可见）
   * 仅记录用户偏好，实际写入时再解析为浏览器原生 id（不同浏览器 / 不同账号 id 不同）。
   */
  browserSyncRoot?: 'bookmarks_bar' | 'other'
  /**
   * 同步到浏览器时使用的根文件夹名（默认 'Curio'）。
   * 在 browserSyncRoot 下复用 / 创建该名称的文件夹，作为本扩展的镜像目录,
   * 避免污染用户原有的书签结构。
   */
  browserSyncFolderName?: string
  /**
   * 数据变更后自动同步到浏览器书签（v0.22.x）。
   * - false（默认）：完全手动，用户在「数据管理 → 同步到浏览器书签」点按钮才同步
   * - true：每次书签数据变更（含 add/update/move/delete/标签/整理）后 3s debounce
   *   自动镜像。失败静默 log，不弹 toast 打扰
   *
   * 与 browserSyncRoot / browserSyncFolderName 一样视为「本机偏好」：
   * 不进 SYNCABLE_SETTINGS_KEYS 白名单，多设备独立配置
   * （A 设备可开自动同步、B 设备保持手动，互不干扰）。
   */
  browserSyncAuto?: boolean
}

/** 左侧分类栏宽度边界（与 CategorySidebar 中的拖拽限制保持一致） */
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 240

/**
 * 「标准档」卡片宽度边界与默认值。
 * UI / 工具函数共用，保证 clamp 行为与 fallback 一致。
 */
export const CARD_WIDTH_MIN_PX = 96
export const CARD_WIDTH_MAX_PX = 480
export const CARD_WIDTH_FLUID_MIN_DEFAULT = 140
export const CARD_WIDTH_FLUID_MAX_DEFAULT = 240
export const CARD_WIDTH_FIXED_DEFAULT = 180

/**
 * 「自定义档」高度边界与默认值。
 * 宽度边界复用 CARD_WIDTH_MIN_PX / CARD_WIDTH_MAX_PX。
 */
export const CARD_HEIGHT_MIN_PX = 64
export const CARD_HEIGHT_MAX_PX = 400
export const CUSTOM_W_MIN_DEFAULT = 160
export const CUSTOM_W_MAX_DEFAULT = 240
export const CUSTOM_H_MIN_DEFAULT = 96
export const CUSTOM_H_MAX_DEFAULT = 160

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
  cardSize: 'standard',
  cardIconSize: 'standard',
  language: 'zh-CN',
  syncProvider: 'local',
}
