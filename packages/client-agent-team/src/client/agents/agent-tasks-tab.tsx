// Derived from multica-x packages/views/agents/components/tabs/activity-tab.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's activity tab groups the Agent's AgentTask rows
// by status and renders its own compact card. The Team Room already has one
// card face (`BoardCard`), so the same card renders here in compact mode —
// read-only, no assignee picker — and the title still opens the Task's Thread.

import type { AgentTeamMemberActivity } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { TaskStatus } from '../multica/types.ts'
import type { AvatarStackMember } from '../multica-ui/AgentAvatarStack.tsx'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import { BoardCardContent } from '../board/BoardCard.tsx'
import type { BoardCardTask } from '../board/board-types.ts'
import type { MemberTaskRow } from './agent-page-model.ts'
import css from './agent-page.module.css'

export function AgentTasksTab({ state, message, groups, members, activities, onOpen, t }: {
  readonly state: 'loading' | 'failed' | 'ready'
  readonly message?: string | undefined
  readonly groups: readonly { readonly status: TaskStatus; readonly rows: readonly MemberTaskRow[] }[]
  readonly members: readonly AvatarStackMember[]
  readonly activities: readonly AgentTeamMemberActivity[]
  readonly onOpen: (row: MemberTaskRow, focusOpener?: (() => void) | undefined) => void
  readonly t: TeamSidebarProps['t']
}) {
  if (state === 'loading') return <p className={css.muted} data-agent-tasks>{t('agentDetailsLoading')}</p>
  if (state === 'failed') return <p className={css.error} role="alert" data-agent-tasks>{t('agentDetailsLoadFailed', { message: message ?? '' })}</p>
  if (groups.length === 0) return <p className={css.muted} data-agent-tasks>{t('agentTasksEmpty')}</p>
  return (
    <div className={css.tasks} data-agent-tasks>
      {groups.map(group => (
        <section key={group.status} className={css.taskGroup} data-task-group={group.status}>
          <h3 className={css.taskGroupTitle}>
            <StatusIcon status={group.status} size={12} />
            <span>{t(STATUS_LABEL_KEY[group.status])}</span>
            <span className={css.taskGroupCount}>{String(group.rows.length)}</span>
          </h3>
          <ul className={css.taskList}>
            {group.rows.map(row => (
              <li key={row.taskRef}>
                <BoardCardContent
                  compact
                  task={toCardTask(row)}
                  members={members}
                  activities={activities}
                  settling={false}
                  onUpdate={() => { /* the compact face is read-only */ }}
                  onOpen={(_task, focusOpener) => { onOpen(row, focusOpener) }}
                  t={t}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** The board card's view-model, from the Agent page's Task row. Writes never happen here, so the revision fence stays 0. */
function toCardTask(row: MemberTaskRow): BoardCardTask {
  return {
    taskRef: row.taskRef as BoardCardTask['taskRef'],
    channelRef: row.channelRef as BoardCardTask['channelRef'],
    threadRef: row.threadRef as BoardCardTask['threadRef'],
    status: row.status,
    taskNumber: row.taskNumber,
    channelName: row.channelName,
    threadRevision: 0,
    title: row.title,
    priority: row.priority,
    position: row.position,
    ...(row.claimDirection === undefined ? {} : { claim: { owner: '', direction: row.claimDirection } }),
  }
}
