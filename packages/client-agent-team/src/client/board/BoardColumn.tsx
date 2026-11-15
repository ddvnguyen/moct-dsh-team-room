// Derived from multica-x packages/views/issues/components/board-column.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the Team board groups by Task status only, so the
// assignee/project/property column heads are gone. Multica's virtualization
// handoff (Virtuoso seed + threshold) is kept in a reduced form — plain render
// below the threshold, `react-virtuoso` above it — and the workflow hints and
// scroll-memento plumbing are not ported. M-51: the head reads a column model
// (built-in or custom list) and the `⋯` menu carries Rename and Archive
// beside Hide, disabled with the reason where the Host would refuse.

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Virtuoso } from 'react-virtuoso'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from '../slots.ts'
import type { ActivitySource, TaskStatus } from '../multica/types.ts'
import { StatusHeading } from '../multica-ui/StatusHeading.tsx'
import { DraggableBoardCard, type BoardCardUpdate } from './BoardCard.tsx'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import type { BoardCardTask } from './board-types.ts'
import { columnLabel, type BoardColumnModel } from './board-columns.ts'
import css from './board.module.css'

export const BOARD_COL_WIDTH = 280

/** Columns at or below this render every card plainly; larger ones virtualize. */
const BOARD_VIRTUALIZE_THRESHOLD = 30

/** One frozen empty list, so a quiet card's props are referentially stable across renders. */
const EMPTY_ACTIVITIES: readonly ActivitySource[] = Object.freeze([])

export interface BoardColumnProps {
  readonly column: BoardColumnModel
  readonly tasks: readonly BoardCardTask[]
  readonly locked: boolean
  /**
   * Opens one card. The focus opener is a way to focus the card's title: the
   * focus returns to it when the issue closes.
   */
  readonly onCardClick: (task: BoardCardTask, focusOpener?: (() => void) | undefined) => void
  readonly onCardUpdate: (taskRef: string, update: BoardCardUpdate) => void
  readonly onHide: (column: BoardColumnModel) => void
  /** Folds the column to the slim strip; `…` › Hide column is a separate affordance. */
  readonly onToggleCollapse: () => void
  /** Opens the list editor on this column; `undefined` for a built-in list. */
  readonly onRename?: ((column: BoardColumnModel) => void) | undefined
  /** Asks to archive this column; `undefined` for a built-in list. */
  readonly onArchive?: ((column: BoardColumnModel) => void) | undefined
  readonly onCreate: () => void
  readonly members: readonly AssigneeOption[]
  readonly activities: readonly ActivitySource[]
  readonly settlingRefs: ReadonlySet<string>
  readonly t: TeamSidebarProps['t']
}

export const BoardColumn = memo(function BoardColumn({ column, tasks, locked, onCardClick, onCardUpdate, onHide,
  onToggleCollapse, onRename, onArchive, onCreate, members, activities, settlingRefs, t }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const [menuOpen, setMenuOpen] = useState(false)
  // The column's scroll container is both dnd-kit's droppable and Virtuoso's
  // customScrollParent, so a merged callback ref feeds the element to both.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el)
    setScrollEl(el)
  }, [setNodeRef])

  const byThread = useMemo(() => {
    const map = new Map<string, ActivitySource[]>()
    for (const activity of activities) {
      if (activity.threadRef === undefined) continue
      const list = map.get(activity.threadRef)
      if (list === undefined) map.set(activity.threadRef, [activity])
      else list.push(activity)
    }
    return map
  }, [activities])

  const cardProps = useMemo(() => ({
    members,
    onUpdate: onCardUpdate,
    onOpen: onCardClick,
    t,
  }), [members, onCardUpdate, onCardClick, t])

  const computeItemKey = useCallback((_index: number, task: BoardCardTask) => task.taskRef, [])
  const itemContent = useCallback((_index: number, task: BoardCardTask) => (
    <DraggableBoardCard
      key={task.taskRef}
      task={task}
      settling={settlingRefs.has(task.taskRef)}
      activities={byThread.get(task.threadRef) ?? EMPTY_ACTIVITIES}
      {...cardProps}
    />
  ), [byThread, cardProps, settlingRefs])
  // Virtuoso items are not flex children of the column, so the card gap is a slot padding.
  const virtualItemContent = useCallback((index: number, task: BoardCardTask) => (
    <div className={css.virtualSlot}>{itemContent(index, task)}</div>
  ), [itemContent])

  const cards: ReactNode = tasks.length === 0
    ? <p className={css.emptyColumn}>{t('boardColumnEmpty')}</p>
    : tasks.length <= BOARD_VIRTUALIZE_THRESHOLD || scrollEl === null
      ? tasks.map(task => itemContent(0, task))
      : (
        <Virtuoso
          customScrollParent={scrollEl}
          data={tasks}
          computeItemKey={computeItemKey}
          increaseViewportBy={{ top: 300, bottom: 300 }}
          itemContent={virtualItemContent}
        />
      )

  // A built-in list is derived state: the Host refuses to rename or archive it,
  // so the menu says so instead of offering the write.
  const renameBlocked = column.builtin ? t('boardListBuiltinRename') : undefined
  const archiveBlocked = column.builtin ? t('boardListBuiltinArchive') : undefined

  return (
    <div className={css.column} data-status={column.key} data-column-key={column.key} data-testid="board-column">
      <div className={css.columnHeader}>
        <span className={css.columnHeaderLeft}>
          <StatusHeading
            {...(column.builtin ? { status: column.key as TaskStatus } : {})}
            label={columnLabel(column, t)}
            count={tasks.length}
            t={t}
          />
        </span>
        <span className={css.columnActions}>
          {/* Never pressed: a collapsed column renders the strip instead of this
              header, so the collapse state is never shown beside a drawn column. */}
          <button
            type="button"
            className={css.columnMenuButton}
            aria-label={t('boardCollapseList')}
            aria-pressed={false}
            onClick={onToggleCollapse}
          >
            <CollapseGlyph />
          </button>
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            align="end"
            anchor={(
              <button
                type="button"
                className={css.columnMenuButton}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t('boardColumnMenu')}
                onClick={() => setMenuOpen(value => !value)}
              >
                ⋯
              </button>
            )}
          >
            <button
              type="button"
              className={css.hiddenShowButton}
              data-testid="board-rename-list"
              disabled={onRename === undefined}
              title={renameBlocked}
              aria-describedby={renameBlocked === undefined ? undefined : 'board-rename-blocked'}
              onClick={() => { setMenuOpen(false); onRename?.(column) }}
            >
              {t('boardRenameList')}
            </button>
            <button
              type="button"
              className={css.hiddenShowButton}
              data-testid="board-archive-list"
              disabled={onArchive === undefined}
              title={archiveBlocked}
              aria-describedby={archiveBlocked === undefined ? undefined : 'board-archive-blocked'}
              onClick={() => { setMenuOpen(false); onArchive?.(column) }}
            >
              {t('boardArchiveList')}
            </button>
            <button type="button" className={css.hiddenShowButton} data-testid="board-hide-list" onClick={() => { setMenuOpen(false); onHide(column) }}>
              {t('boardHideColumn')}
            </button>
            {renameBlocked !== undefined && <p id="board-rename-blocked" className={css.columnMenuHint}>{renameBlocked}</p>}
            {archiveBlocked !== undefined && <p id="board-archive-blocked" className={css.columnMenuHint}>{archiveBlocked}</p>}
          </Menu>
          <button type="button" className={css.columnAddButton} aria-label={t('boardNewTask')} onClick={onCreate}>+</button>
        </span>
      </div>
      <div className={css.columnBody}>
        <div
          ref={mergedRef}
          className={`${css.columnScroll} ${isOver && !locked ? css.columnOver : ''}`}
          data-column-scroll={column.key}
        >
          <SortableContext items={tasks.map(task => task.taskRef)} strategy={verticalListSortingStrategy}>
            {cards}
          </SortableContext>
        </div>
        {locked && isOver && (
          <div role="status" data-testid="board-drop-hint" className={css.dropHint}>
            {t('boardDropLocked')}
          </div>
        )}
      </div>
    </div>
  )
})

/** The collapse control's glyph: Multica's `ArrowLeftRight` icon. */
function CollapseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  )
}
