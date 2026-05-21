import { browser, type Browser } from 'wxt/browser'
import type { BookmarkCard, Category } from '../types/bookmark'

/**
 * 同步 Tab It 数据到浏览器原生书签（单向：Tab It → 浏览器，镜像模式）。
 *
 * ─── 设计要点 ─────────────────────────────────────────────────
 *  1. 为了不污染用户原有的书签结构，所有同步内容都收纳到目标根
 *     （书签栏 / 其他书签）下的一个独立子文件夹中，默认名 `Tab It`。
 *  2. 镜像同步：
 *     - 优先用 Category.bookmarkId / BookmarkCard.bookmarkId 复用已有节点
 *       → 保留浏览器原生 `dateAdded` 等元信息，不会每次同步都重建
 *     - 复用失败（节点被用户手动删了）→ 按"同级同名/同 URL"二次匹配
 *     - 还是匹配不到 → 创建新节点
 *     - 完成后清理"挂在镜像目录下、但 Tab It 中已不存在"的多余节点
 *  3. 副产物：把新生成或复用的 bookmarkId 回写到 Tab It 内对应实体，
 *     调用方负责持久化（store 的 saveCategories / saveCards）。
 *  4. 失败兜底：浏览器若不支持 bookmarks API（极少见的环境）→ 抛错由 UI 提示。
 *     单条节点写入失败 → 记录到 errors，不中断整体流程。
 *
 * 不在本期处理：
 *  - 双向同步 / 实时监听浏览器侧的修改
 *  - 单条增量同步（小改动也走全量镜像，规模 < 10000 节点足够快）
 */

export type BrowserSyncRoot = 'bookmarks_bar' | 'other'

export interface ExportOptions {
  /** 目标根：'bookmarks_bar' 书签栏 / 'other' 其他书签 */
  root: BrowserSyncRoot
  /** 镜像目录名（默认 'Tab It'）。在目标根下复用 / 创建该名字的文件夹。 */
  folderName: string
}

export interface ExportResult {
  /** 创建的浏览器文件夹数 */
  foldersCreated: number
  /** 创建的浏览器书签数 */
  bookmarksCreated: number
  /** 更新（rename / move / re-url）的节点数 */
  nodesUpdated: number
  /** 移除的"多余"节点数（镜像清理） */
  nodesRemoved: number
  /** 单条节点失败的错误信息（不阻塞整体） */
  errors: string[]
  /**
   * 需要持久化回 Tab It 数据的 bookmarkId 变更：
   * - categoryIdToBookmarkId：键为 Tab It Category.id，值为浏览器原生 folder id
   * - cardIdToBookmarkId    ：键为 Tab It BookmarkCard.id，值为浏览器原生 bookmark id
   * 调用方读到这两张表后，把没有变化的实体过滤掉，再批量 save 即可。
   */
  categoryIdToBookmarkId: Map<string, string>
  cardIdToBookmarkId: Map<string, string>
}

type Node = Browser.bookmarks.BookmarkTreeNode

/**
 * 主入口：把 categories + cards 镜像同步到浏览器书签的指定根目录下。
 *
 * @throws 当 `browser.bookmarks` 不可用时抛 Error，由 UI 层捕获并 toast。
 */
export async function exportToBrowserBookmarks(
  categories: Category[],
  cards: BookmarkCard[],
  options: ExportOptions,
): Promise<ExportResult> {
  if (!browser.bookmarks) {
    throw new Error('当前浏览器未提供 bookmarks API（请检查扩展权限）')
  }

  const result: ExportResult = {
    foldersCreated: 0,
    bookmarksCreated: 0,
    nodesUpdated: 0,
    nodesRemoved: 0,
    errors: [],
    categoryIdToBookmarkId: new Map(),
    cardIdToBookmarkId: new Map(),
  }

  // 1) 解析目标根 id（书签栏 / 其他书签）
  const rootId = await resolveRootId(options.root)
  if (!rootId) {
    throw new Error('找不到浏览器书签的根目录（请检查 bookmarks 权限）')
  }

  // 2) 在根目录下确保镜像文件夹存在
  const folderName = options.folderName.trim() || 'Tab It'
  const mirrorFolderId = await ensureMirrorFolder(rootId, folderName)

  // 3) 按层级（parentId）排序 categories：父在前、子在后；同层按 order
  const sortedCategories = sortCategoriesTopDown(categories)

  // 4) 依次同步每个 category 对应的浏览器文件夹
  //    映射：Tab It Category.id → 浏览器文件夹 id
  const catFolderMap = new Map<string, string>()
  for (const cat of sortedCategories) {
    const parentBrowserId = cat.parentId
      ? catFolderMap.get(cat.parentId) ?? mirrorFolderId
      : mirrorFolderId
    try {
      const folderId = await syncCategoryFolder(cat, parentBrowserId, result)
      catFolderMap.set(cat.id, folderId)
    } catch (err) {
      result.errors.push(
        `分类「${cat.name}」同步失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // 5) 同步卡片：按 categoryId 分组，分别写入对应文件夹
  const cardsByCat = groupBy(cards, (c) => c.categoryId)
  for (const [catId, list] of cardsByCat) {
    const parentFolderId = catFolderMap.get(catId)
    if (!parentFolderId) continue // 父分类同步失败 → 跳过其下卡片
    // 按 order 升序写入，保证浏览器侧顺序一致
    const orderedCards = [...list].sort((a, b) => a.order - b.order)
    for (const card of orderedCards) {
      try {
        await syncCardBookmark(card, parentFolderId, result)
      } catch (err) {
        result.errors.push(
          `书签「${card.title}」同步失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // 6) 镜像清理：删除挂在镜像目录下、但不属于 Tab It 数据的节点
  const validBrowserIds = new Set<string>([
    mirrorFolderId,
    ...catFolderMap.values(),
    ...result.cardIdToBookmarkId.values(),
  ])
  // 已经在浏览器侧存在、且被 Tab It 记录的旧 bookmarkId 也算合法
  for (const cat of categories) {
    if (cat.bookmarkId) validBrowserIds.add(cat.bookmarkId)
  }
  for (const card of cards) {
    if (card.bookmarkId) validBrowserIds.add(card.bookmarkId)
  }
  await pruneStrangers(mirrorFolderId, validBrowserIds, result)

  return result
}

// ─── 内部工具：根目录解析 ─────────────────────────────────────

/**
 * 把语义化的 root（'bookmarks_bar' / 'other'）解析为浏览器原生根节点 id。
 *
 * 各浏览器约定：
 *  - Chrome / Edge：'1' = 书签栏，'2' = 其他书签
 *  - Firefox       ：'toolbar_____' = 书签栏，'unfiled_____' = 其他书签
 *
 * 为兼容不同实现，这里走 `getTree()` 拿到所有顶层节点再按"位置 / 标题"匹配，
 * 而不是硬编码 id。
 */
async function resolveRootId(root: BrowserSyncRoot): Promise<string | null> {
  const tree = await browser.bookmarks.getTree()
  const top = tree[0]?.children ?? []
  if (top.length === 0) return null

  // Chrome / Edge：top[0] = 书签栏（id 通常 '1'），top[1] = 其他书签（'2'）
  // Firefox    ：会按 menu / toolbar / unfiled 分；通过标题或专属 id 命中
  const isBar = (n: Node) =>
    n.id === '1' ||
    n.id === 'toolbar_____' ||
    /bookmark.*bar|toolbar|书签栏/i.test(n.title || '')
  const isOther = (n: Node) =>
    n.id === '2' ||
    n.id === 'unfiled_____' ||
    /other|unfiled|其他书签/i.test(n.title || '')

  if (root === 'bookmarks_bar') {
    return top.find(isBar)?.id ?? top[0].id
  }
  return top.find(isOther)?.id ?? top[1]?.id ?? top[0].id
}

// ─── 内部工具：镜像文件夹 ─────────────────────────────────────

/** 在 root 下查找名为 folderName 的文件夹；不存在则创建。返回其 id。 */
async function ensureMirrorFolder(
  rootId: string,
  folderName: string,
): Promise<string> {
  const children = await browser.bookmarks.getChildren(rootId)
  const hit = children.find((c) => !c.url && (c.title || '') === folderName)
  if (hit) return hit.id
  const created = await browser.bookmarks.create({
    parentId: rootId,
    title: folderName,
  })
  return created.id
}

// ─── 内部工具：分类（文件夹）同步 ─────────────────────────────

/**
 * 同步一个 category 到浏览器侧的对应文件夹，返回文件夹 id。
 *
 * 复用策略（按命中优先级）：
 *  1) cat.bookmarkId 命中 → 检查节点是否仍在 parentBrowserId 下
 *     - 是：title 不同就更新；返回 id
 *     - 否：把节点 move 到正确父级；title 不同也更新；返回 id
 *  2) 同父级下"同名"的旧文件夹 → 复用其 id
 *  3) 都不命中 → 创建新文件夹
 */
async function syncCategoryFolder(
  cat: Category,
  parentBrowserId: string,
  result: ExportResult,
): Promise<string> {
  const wantTitle = cat.name.trim() || '未命名'

  // 1) 用 bookmarkId 直接命中
  if (cat.bookmarkId) {
    const node = await tryGetNode(cat.bookmarkId)
    if (node && !node.url) {
      let updated = false
      // 父级不对 → 移动
      if (node.parentId !== parentBrowserId) {
        await browser.bookmarks.move(node.id, { parentId: parentBrowserId })
        updated = true
      }
      // 标题不一致 → 改名
      if ((node.title || '') !== wantTitle) {
        await browser.bookmarks.update(node.id, { title: wantTitle })
        updated = true
      }
      if (updated) result.nodesUpdated++
      result.categoryIdToBookmarkId.set(cat.id, node.id)
      return node.id
    }
    // 命中失败 → 走后续匹配 / 创建逻辑
  }

  // 2) 同父级下找同名文件夹复用
  const siblings = await browser.bookmarks.getChildren(parentBrowserId)
  const sameName = siblings.find(
    (s) => !s.url && (s.title || '') === wantTitle,
  )
  if (sameName) {
    result.categoryIdToBookmarkId.set(cat.id, sameName.id)
    return sameName.id
  }

  // 3) 创建新文件夹
  const created = await browser.bookmarks.create({
    parentId: parentBrowserId,
    title: wantTitle,
  })
  result.foldersCreated++
  result.categoryIdToBookmarkId.set(cat.id, created.id)
  return created.id
}

// ─── 内部工具：卡片（书签）同步 ───────────────────────────────

/**
 * 同步一个 card 到浏览器侧的对应书签。
 *
 * 复用策略：
 *  1) card.bookmarkId 命中：移动 / 改标题 / 改 url
 *  2) 同文件夹下同 url 复用
 *  3) 创建新书签
 */
async function syncCardBookmark(
  card: BookmarkCard,
  parentFolderId: string,
  result: ExportResult,
): Promise<void> {
  const wantTitle = card.title.trim() || card.url
  const wantUrl = card.url

  // 1) bookmarkId 命中
  if (card.bookmarkId) {
    const node = await tryGetNode(card.bookmarkId)
    if (node && node.url) {
      let updated = false
      if (node.parentId !== parentFolderId) {
        await browser.bookmarks.move(node.id, { parentId: parentFolderId })
        updated = true
      }
      const patch: { title?: string; url?: string } = {}
      if ((node.title || '') !== wantTitle) patch.title = wantTitle
      if (node.url !== wantUrl) patch.url = wantUrl
      if (Object.keys(patch).length > 0) {
        await browser.bookmarks.update(node.id, patch)
        updated = true
      }
      if (updated) result.nodesUpdated++
      result.cardIdToBookmarkId.set(card.id, node.id)
      return
    }
  }

  // 2) 同父级下同 url 复用
  const siblings = await browser.bookmarks.getChildren(parentFolderId)
  const sameUrl = siblings.find((s) => s.url === wantUrl)
  if (sameUrl) {
    // 标题若不同则顺便对齐；不计为"更新"，避免对纯复用项产生噪音
    if ((sameUrl.title || '') !== wantTitle) {
      await browser.bookmarks.update(sameUrl.id, { title: wantTitle })
      result.nodesUpdated++
    }
    result.cardIdToBookmarkId.set(card.id, sameUrl.id)
    return
  }

  // 3) 新建书签
  const created = await browser.bookmarks.create({
    parentId: parentFolderId,
    title: wantTitle,
    url: wantUrl,
  })
  result.bookmarksCreated++
  result.cardIdToBookmarkId.set(card.id, created.id)
}

// ─── 内部工具：镜像清理 ───────────────────────────────────────

/**
 * 递归遍历 mirrorFolderId 下所有节点，删除不在 validIds 中的"多余"节点。
 *
 * 注意：
 *  - 删除时优先使用 removeTree（含子节点）以减少 API 调用次数
 *  - mirrorFolderId 本身必须保留
 *  - 对单条删除失败采用容错处理：记录到 errors，不中断
 */
async function pruneStrangers(
  mirrorFolderId: string,
  validIds: Set<string>,
  result: ExportResult,
): Promise<void> {
  const stack: string[] = [mirrorFolderId]
  while (stack.length > 0) {
    const parentId = stack.pop()!
    let children: Node[]
    try {
      children = await browser.bookmarks.getChildren(parentId)
    } catch {
      continue
    }
    for (const child of children) {
      if (validIds.has(child.id)) {
        // 合法节点 → 继续向下检查（仅文件夹需要展开）
        if (!child.url) stack.push(child.id)
        continue
      }
      // 不合法 → 移除（文件夹用 removeTree，叶子用 remove）
      try {
        if (child.url) {
          await browser.bookmarks.remove(child.id)
        } else {
          await browser.bookmarks.removeTree(child.id)
        }
        result.nodesRemoved++
      } catch (err) {
        result.errors.push(
          `清理节点失败（${child.title || child.id}）：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}

// ─── 通用辅助 ────────────────────────────────────────────────

/** 包一层 try：browser.bookmarks.get 在 id 失效时会抛错，统一返回 null */
async function tryGetNode(id: string): Promise<Node | null> {
  try {
    const arr = await browser.bookmarks.get(id)
    return arr?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * 对 categories 做"父在前"的稳定排序，保证子分类同步时父级文件夹已建好。
 * - BFS：从顶层（parentId 空）开始一层层展开
 * - 同层按 order 升序
 */
function sortCategoriesTopDown(categories: Category[]): Category[] {
  const childrenOf = new Map<string, Category[]>()
  for (const c of categories) {
    const key = c.parentId ?? ''
    const list = childrenOf.get(key)
    if (list) list.push(c)
    else childrenOf.set(key, [c])
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.order - b.order)
  }
  const result: Category[] = []
  const queue: string[] = ['']
  while (queue.length > 0) {
    const parentKey = queue.shift()!
    const list = childrenOf.get(parentKey) ?? []
    for (const c of list) {
      result.push(c)
      queue.push(c.id)
    }
  }
  return result
}

function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of arr) {
    const k = keyFn(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}
