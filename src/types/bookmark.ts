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
 *
 * 默认值与「自定义档 → 标准」预设严格一致：
 *   宽 160~240（默认走 fluid，列数随容器宽变，但每列宽度被夹住）
 *   高 96~96（固定，与原 standard 档 h-24 视觉等价）
 * 这意味着用户切到「自定义」档而不调任何输入时，看到的就是"标准款卡片"，
 * 没有突兀的尺寸跳变。
 */
export const CARD_HEIGHT_MIN_PX = 64
export const CARD_HEIGHT_MAX_PX = 400
export const CUSTOM_W_MIN_DEFAULT = 160
export const CUSTOM_W_MAX_DEFAULT = 240
export const CUSTOM_H_MIN_DEFAULT = 96
export const CUSTOM_H_MAX_DEFAULT = 96

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

/* ─────────────────────────────────────────────────────────────
 * 样式预设（v0.22.x）
 *
 * 用户把"主题 + 背景 + 字色 + 卡片布局"四块整体打包成可复用的预设，
 * 一键切换 / 保存自己的方案 / 导出 JSON 分享。
 *
 * 范围：PRESETTABLE_SETTINGS_KEYS 列出的视觉相关字段；
 * 不含：syncProvider / sidebarWidth / browserSync* / recentIncludeBrowserHistory
 *      等"设备 / 行为偏好"性质的字段（这类应当跨预设保持稳定）。
 *
 * 存储：browser.storage.local 单 key（KEYS.presets），不进云同步白名单
 *      （wallpaper 含 base64 可能超 sync 100KB 配额；跨设备走 JSON 导出导入）。
 * ───────────────────────────────────────────────────────────── */

export const PRESETTABLE_SETTINGS_KEYS = [
  'theme',
  'wallpaper',
  'backgroundBlur',
  'fontColor',
  'cardSize',
  'cardIconSize',
  'cardGlass',
  'cardWidthMode',
  'cardWidthMin',
  'cardWidthMax',
  'cardWidthFixed',
  'cardCustomWidthMin',
  'cardCustomWidthMax',
  'cardCustomHeightMin',
  'cardCustomHeightMax',
  'subSectionDefaultExpanded',
] as const satisfies ReadonlyArray<keyof UserSettings>

export type PresettableKey = (typeof PRESETTABLE_SETTINGS_KEYS)[number]
/**
 * 预设里的 settings 都是「部分覆盖」语义：
 * - 用户保存预设时只快照非 undefined 字段（pickPresettable 已经做了）
 * - 应用预设时整段 spread 到当前 settings，未覆盖的字段保持原样
 * 因此用 Partial<Pick<...>> 而不是 Pick<...>。
 */
export type PresettableSettings = Partial<Pick<UserSettings, PresettableKey>>

export interface StylePreset {
  /** crypto.randomUUID() 生成；builtin 用稳定字符串 'builtin:xxx' */
  id: string
  /** 用户可见名（允许重名，不强制唯一） */
  name: string
  /** 'builtin' = 仓库内置示例（不可删 / 改名，但可应用、可派生为 user 预设） */
  kind: 'builtin' | 'user'
  /** 视觉子集快照；应用时整段 spread 到 updateSettings */
  settings: PresettableSettings
  createdAt: number
  updatedAt: number
}

/** 导入导出 JSON 格式 */
export const PRESET_EXPORT_VERSION = 1
export interface PresetExportData {
  version: number
  exportedAt: number
  /** 仅导出 user 类预设；导入时全部按 'user' 落地，避免污染 builtin id 空间 */
  presets: StylePreset[]
}

/**
 * 内置示例预设。id 用 'builtin:xxx' 稳定字符串，跨版本不重复出现。
 *
 * 选 5 个覆盖主流场景：
 *   default  - 极简白底，新用户默认
 *   midnight - 深色主题 + 实色卡片，长时间使用更护眼
 *   aurora   - 亮色 + 渐变 + 强毛玻璃，视觉冲击
 *   paper    - 紧凑无背景图，纸质书签风
 *   poster   - 自定义档 + 海报式大卡，类 Pinterest
 */
export const BUILTIN_PRESETS: StylePreset[] = [
  {
    id: 'builtin:default',
    name: '默认',
    kind: 'builtin',
    settings: {
      theme: 'auto',
      cardSize: 'standard',
      cardIconSize: 'standard',
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin:midnight',
    name: '午夜',
    kind: 'builtin',
    settings: {
      theme: 'dark',
      wallpaper: 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)',
      backgroundBlur: 0,
      cardSize: 'standard',
      cardGlass: false,
      cardIconSize: 'standard',
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin:aurora',
    name: '极光',
    kind: 'builtin',
    settings: {
      theme: 'light',
      wallpaper: 'linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #38bdf8 100%)',
      backgroundBlur: 12,
      cardSize: 'standard',
      cardGlass: true,
      cardIconSize: 'standard',
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin:paper',
    name: '简纸',
    kind: 'builtin',
    settings: {
      theme: 'light',
      wallpaper: '',
      fontColor: '#475569',
      cardSize: 'compact',
      cardGlass: false,
      cardIconSize: 'small',
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin:poster',
    name: '海报',
    kind: 'builtin',
    settings: {
      theme: 'auto',
      wallpaper: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
      backgroundBlur: 6,
      cardSize: 'custom',
      cardCustomWidthMin: 240,
      cardCustomWidthMax: 240,
      cardCustomHeightMin: 280,
      cardCustomHeightMax: 280,
      cardGlass: true,
      cardIconSize: 'standard',
    },
    createdAt: 0,
    updatedAt: 0,
  },
]
