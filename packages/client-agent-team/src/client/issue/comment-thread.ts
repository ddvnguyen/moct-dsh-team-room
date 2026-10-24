import type { AgentTeamIssueComment, AgentTeamIssueDecision, AgentTeamMessageRef } from '@ddvnguyen/moct-dsh-team-room/types'

/**
 * The ask message of every decision row.
 *
 * A `card` row is an ask with no record yet; a `decision` row carries the card
 * it came from when the decision came from an ask. A plan approval is a record
 * with no card, and owns no message at all.
 *
 * The set is what the comment region skips: the decision region owns the ask,
 * so the ask is a card there and never a comment here.
 */
export function decisionAskMessageRefs(decisions: readonly AgentTeamIssueDecision[]): ReadonlySet<AgentTeamMessageRef> {
  const refs = new Set<AgentTeamMessageRef>()
  for (const row of decisions) {
    const card = row.kind === 'card' ? row.card : row.card
    if (card !== undefined) refs.add(card.messageRef)
  }
  return refs
}

/** One comment of the issue's thread, with the replies that answer it. */
export interface IssueComment {
  /** The message fact, as the Host recorded it. */
  readonly fact: AgentTeamIssueComment
  /** The replies that answer this comment. Never nested deeper than one level. */
  readonly replies: readonly IssueComment[]
  /**
   * The comment answers a message that is not on screen — the parent sits on an
   * older page, or the decision region owns it. The row then stands at root
   * level and keeps its quote, so the conversation never loses a reply.
   */
  readonly orphan: boolean
}

/** The issue's comment thread: the root comments, oldest first. */
export interface IssueCommentThread {
  readonly roots: readonly IssueComment[]
}

/**
 * The thread of one issue's comments, derived from the facts alone.
 *
 * The Host records one parent per message (`replyToMessageRef`) and writes
 * `topLevel: false` on every reply it commits — including a reply with no
 * parent — so the parent ref is the only thing that says "this answers that".
 * A message with no parent is a root comment; a message with one is a reply.
 *
 * The tree is cut at one level: a reply whose parent is itself a reply hangs
 * under that parent's nearest root, so no row is ever indented twice. The
 * ledger permits a reply to a reply; the card renders one level, and a reply
 * whose parent is not on screen stands at root level with its quote.
 */
export function buildCommentThread(facts: readonly AgentTeamIssueComment[], askRefs: ReadonlySet<AgentTeamMessageRef>): IssueCommentThread {
  const kept = facts.filter(fact => !askRefs.has(fact.message.messageRef))
  const byRef = new Map<AgentTeamMessageRef, AgentTeamIssueComment>()
  for (const fact of kept) byRef.set(fact.message.messageRef, fact)

  const roots: IssueComment[] = []
  const rootByRef = new Map<AgentTeamMessageRef, IssueComment>()
  const repliesByRoot = new Map<AgentTeamMessageRef, IssueComment[]>()

  const ordered = [...kept].sort((left, right) => left.message.sequence - right.message.sequence)
  for (const fact of ordered) {
    const parentRef = fact.message.replyToMessageRef
    if (parentRef === undefined) {
      const root: IssueComment = { fact, replies: [], orphan: false }
      roots.push(root)
      rootByRef.set(fact.message.messageRef, root)
      continue
    }
    const parent = byRef.get(parentRef)
    // The parent is not on screen: the row stands at root level and keeps its
    // quote, rather than disappearing until the older page arrives.
    if (parent === undefined) {
      const orphan: IssueComment = { fact, replies: [], orphan: true }
      roots.push(orphan)
      rootByRef.set(fact.message.messageRef, orphan)
      continue
    }
    // The parent is itself a reply: the tree is cut one level deep, and the
    // reply hangs under the parent's nearest root.
    const root = rootByRef.get(parent.message.messageRef) ?? nearestRoot(parent, rootByRef, byRef)
    if (root === undefined) {
      const orphan: IssueComment = { fact, replies: [], orphan: true }
      roots.push(orphan)
      rootByRef.set(fact.message.messageRef, orphan)
      continue
    }
    const reply: IssueComment = { fact, replies: [], orphan: false }
    const siblings = repliesByRoot.get(root.fact.message.messageRef) ?? []
    siblings.push(reply)
    repliesByRoot.set(root.fact.message.messageRef, siblings)
  }

  const withReplies = roots.map(root => {
    const replies = repliesByRoot.get(root.fact.message.messageRef) ?? []
    return { ...root, replies }
  })
  return { roots: withReplies }
}

/**
 * The root a reply chain ends at, walking up through the replies already
 * placed. A chain whose root is not on screen resolves to nothing.
 */
function nearestRoot(
  fact: AgentTeamIssueComment,
  rootByRef: ReadonlyMap<AgentTeamMessageRef, IssueComment>,
  byRef: ReadonlyMap<AgentTeamMessageRef, AgentTeamIssueComment>,
): IssueComment | undefined {
  const seen = new Set<AgentTeamMessageRef>()
  let current = fact
  while (current.message.replyToMessageRef !== undefined) {
    if (seen.has(current.message.messageRef)) return undefined
    seen.add(current.message.messageRef)
    const parent = byRef.get(current.message.replyToMessageRef)
    if (parent === undefined) return undefined
    const root = rootByRef.get(parent.message.messageRef)
    if (root !== undefined) return root
    current = parent
  }
  return rootByRef.get(current.message.messageRef)
}

/**
 * One message fact of a committed write, shaped like the facts the read model
 * carries. The write answers with the Message it committed; the region shows
 * that Message without waiting for the next read.
 */
export function committedCommentFact(
  message: AgentTeamIssueComment['message'],
  mentions: AgentTeamIssueComment['mentions'],
): AgentTeamIssueComment {
  return { kind: 'message', sequence: message.sequence, message, mentions, occurredAt: message.occurredAt }
}
