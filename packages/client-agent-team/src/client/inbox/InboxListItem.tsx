// Derived from multica-x packages/views/inbox/components/inbox-list-item.tsx and
// inbox-detail-label.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Tailwind classes become CSS Modules on the `--ml-*` look
// tokens; the ActorAvatar and the hover card become the seat's own avatar
// stack; the per-type detail label becomes the severity derivation's reason
// word, which is what the Team Inbox's rows have instead of Multica's
// notification types. The row stays a real <button> — the Inbox seat's rows
// are activation targets the bench and the journey address by role — so the
// hover archive control Multica nests inside the row lives in the detail pane
// instead, where the reader actions the row anyway.

import type { MouseEvent } from 'react'
import type { TeamConversationProps } from '../slots.ts'
import type { InboxItem, InboxSeverity } from '../multica/types.ts'
import { claimersLabel, formatAbsoluteTime, formatInboxTime, formatTaskStatus, taskStatusDot } from '../team-formatters.ts'
import { namedAvatarOwners, TeamAvatarStack, type TeamAvatarHuman } from '../TeamAvatarStack.tsx'
import { TeamCountBadge } from '../TeamCountBadge.tsx'
import { TeamStateDot } from '../TeamStateDot.tsx'
import { INBOX_REASON_KEYS } from './inbox-display.ts'
import type { InboxRow } from './inbox-items.ts'
import css from './inbox.module.css'

export interface InboxListItemProps {
  readonly row: InboxRow
  readonly facet: InboxItem
  readonly selected: boolean
  /** The Workspace is named on the row only while the rows span more than one. */
  readonly showWorkspace: boolean
  readonly human: TeamAvatarHuman | undefined
  readonly t: TeamConversationProps['t']
  /** The row's own activation: select on a wide seat, open the Thread on a narrow one. */
  readonly onActivate: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * One queue row in Multica's own grammar: who is on the work leads in the
 * gutter, the identity line answers which Thread this is, how much is waiting
 * and when it last moved, and the gist sits under it on the same column. The
 * severity band the row sits in adds the one word the derivation found —
 * 「提到你」, 「待你决策」 — in the band's own ink, so a row that must interrupt
 * reads as one before its gist is reached.
 */
export function InboxListItem({ row, facet, selected, showWorkspace, human, t, onActivate }: InboxListItemProps) {
  const { item } = row
  const actor = item.newestActor
  const owners = item.claimOwners
  const unread = item.unreadCount > 0
  // The row's names come from the Client's Human identity where it applies, so
  // the chip's letter and the label's name move together on a rename.
  const namedOwners = namedAvatarOwners(owners, human)
  const namedActor = namedAvatarOwners([actor], human)[0]!
  const named = item.directCount > 0
  const countLabel = named
    ? t('inboxRowUnreadMentions', { count: item.unreadCount, mentions: item.directCount })
    : t('inboxRowUnread', { count: item.unreadCount })
  const severity: InboxSeverity = facet.severity
  return <button
    type="button"
    className={css.row}
    data-selected={selected || undefined}
    data-named={named || undefined}
    data-severity={severity}
    // The row's Task, the way the board card carries it: the walk's opener
    // finds the row to give the focus back to when the issue closes (M-69).
    data-task-ref={item.task?.taskRef}
    onClick={onActivate}
  >
    <span className={css.rowActor}>
      {owners.length > 0
        ? <TeamAvatarStack owners={namedOwners} label={claimersLabel(namedOwners, t)} human={human} />
        : <TeamAvatarStack owners={[namedActor]} label={t('inboxRowActor', { name: `@${namedActor.name}` })} human={human} />}
    </span>
    <span className={css.rowLine}>
      {unread && <span className={css.rowDot} data-inbox-row-dot aria-hidden="true" />}
      <span className={css.rowCrumb}>
        {showWorkspace && <span className={css.rowWorkspace}>{row.workspaceTitle}</span>}
        {showWorkspace && ' / '}
        <span className={css.rowChannel}>#{item.channelName ?? item.channelRef}</span>
        {' '}
        {item.taskNumber !== undefined && <span className={css.rowTask}>{t('taskLabel', { number: item.taskNumber })}</span>}
        {item.task !== undefined && <>
          {' '}
          <span className={css.rowTaskState} data-team-task-state={item.task.status}>
            <TeamStateDot size={8} state={taskStatusDot(item.task.status)} />
            {formatTaskStatus(item.task.status, t)}
          </span>
        </>}
        {unread && <span className={css.rowReason} data-severity={severity}>{t(INBOX_REASON_KEYS[row.reason])}</span>}
      </span>
      <TeamCountBadge count={item.unreadCount} tone={named ? 'solid' : 'hairline'} label={countLabel} />
      <time className={css.rowTime} dateTime={item.newestOccurredAt} title={formatAbsoluteTime(item.newestOccurredAt)}>{formatInboxTime(item.newestOccurredAt, t)}</time>
    </span>
    <span className={css.rowPreview}>{item.previewText}</span>
  </button>
}
