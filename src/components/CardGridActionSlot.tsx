import { closestCenter, pointerWithin, useDroppable, type CollisionDetection } from '@dnd-kit/core'
import { useId, type CSSProperties } from 'react'
import { cn } from '../utils/cn'

export const CARD_DELETE_TARGET = 'card-delete'

// Deletion requires the pointer inside the bin. Never let closestCenter select it
// merely because the user is sorting nearby or dragging outside the grid.
export const cardGridCollisionDetection: CollisionDetection = (args) => {
  const bins = args.droppableContainers.filter(
    (container) => container.data.current?.type === CARD_DELETE_TARGET,
  )
  const binHits = pointerWithin({ ...args, droppableContainers: bins })
  if (binHits.length) return binHits
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.type !== CARD_DELETE_TARGET,
    ),
  })
}

interface Props {
  compact: boolean
  deleting: boolean
  onAdd: () => void
  sizeClass: string
  style?: CSSProperties
}

export function CardGridActionSlot({ compact, deleting, onAdd, sizeClass, style }: Props) {
  const id = useId()
  const { setNodeRef, isOver } = useDroppable({
    id: `card-delete-${id}`,
    data: { type: CARD_DELETE_TARGET },
    disabled: !deleting,
  })

  return (
    <div className={compact ? 'flex h-28 items-center justify-center' : 'contents'}>
      <button
        ref={setNodeRef}
        type="button"
        onClick={deleting ? undefined : onAdd}
        style={style}
        aria-label={deleting ? '删除书签拖放区' : '新建书签'}
        title={deleting ? undefined : '新建书签'}
        data-card-delete-target={deleting || undefined}
        data-delete-hovered={deleting && isOver ? true : undefined}
        className={cn(
          'group/add relative justify-self-start rounded-xl flex items-center justify-center shrink-0',
          'border border-dashed transition-colors duration-150',
          compact ? 'w-16 h-16 text-2xl' : cn('text-3xl', sizeClass),
          deleting
            ? cn(
                // Keep the bin visible when the drag preview crosses it.
                'z-[10000] text-rose-600 dark:text-rose-300',
                isOver
                  ? 'border-rose-500 bg-rose-100 dark:bg-rose-950 ring-2 ring-rose-400/60 shadow-md'
                  : 'border-rose-300 dark:border-rose-700 bg-rose-50/90 dark:bg-slate-900/90',
              )
            : cn(
                'border-slate-300/60 dark:border-slate-600/50',
                'text-slate-700 dark:text-slate-200 bg-transparent',
                'hover:bg-white/60 dark:hover:bg-slate-800/55 hover:backdrop-blur',
                'hover:border-transparent hover:-translate-y-0.5',
                'hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_24px_-4px_rgba(99,102,241,0.18)]',
                'dark:hover:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_14px_28px_-4px_rgba(99,102,241,0.35)]',
              ),
        )}
      >
        {deleting ? (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
          </svg>
        ) : (
          <span className="leading-none opacity-60 group-hover/add:opacity-100 transition-opacity">
            +
          </span>
        )}
      </button>
    </div>
  )
}
