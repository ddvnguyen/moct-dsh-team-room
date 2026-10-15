import type { AgentTeamDocCommentView, AgentTeamDocStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from './slots.ts'
import type { TeamStateDotState } from './TeamStateDot.tsx'

const STATUS_KEYS = {
  draft: 'docStatusDraft',
  in_review: 'docStatusInReview',
  changes_requested: 'docStatusChangesRequested',
  approved: 'docStatusApproved',
  cancelled: 'docStatusCancelled',
} as const satisfies Record<AgentTeamDocStatus, string>

export function formatDocStatus(status: AgentTeamDocStatus, t: TeamConversationProps['t']): string {
  return t(STATUS_KEYS[status])
}

/** Dot state for a Doc's status, on the same scale the Task pill uses. */
export function docStatusDot(status: AgentTeamDocStatus): TeamStateDotState {
  return ({ draft: 'todo', in_review: 'warning', changes_requested: 'ongoing', approved: 'done', cancelled: 'quiet' } as const)[status]
}

export function isFinalDocStatus(status: AgentTeamDocStatus): boolean {
  return status === 'approved' || status === 'cancelled'
}

/** Root comments in order, each with its replies in order. */
export function commentThreads(comments: readonly AgentTeamDocCommentView[]): ReadonlyArray<{ readonly root: AgentTeamDocCommentView; readonly replies: readonly AgentTeamDocCommentView[] }> {
  return comments.filter(comment => comment.parentCommentRef === undefined)
    .map(root => ({ root, replies: comments.filter(comment => comment.parentCommentRef === root.commentRef) }))
}

/** The longest quote a comment keeps: enough to find the passage again, short enough to read in a list. */
export const DOC_QUOTE_LIMIT = 280

/** One selected passage as a comment quotes it: whitespace collapsed, capped at the limit. */
export function docQuote(selected: string): string {
  const collapsed = selected.replace(/\s+/g, ' ').trim()
  return collapsed.length <= DOC_QUOTE_LIMIT ? collapsed : `${collapsed.slice(0, DOC_QUOTE_LIMIT - 1)}…`
}
