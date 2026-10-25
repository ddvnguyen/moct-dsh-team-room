// Derived from multica-x packages/views/issues/components/board-column.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the Team board groups by Task status only, so the
// assignee/project/property column heads are gone. Multica's virtualization
// handoff (Virtuoso seed + threshold) is kept in a reduced form — plain render
// below the threshold, `react-virtuoso` above it — and the workflow hints and
// scroll-memento plumbing are not ported.

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Virtuoso } from 'react-virtuoso'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import { StatusHeading } from '../multica-ui/StatusHeading.tsx'
import { DraggableBoardCard, type BoardCardUpdate } from './BoardCard.tsx'
import type { AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import type { ActivitySource } from '../multica/types.ts'
import type { BoardCardTask } from './board-types.ts'
import css from './board.module.css'

export const BOARD_COL_WIDTH = 280

/** Columns at or below this render every card plainly; larger ones virtualize. */
const BOARD_VIRTUALIZE_THRESHOLD = 30

/** One frozen empty list, so a quiet card's props are referentially stable across renders. */
const EMPTY_ACTIVITIES: readonly ActivitySource[] = Object.freeze([])

export interface BoardColumnProps {
  readonly status: TaskStatus
  readonly tasks: readonly BoardCardTask[]
  readonly locked: boolean
  /**
   * Opens one card. The focus opener is a way to focus the card's title: the
   * focus returns to it when the issue closes.
   */
  readonly onCardClick: (task: BoardCardTask, focusOpener?: (() => void) | undefined) => void
  readonly onCardUpdate: (taskRef: string, update: BoardCardUpdate) => void
  readonly onHide: (status: TaskStatus) => void
  readonly onCreate: () => void
  readonly members: readonly AssigneeOption[]
  readonly activities: readonly ActivitySource[]
  readonly settlingRefs: ReadonlySet<string>
  readonly t: TeamSidebarProps['t']
}

export const BoardColumn = memo(function BoardColumn({ status, tasks, locked, onCardClick, onCardUpdate, onHide, onCreate, members, activities, settlingRefs, t }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` })
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

  return (
    <div className={css.column} data-status={status} data-testid="board-column">
      <div className={css.columnHeader}>
        <span className={css.columnHeaderLeft}>
          <StatusHeading status={status} count={tasks.length} t={t} />
        </span>
        <span className={css.columnActions}>
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
            <button type="button" className={css.hiddenShowButton} onClick={() => { setMenuOpen(false); onHide(status) }}>
              {t('boardHideColumn')}
            </button>
          </Menu>
          <button type="button" className={css.columnAddButton} aria-label={t('boardNewTask')} onClick={onCreate}>+</button>
        </span>
      </div>
      <div className={css.columnBody}>
        <div
          ref={mergedRef}
          className={`${css.columnScroll} ${isOver && !locked ? css.columnOver : ''}`}
          data-column-scroll={status}
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
