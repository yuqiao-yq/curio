import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VirtualBookmarkGrid } from './VirtualBookmarkGrid'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { DEFAULT_SETTINGS } from '../types/bookmark'

const observed = vi.hoisted(() => ({
  nodes: [] as Element[],
  scroll: null as HTMLElement | null,
  margin: 0,
}))
vi.mock('./BookmarkCardItem', () => ({
  BookmarkCardItem: ({ card }: { card: { title: string } }) => <div>{card.title}</div>,
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    getScrollElement: () => HTMLElement | null
    scrollMargin: number
    count: number
  }) => {
    observed.scroll = options.getScrollElement()
    observed.margin = options.scrollMargin
    return {
      measure: () => {},
      getVirtualItems: () =>
        options.count ? [{ key: 'first', index: 0, start: options.scrollMargin }] : [],
      getTotalSize: () => 1000,
      measureElement: () => {},
    }
  },
}))

beforeEach(() => {
  observed.nodes = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(node: Element) {
        observed.nodes.push(node)
      }
      disconnect() {}
    },
  )
  useBookmarkStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      cardSize: 'custom',
      cardCustomWidthMin: 222,
      cardCustomWidthMax: 333,
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const items = Array.from({ length: 61 }, (_, i) => ({
  card: {
    id: String(i),
    categoryId: 'a',
    title: 'Card',
    url: 'https://example.com',
    order: i,
    createdAt: 1,
    updatedAt: 1,
  },
  categoryPath: 'A',
  dupCount: 1,
  dupCategoryPaths: [],
}))

it('少量结果时挂载测量容器并使用自定义宽度，跨阈值保留滚动父节点', () => {
  const { container, rerender } = render(
    <main style={{ overflowY: 'auto' }}>
      <VirtualBookmarkGrid items={items.slice(0, 2)} />
    </main>,
  )
  const grid = container.querySelector('.curio-grid-custom') as HTMLElement
  expect(grid.style.getPropertyValue('--curio-card-min-w')).toBe('222px')
  expect(grid.style.getPropertyValue('--curio-card-max-w')).toBe('333px')
  expect(observed.nodes).toContain(grid)
  rerender(
    <main style={{ overflowY: 'auto' }}>
      <VirtualBookmarkGrid items={items} />
    </main>,
  )
  fireEvent.scroll(container.querySelector('main')!)
  expect(observed.scroll).toBe(container.querySelector('main'))
})

it('列表前方有内容时，首行仍定位在列表起点，缩放后重新测量偏移', () => {
  let listTop = 210
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.tagName === 'MAIN' ? 10 : listTop
    return {
      top,
      left: 0,
      right: 800,
      bottom: top + 400,
      x: 0,
      y: top,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    }
  })
  const { container } = render(
    <main style={{ overflowY: 'auto' }}>
      <h2>最近收藏</h2>
      <VirtualBookmarkGrid items={items} />
    </main>,
  )
  expect(observed.margin).toBe(200)
  expect((container.querySelector('[data-index="0"]') as HTMLElement).style.transform).toBe(
    'translateY(0px)',
  )
  listTop = 310
  fireEvent(window, new Event('resize'))
  expect(observed.margin).toBe(300)
  expect((container.querySelector('[data-index="0"]') as HTMLElement).style.transform).toBe(
    'translateY(0px)',
  )
})
