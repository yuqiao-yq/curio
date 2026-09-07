import { useMemo } from 'react'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { COLLECTION_LABELS, selectCollection, type CollectionView } from '../utils/collections'
import { VirtualBookmarkGrid } from './VirtualBookmarkGrid'

export function CollectionViewGrid({ view }: { view: CollectionView }) {
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const items = useMemo(() => {
    const names = new Map(categories.map((c) => [c.id, c.name]))
    return selectCollection(cards, view).map((card) => ({
      card,
      categoryPath: names.get(card.categoryId) ?? '收件箱',
      dupCount: 1,
      dupCategoryPaths: [],
    }))
  }, [cards, categories, view])
  return (
    <div>
      <h2 className="text-sm font-medium mb-2">
        {COLLECTION_LABELS[view]} · {items.length}
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        {view === 'inbox'
          ? '先收藏，稍后通过卡片菜单移动到分类。'
          : '按收藏时间排列；修改卡片会同步反映到原分类。'}
      </p>
      {items.length ? (
        <VirtualBookmarkGrid items={items} />
      ) : (
        <p className="text-sm text-slate-400 py-10 text-center">这里暂时没有书签</p>
      )}
    </div>
  )
}
