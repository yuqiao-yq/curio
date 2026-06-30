import {
  PRESETTABLE_SETTINGS_KEYS,
  PRESET_EXPORT_VERSION,
  type PresetExportData,
  type PresettableSettings,
  type StylePreset,
  type UserSettings,
} from '../types/bookmark'

/* ─────────────────────────────────────────────────────────────
 * 样式预设工具：pickPresettable / applyStylePreset / parsePresetImport /
 *               buildPresetExport
 *
 * 设计原则：
 *   - 应用预设走现有 settingsSlice.updateSettings(Partial<UserSettings>)
 *     管线，自动处理 debounce 落盘 + 触发渲染 + 可选 sync push（仅 sync
 *     白名单字段会被推到云端）；预设本身不进 sync 白名单（见 types 注释）。
 *   - 不做"清空再写"：应用预设只 spread settings，让用户保留预设外的字段
 *     （如 sidebarWidth / browserSync*）。
 *   - import 容忍但严格：未知字段丢弃，缺关键字段或类型不对的预设丢弃
 *     （不让一个坏预设污染整个导入）。
 * ───────────────────────────────────────────────────────────── */

/** 从完整 UserSettings 中拣出预设白名单字段，跳过 undefined */
export function pickPresettable(s: UserSettings): PresettableSettings {
  const out: Partial<PresettableSettings> = {}
  for (const k of PRESETTABLE_SETTINGS_KEYS) {
    const v = s[k]
    if (v !== undefined) {
      // @ts-expect-error: index union
      out[k] = v
    }
  }
  return out as PresettableSettings
}

/**
 * 应用预设：spread 预设的 settings 到当前 settings。
 * 注意：调用方负责提供 updateSettings；这里不直接耦合 store，便于测试。
 */
export async function applyStylePreset(
  preset: StylePreset,
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>,
): Promise<void> {
  await updateSettings({ ...preset.settings })
}

/** 把一组预设打包成可下载的 JSON 字符串（带 version + ts 头部） */
export function buildPresetExport(presets: StylePreset[]): string {
  const data: PresetExportData = {
    version: PRESET_EXPORT_VERSION,
    exportedAt: Date.now(),
    // 仅导出 user 类，避免接收方导入后 builtin id 重复
    presets: presets.filter((p) => p.kind === 'user'),
  }
  return JSON.stringify(data, null, 2)
}

/**
 * 校验导入 JSON，返回 sanitize 后的预设数组或 null。
 *
 * - JSON 解析失败、顶层不是对象、presets 不是数组 → 全部 null
 * - 单个预设字段缺失 / 类型不对 → 跳过该项；其它项继续
 * - 所有项都跳过的话仍返回 []（caller 看 length === 0 提示用户）
 * - 导入的预设统一标记 kind = 'user'（即便 JSON 里写了 'builtin'），
 *   避免污染 builtin id 空间
 */
export function parsePresetImport(json: string): StylePreset[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<PresetExportData>
  if (!Array.isArray(data.presets)) return null

  const out: StylePreset[] = []
  for (const p of data.presets) {
    if (!p || typeof p !== 'object') continue
    const item = p as Partial<StylePreset>
    if (typeof item.id !== 'string' || !item.id) continue
    if (typeof item.name !== 'string') continue
    if (!item.settings || typeof item.settings !== 'object') continue

    // settings 内字段做一次浅 sanitize：只保留白名单 + 原始类型
    const settings: Partial<PresettableSettings> = {}
    for (const k of PRESETTABLE_SETTINGS_KEYS) {
      const v = (item.settings as Record<string, unknown>)[k]
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        // @ts-expect-error: index union
        settings[k] = v
      }
    }

    const now = Date.now()
    out.push({
      id: item.id,
      name: item.name || '未命名预设',
      kind: 'user',
      settings: settings as PresettableSettings,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
    })
  }
  return out
}

/**
 * 合并 user 预设：incoming 与 existing 按 id 去重，updatedAt 大者胜出。
 * UI 在"从 JSON 导入"按钮里调用，避免简单 push 造成同名同 id 重复。
 */
export function mergeUserPresets(
  existing: StylePreset[],
  incoming: StylePreset[],
): StylePreset[] {
  const byId = new Map<string, StylePreset>()
  for (const p of existing) {
    if (p.kind === 'user') byId.set(p.id, p)
  }
  for (const p of incoming) {
    if (p.kind !== 'user') continue
    const prev = byId.get(p.id)
    if (!prev || p.updatedAt >= prev.updatedAt) byId.set(p.id, p)
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}
