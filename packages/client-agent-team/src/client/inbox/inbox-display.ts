// Derived from multica-x packages/views/inbox/components/inbox-display.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's display helpers clean up its server-side
// notification types (quick-create outcomes, autopilot quota notices). The
// Team Inbox's rows come from the Host's own projection, so what survives the
// port is the display vocabulary: which group a row renders under and the
// label that says why. Group order lives with the filter helpers
// (`multica/inbox-filter.ts`).

import type { AgentTeamInboxItem } from '@ddvnguyen/moct-dsh-team-room/types'
import { INBOX_SEVERITY_ORDER } from '../multica/inbox-filter.ts'
import type { InboxSeverity } from '../multica/types.ts'
import type { TeamConversationProps } from '../slots.ts'
import type { FacetedRow, InboxReason } from './inbox-items.ts'

/** The locale key each label prints; typed so a rename breaks the compile. */
type LocaleKey = Parameters<TeamConversationProps['t']>[0]

/** One rendered severity group: its band, and the rows it holds in list order. */
export interface InboxGroup {
  readonly severity: InboxSeverity
  readonly rows: readonly FacetedRow[]
}

/**
 * The list's severity groups, in the order the bands interrupt: the only
 * group that must interrupt comes first, the record of what moved comes last.
 * Empty groups render nothing — a band with no rows is not a heading.
 */
export function groupFacetedRows(rows: readonly FacetedRow[]): readonly InboxGroup[] {
  const queue = rows.filter(entry => entry.facet.read === false)
  return INBOX_SEVERITY_ORDER
    .map(severity => ({ severity, rows: queue.filter(entry => entry.facet.severity === severity) }))
    .filter(group => group.rows.length > 0)
}

/**
 * The detail pane's subject: the Task's board title, or the Thread's opening
 * line when the Task has none — a Task created before the board existed — and
 * the opening line alone for a Thread that is only a discussion.
 */
export function inboxDetailSubject(item: AgentTeamInboxItem): string {
  const title = (item.task?.title ?? '').trim()
  return title === '' ? (item.previewText ?? '').trim() : title
}

/**
 * The detail pane's subject line: a Task leads with its own number, the way
 * every Task surface prints it, and its board title is the subject.
 */
export function inboxDetailTitle(item: AgentTeamInboxItem, taskLabel: (number: number) => string): string {
  const subject = inboxDetailSubject(item)
  if (item.taskNumber !== undefined) return subject === '' ? taskLabel(item.taskNumber) : `${taskLabel(item.taskNumber)} ${subject}`
  return subject
}

/** The locale keys each band and reason print; both render through `locales.ts`. */
export const INBOX_SEVERITY_KEYS: Record<InboxSeverity, LocaleKey> = {
  action_required: 'inboxGroupActionRequired',
  attention: 'inboxGroupAttention',
  info: 'inboxGroupInfo',
}

export const INBOX_REASON_KEYS: Record<InboxReason, LocaleKey> = {
  decision: 'inboxReasonDecision',
  review: 'inboxReasonReview',
  mention: 'inboxReasonMention',
  failedTurn: 'inboxReasonFailedTurn',
  activity: 'inboxReasonActivity',
}
