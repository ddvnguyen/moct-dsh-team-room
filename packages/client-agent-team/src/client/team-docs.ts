import type { AgentTeamDocCommentRef, AgentTeamDocCommentView, AgentTeamDocStatus } from '@ddvnguyen/moct-dsh-team-room/types'
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

/** Root comments in order, each with every reply under it (replies to replies included) in order. */
export function commentThreads(comments: readonly AgentTeamDocCommentView[]): ReadonlyArray<{ readonly root: AgentTeamDocCommentView; readonly replies: readonly AgentTeamDocCommentView[] }> {
  const parents = new Map(comments.map(comment => [comment.commentRef, comment.parentCommentRef] as const))
  const rootOf = (comment: AgentTeamDocCommentView): AgentTeamDocCommentRef => {
    let current = comment.commentRef
    for (let parent = parents.get(current); parent !== undefined; parent = parents.get(current)) current = parent
    return current
  }
  return comments.filter(comment => comment.parentCommentRef === undefined)
    .map(root => ({ root, replies: comments.filter(comment => comment.parentCommentRef !== undefined && rootOf(comment) === root.commentRef) }))
}

/** The longest quote a comment keeps: enough to find the passage again, short enough to read in a list. */
export const DOC_QUOTE_LIMIT = 280

/** One selected passage as a comment quotes it: whitespace collapsed, capped at the limit. */
export function docQuote(selected: string): string {
  const collapsed = selected.replace(/\s+/g, ' ').trim()
  return collapsed.length <= DOC_QUOTE_LIMIT ? collapsed : `${collapsed.slice(0, DOC_QUOTE_LIMIT - 1)}…`
}

/**
 * The passage a comment quotes, found again in the rendered section: the first
 * match of the quote against the section's text with whitespace collapsed the
 * way `docQuote` collapsed it. A quote cut at the limit matches by its kept
 * head. Undefined when the text no longer contains it.
 */
export function quoteRange(container: Node, quote: string): Range | undefined {
  const needle = quote.endsWith('…') ? quote.slice(0, -1) : quote
  if (needle === '') return undefined
  const positions: { readonly node: Text; readonly offset: number }[] = []
  let text = ''
  const walker = container.ownerDocument?.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  if (walker === undefined) return undefined
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = (node as Text).data
    for (let offset = 0; offset < value.length; offset += 1) {
      const space = /\s/.test(value[offset]!)
      if (space && (text === '' || text.endsWith(' '))) continue
      text += space ? ' ' : value[offset]!
      positions.push({ node: node as Text, offset })
    }
  }
  const start = text.indexOf(needle)
  if (start === -1) return undefined
  const first = positions[start]!
  const last = positions[start + needle.length - 1]!
  const range = container.ownerDocument!.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}
