import { browser } from 'wxt/browser'
import { getRepository } from '../repositories'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { LOCAL_CHANGE_KEY, LOCAL_WRITER_ID } from './storageLock'

/** 只接收其它页面的提交；刷新数据不重新初始化当前分类、搜索或引导。 */
export function subscribeLocalChanges(): () => void {
  let disposed = false
  let running = false
  let dirty = false
  const refresh = async () => {
    if (running) return
    running = true
    try {
      while (dirty && !disposed) {
        dirty = false
        const data = await getRepository().bulkExport()
        if (disposed) return
        const s = useBookmarkStore.getState()
        const active = s.activeCategoryId
        useBookmarkStore.setState({
          categories: data.categories,
          cards: data.cards,
          activeCategoryId:
            active && data.categories.some((c) => c.id === active)
              ? active
              : (data.categories.find((c) => !c.parentId)?.id ?? null),
        })
      }
    } catch (err) {
      console.warn('[Curio] 刷新其它页面的数据失败', err)
    } finally {
      running = false
    }
  }
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return
    const change = changes[LOCAL_CHANGE_KEY]?.newValue as { writer?: string } | undefined
    if (!change || change.writer === LOCAL_WRITER_ID) return
    dirty = true
    void refresh()
  }
  browser.storage.onChanged.addListener(listener)
  return () => {
    disposed = true
    browser.storage.onChanged.removeListener(listener)
  }
}
