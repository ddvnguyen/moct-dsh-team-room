// Derived from multica-x packages/views/issues/components/board-card.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the card reads a resolved `BoardCardTask` row instead of
// Multica's Issue + store selectors; the dnd-kit sortable wrapper is split out
// (`DraggableBoardCard`); the pickers write through one `onUpdate` callback;
// Multica's dates, labels, duplicates, peek and context menu are not ported.

import { memo, useCallback, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { ActivitySource } from '../multica/types.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import { PriorityPicker } from '../multica-ui/PriorityPicker.tsx'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import { AgentActivityIndicator } from '../multica-ui/AgentActivityIndicator.tsx'
import type { BoardCardTask } from './board-types.ts'
import css from './board.module.css'

export interface BoardCardUpdate {
  readonly priority?: AgentTeamTaskPriority
  readonly assignee?: string | null
}

function CardBody({ task, members, activities, settling, onUpdate, onOpen, t }: {
  readonly task: BoardCardTask
  readonly members: readonly AssigneeOption[]
  readonly activities: readonly ActivitySource[]
  readonly settling: boolean
  readonly onUpdate: (taskRef: string, update: BoardCardUpdate) => void
  readonly onOpen: (task: BoardCardTask) => void
  readonly t: TeamSidebarProps['t']
}) {
  const handleUpdate = useCallback((update: BoardCardUpdate) => {
    onUpdate(task.taskRef, update)
  }, [onUpdate, task.taskRef])

  const open = useCallback(() => { onOpen(task) }, [onOpen, task])

  return (
    <div
      className={`${css.card} ${settling ? css.cardSettling : ''}`}
      data-board-card=""
      data-task-ref={task.taskRef}
      data-testid="board-card"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key !== 'Enter') return
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        open()
      }}
    >
      {/* Row 1: priority + #number (left), live agent activity (right) */}
      <div className={css.cardTopRow}>
        <span className={css.cardId}>
          <PriorityPicker
            priority={task.priority ?? 'none'}
            onChange={priority => handleUpdate({ priority })}
            t={t}
          />
          <span>#{task.taskNumber}</span>
        </span>
        <span className={css.cardRight}>
          <AgentActivityIndicator activities={activities} members={members} hoverCard={false} t={t} />
        </span>
      </div>

      {/* Row 2: title */}
      <p className={css.cardTitle}>{task.title ?? `#${task.taskNumber}`}</p>

      {/* Row 3: channel pill (left), assignee (right) */}
      <div className={css.cardMeta}>
        <span className={css.cardMetaLeft}>
          <span className={css.channelPill} title={task.channelName}>
            <StatusIcon status={task.status} size={10} />
            <span>{task.channelName}</span>
          </span>
        </span>
        <AssigneePicker
          assignee={task.assignee ?? null}
          members={members}
          onChange={assignee => handleUpdate({ assignee })}
          t={t}
        />
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
export const BoardCardContent = memo(function BoardCardContent(props: Parameters<typeof CardBody>[0]) {
  return <CardBody {...props} />
})

/** The sortable card: same face, wrapped in dnd-kit's sortable contract. */
export const DraggableBoardCard = memo(function DraggableBoardCard({ task, ...rest }: Parameters<typeof CardBody>[0]) {
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
      className={isDragging ? css.cardDragging : undefined}
    >
      <CardBody task={task} {...rest} />
    </div>
  )
})
