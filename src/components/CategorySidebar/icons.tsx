/* ──────────────────────────────────────────────────────────────────────
 * 侧栏所用 SVG icon 集合（均为线条 stroke 风格）。
 *
 * 与 utils/icon.tsx 的 IconView 是两件事：
 *   - utils/icon.tsx → 渲染"分类/卡片自定义图标（emoji 或 base64/URL）"
 *   - 本文件        → 侧栏工具栏 / 行尾按钮里固定的功能 icon
 * ────────────────────────────────────────────────────────────────────── */

/** 批量多选 icon（左侧三个 ✓、右侧三条横线，经典 list-checks 形态） */
export function BulkSelectIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 5 5 7 8 4" />
      <polyline points="3 12 5 14 8 11" />
      <polyline points="3 19 5 21 8 18" />
      <line x1="11" y1="5.5" x2="20" y2="5.5" />
      <line x1="11" y1="12.5" x2="20" y2="12.5" />
      <line x1="11" y1="19.5" x2="20" y2="19.5" />
    </svg>
  )
}

/** 分类列表 icon（左侧三圆点 + 三横线，经典 list-menu 形态） */
export function CategoriesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 双下箭头：一键展开全部（语义为"全部向下打开"） */
export function ExpandAllIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="7 6 12 11 17 6" />
      <polyline points="7 13 12 18 17 13" />
    </svg>
  )
}

/** 双上箭头：一键折叠全部（语义为"全部向上收起"） */
export function CollapseAllIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="7 11 12 6 17 11" />
      <polyline points="7 18 12 13 17 18" />
    </svg>
  )
}

/** 12x12 垃圾桶图标（stroke 风格，与侧栏行高/+号视觉重量协调） */
export function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

/** 小尺寸信息 i：放在侧栏底部统计行 */
export function InfoIconMini() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="12" y1="7.5" x2="12" y2="7.51" />
    </svg>
  )
}
