import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookmarkGrid } from './BookmarkGrid'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useDropHintStore } from '../stores/useDropHintStore'
import { useToastStore } from '../stores/useToastStore'
import { DEFAULT_SETTINGS, type BookmarkCard } from '../types/bookmark'
import { promptDialog } from './Dialog'

// Keep the real DndContext, PointerSensor, sortable hooks and delete droppable.
// Only replace unrelated card contents and secondary views.
vi.mock('./BookmarkCardItem', async () => {
  const { useSortable } = await import('@dnd-kit/sortable')
  return {
    BookmarkCardItem: ({ card }: { card: BookmarkCard }) => {
      const { setNodeRef, attributes, listeners } = useSortable({ id: card.id })
      return (
        <div ref={setNodeRef} data-dnd-card={card.id} {...attributes} {...listeners}>
          {card.title}
        </div>
      )
    },
    CardDragPreview: () => <div>drag preview</div>,
  }
})
vi.mock('./RecentSection', () => ({ RecentSection: () => null }))
vi.mock('./VirtualBookmarkGrid', () => ({ VirtualBookmarkGrid: () => null }))
vi.mock('./CollectionViewGrid', () => ({ CollectionViewGrid: () => null }))
vi.mock('./Dialog', () => ({ promptDialog: vi.fn(async () => null) }))

const initialState = useBookmarkStore.getState()
const removeCard = vi.fn(async (_id: string) => {})
const moveCard = vi.fn(async () => {})
const reorder = vi.fn(async () => {})
const cards = ['a', 'b', 'c'].map((id, order) => ({
  id,
  categoryId: 'folder',
  title: `Card ${id}`,
  url: `https://example.com/${id}`,
  order,
  createdAt: 1,
  updatedAt: 1,
}))

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId = 1
      isPrimary = true
      pointerType = 'mouse'
    },
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const id = this.dataset.dndCard
    if (id) return rect(cards.findIndex((card) => card.id === id) * 120, 0, 112, 112)
    if (this.getAttribute('aria-label') === '新建书签' || this.dataset.cardDeleteTarget)
      return rect(384, 24, 64, 64)
    if (this.textContent === 'drag preview') return rect(0, 0, 112, 112)
    if (this.dataset.cardDropTarget === 'other') return rect(0, 200, 480, 100)
    return rect(0, 0, 480, 112)
  })
  useBookmarkStore.setState({
    ...initialState,
    categories: [
      { id: 'folder', name: 'Folder', icon: '📁', order: 0, createdAt: 1, updatedAt: 1 },
      {
        id: 'other',
        name: 'Other',
        icon: '📁',
        parentId: 'folder',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    cards,
    activeCategoryId: 'folder',
    searchKeyword: '',
    collectionView: null,
    settings: { ...DEFAULT_SETTINGS, cardSize: 'compact', subSectionDefaultExpanded: false },
    removeCard,
    moveCard,
    reorderCardsInCategory: reorder,
  })
  useDropHintStore.getState().set(null)
  useToastStore.getState().clear()
})

afterEach(() => {
  cleanup()
  useBookmarkStore.setState(initialState)
  useToastStore.getState().clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function startDrag() {
  fireEvent.pointerDown(screen.getByText('Card a'), { button: 0, clientX: 56, clientY: 56 })
  fireEvent.pointerMove(document, { clientX: 66, clientY: 56 })
  await screen.findByText('drag preview')
}

function movePointer(x: number, y = 56) {
  fireEvent.pointerMove(document, { clientX: x, clientY: y })
  fireEvent.mouseMove(window, { clientX: x, clientY: y })
}

async function dropPointer(x: number, y = 56) {
  await act(async () => {
    fireEvent.pointerUp(document, { clientX: x, clientY: y })
  })
}

describe('compact grid quick deletion', () => {
  it('uses a smaller add button and still opens the add flow when idle', () => {
    render(<BookmarkGrid />)
    const add = screen.getByRole('button', { name: '新建书签' })
    expect(add).toHaveClass('w-16', 'h-16')
    expect(add.parentElement).toHaveClass('h-28')
    fireEvent.click(add)
    expect(promptDialog).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '删除书签拖放区' })).not.toBeInTheDocument()
  })

  it('replaces the add button with a bin and deletes on drop, with no confirmation or success toast', async () => {
    render(<BookmarkGrid />)
    await startDrag()
    const bin = await screen.findByRole('button', { name: '删除书签拖放区' })
    expect(bin).toHaveClass('w-16', 'h-16')
    expect(bin).not.toHaveAttribute('title')
    expect(bin).toHaveTextContent('')
    movePointer(416)
    await waitFor(() => expect(bin).toHaveAttribute('data-delete-hovered', 'true'))
    // A stale bridge hint must not override a direct drop on the bin.
    act(() => useDropHintStore.getState().set('other'))
    await dropPointer(416)
    await waitFor(() => expect(removeCard).toHaveBeenCalledWith('a'))
    expect(removeCard).toHaveBeenCalledOnce()
    expect(moveCard).not.toHaveBeenCalled()
    expect(reorder).not.toHaveBeenCalled()
    expect(promptDialog).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toEqual([])
    expect(screen.getByRole('button', { name: '新建书签' })).toBeInTheDocument()
    expect(useDropHintStore.getState().hoverCategoryId).toBeNull()
  })

  it('does not delete when the dragged card overlaps the bin but the pointer remains outside', async () => {
    render(<BookmarkGrid />)
    await startDrag()
    movePointer(370)
    const bin = screen.getByRole('button', { name: '删除书签拖放区' })
    expect(bin).not.toHaveAttribute('data-delete-hovered')
    await dropPointer(370)
    await waitFor(() => expect(reorder).toHaveBeenCalledWith('folder', ['b', 'c', 'a']))
    expect(removeCard).not.toHaveBeenCalled()
  })

  it('leaving the bin resumes sorting without deleting', async () => {
    render(<BookmarkGrid />)
    await startDrag()
    const bin = screen.getByRole('button', { name: '删除书签拖放区' })
    movePointer(416)
    await waitFor(() => expect(bin).toHaveAttribute('data-delete-hovered', 'true'))
    movePointer(176)
    await waitFor(() => expect(bin).not.toHaveAttribute('data-delete-hovered'))
    await dropPointer(176)
    expect(removeCard).not.toHaveBeenCalled()
    expect(reorder).toHaveBeenCalledWith('folder', ['b', 'a', 'c'])
  })

  it('restores the add button and leaves data alone when a drag is cancelled over the bin', async () => {
    render(<BookmarkGrid />)
    await startDrag()
    movePointer(416)
    await act(async () => {
      fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
    })
    await screen.findByRole('button', { name: '新建书签' })
    expect(removeCard).not.toHaveBeenCalled()
    expect(moveCard).not.toHaveBeenCalled()
    expect(reorder).not.toHaveBeenCalled()
  })

  it('preserves cross-category dragging', async () => {
    render(<BookmarkGrid />)
    await startDrag()
    movePointer(56, 250)
    expect(useDropHintStore.getState().hoverCategoryId).toBe('other')
    await dropPointer(56, 250)
    expect(moveCard).toHaveBeenCalledWith('a', 'other', 0)
    expect(removeCard).not.toHaveBeenCalled()
    expect(reorder).not.toHaveBeenCalled()
  })

  it('keeps the standard add slot while dragging', async () => {
    useBookmarkStore.setState({ settings: { ...DEFAULT_SETTINGS, cardSize: 'standard' } })
    render(<BookmarkGrid />)
    await startDrag()
    expect(screen.queryByRole('button', { name: '删除书签拖放区' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建书签' })).toHaveClass('w-24', 'h-24')
    movePointer(416)
    await dropPointer(416)
    expect(removeCard).not.toHaveBeenCalled()
  })

  it('shows an error if deletion fails, and restores the add slot', async () => {
    removeCard.mockRejectedValueOnce(new Error('storage unavailable'))
    render(<BookmarkGrid />)
    await startDrag()
    movePointer(416)
    await dropPointer(416)
    await waitFor(() => expect(useToastStore.getState().toasts[0]?.kind).toBe('error'))
    expect(useBookmarkStore.getState().cards).toHaveLength(3)
    expect(screen.getByRole('button', { name: '新建书签' })).toBeInTheDocument()
  })
})
