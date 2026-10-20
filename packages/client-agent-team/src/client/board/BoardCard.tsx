// Derived from multica-x packages/views/issues/components/board-card.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the card reads a resolved `BoardCardTask` row instead of
// Multica's Issue + store selectors; the dnd-kit sortable wrapper is split out
// (`DraggableBoardCard`); the pickers write through one `onUpdate` callback;
// Multica's dates, labels, duplicates, peek and context menu are not ported.
// The sortable wrapper is the card's one tab stop (Space or Enter picks it up
// for a keyboard drag); the title is the real control that opens the Task, so
// no button contains another.

import { memo, useCallback, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { ActivitySource } from '../multica/types.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import { PriorityIcon } from '../multica-ui/PriorityIcon.tsx'
import { PriorityPicker } from '../multica-ui/PriorityPicker.tsx'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { AgentActivityIndicator } from '../multica-ui/AgentActivityIndicator.tsx'
import type { BoardCardTask } from './board-types.ts'
import css from './board.module.css'

export interface BoardCardUpdate {
  readonly priority?: AgentTeamTaskPriority
  readonly assignee?: string | null
}

interface CardBodyProps {
  readonly task: BoardCardTask
  readonly members: readonly AssigneeOption[]
  readonly activities: readonly ActivitySource[]
  readonly settling: boolean
  readonly onUpdate: (taskRef: string, update: BoardCardUpdate) => void
  readonly onOpen: (task: BoardCardTask) => void
  /**
   * Dense, read-only face for a list that is not the Board (the Agent page's
   * Tasks tab): the priority becomes a glyph and the assignee picker is
   * dropped, since the list is already scoped to one Member. The title still
   * opens the Task.
   */
  readonly compact?: boolean
  readonly t: TeamSidebarProps['t']
}

function CardBody({ task, members, activities, settling, onUpdate, onOpen, compact = false, t }: CardBodyProps) {
  const handleUpdate = useCallback((update: BoardCardUpdate) => {
    onUpdate(task.taskRef, update)
  }, [onUpdate, task.taskRef])

  const open = useCallback(() => { onOpen(task) }, [onOpen, task])

  return (
    // A pointer click anywhere on the face opens the Task; the pickers and the
    // title stop their own clicks, so this only sees the passive parts.
    <div
      className={`${css.card} ${settling ? css.cardSettling : ''} ${compact ? css.cardCompact : ''}`}
      data-board-card=""
      data-board-card-compact={compact || undefined}
      data-task-ref={task.taskRef}
      data-testid="board-card"
      onClick={open}
    >
      {/* Row 1: priority + #number (left), live agent activity (right) */}
      <div className={css.cardTopRow}>
        <span className={css.cardId}>
          {compact
            ? <PriorityIcon priority={task.priority ?? 'none'} />
            : <PriorityPicker
              priority={task.priority ?? 'none'}
              onChange={priority => handleUpdate({ priority })}
              t={t}
            />}
          <span>#{task.taskNumber}</span>
        </span>
        <span className={css.cardRight}>
          <AgentActivityIndicator activities={activities} members={members} hoverCard={false} t={t} />
        </span>
      </div>

      {/* Row 2: title, the control that opens the Task */}
      <button
        type="button"
        className={css.cardTitle}
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
      >
        {task.title ?? `#${task.taskNumber}`}
      </button>

      {/* Row 3: channel pill (left), assignee (right) */}
      <div className={css.cardMeta}>
        <span className={css.cardMetaLeft}>
          <span className={css.channelPill} title={task.channelName}>
            <StatusIcon status={task.status} size={10} />
            <span>{task.channelName}</span>
          </span>
        </span>
        {!compact && <AssigneePicker
          assignee={task.assignee ?? null}
          members={members}
          onChange={assignee => handleUpdate({ assignee })}
          t={t}
        />}
      </div>
      {/* Row 4: the Task's active Claim, when one is running */}
      {task.claim !== undefined && (
        <div className={css.claimLine}>
          <span>→</span>
          <span className={css.claimDirection} title={task.claim.direction}>{task.claim.direction}</span>
        </div>
      )}
    </div>
  )
}

/** The static card face, also the DragOverlay's body. */
export const BoardCardContent = memo(function BoardCardContent(props: CardBodyProps) {
  return <CardBody {...props} />
})

/** The sortable card: same face, wrapped in dnd-kit's sortable contract. */
export const DraggableBoardCard = memo(function DraggableBoardCard({ task, ...rest }: CardBodyProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.taskRef,
    data: { status: task.status, columnId: `status:${task.status}` },
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      // dnd-kit marks the handle `role="button"`; the card holds real buttons, so it is a named group instead.
      role="group"
      aria-pressed={undefined}
      aria-label={`#${task.taskNumber} ${task.title ?? ''}`.trim()}
      className={isDragging ? `${css.cardSlot} ${css.cardDragging}` : css.cardSlot}
    >
      <CardBody task={task} {...rest} />
    </div>
  )
})
