import type {
  AgentTeamDoc,
  AgentTeamDocComment,
  AgentTeamDocCommentRef,
  AgentTeamDocCommentView,
  AgentTeamDocNotice,
  AgentTeamDocReview,
  AgentTeamDocSection,
  AgentTeamDocStatus,
  AgentTeamDocSummary,
  AgentTeamDocView,
  AgentTeamMemberId,
  AgentTeamMessageRef,
} from './types.ts'

/**
 * Replay-derived state of one Team Document. The ledger rebuilds it from the
 * Doc's own operations plus the submit and review notices carried by Thread
 * replies; it is never a second durable authority.
 */
export interface AgentTeamDocState {
  readonly doc: AgentTeamDoc
  readonly sections: readonly AgentTeamDocSection[]
  readonly comments: readonly { readonly comment: AgentTeamDocComment; readonly occurredAt: string }[]
  readonly delivered: ReadonlySet<AgentTeamDocCommentRef>
  readonly reviews: readonly AgentTeamDocReview[]
  readonly status: AgentTeamDocStatus
  /** Sequence of the latest creation or section write. */
  readonly revision: number
  readonly submittedRevision?: number
  readonly updatedAt: string
}

/** `approved` and `cancelled` end a Doc: nothing writes, comments, submits or reviews after them. */
export function isFinalDocStatus(status: AgentTeamDocStatus): boolean {
  return status === 'approved' || status === 'cancelled'
}

/** The id the next appended section takes: one past the highest id the Doc ever used. */
export function nextDocSectionId(state: Pick<AgentTeamDocState, 'sections'>): string {
  return `s${state.sections.length + 1}`
}

/** Outline sections for a new Doc: `s1`…`sN`, headings in order, bodies empty. */
export function outlineSections(outline: readonly string[]): readonly AgentTeamDocSection[] {
  return Object.freeze(outline.map((heading, index) => Object.freeze({ sectionId: `s${index + 1}`, heading, markdown: '' })))
}

export function createdDocState(doc: AgentTeamDoc, sections: readonly AgentTeamDocSection[], occurredAt: string): AgentTeamDocState {
  return Object.freeze({ doc, sections: Object.freeze([...sections]), comments: Object.freeze([]), delivered: new Set<AgentTeamDocCommentRef>(),
    reviews: Object.freeze([]), status: 'draft' as const, revision: doc.createdAtSequence, updatedAt: occurredAt })
}

/** Replace the section with the same id, or append it when the id is new. */
export function withDocSection(state: AgentTeamDocState, section: AgentTeamDocSection, sequence: number, occurredAt: string): AgentTeamDocState {
  const index = state.sections.findIndex(candidate => candidate.sectionId === section.sectionId)
  const sections = index === -1 ? [...state.sections, section] : state.sections.map((candidate, at) => at === index ? section : candidate)
  return Object.freeze({ ...state, sections: Object.freeze(sections), revision: sequence, updatedAt: occurredAt })
}

export function withDocComment(state: AgentTeamDocState, comment: AgentTeamDocComment, occurredAt: string): AgentTeamDocState {
  return Object.freeze({ ...state, comments: Object.freeze([...state.comments, Object.freeze({ comment, occurredAt })]), updatedAt: occurredAt })
}

/** Apply one submit or review notice: the status it moves to, and the comments a review delivered. */
export function withDocNotice(state: AgentTeamDocState, notice: AgentTeamDocNotice, messageRef: AgentTeamMessageRef, sequence: number, occurredAt: string): AgentTeamDocState {
  if (notice.event === 'submitted') {
    return Object.freeze({ ...state, status: 'in_review' as const, submittedRevision: notice.docRevision, updatedAt: occurredAt })
  }
  const status: AgentTeamDocStatus = notice.verdict === 'approve' ? 'approved' : notice.verdict === 'cancel' ? 'cancelled' : 'changes_requested'
  const review: AgentTeamDocReview = Object.freeze({ sequence, messageRef, verdict: notice.verdict, docRevision: notice.docRevision,
    commentRefs: Object.freeze([...notice.commentRefs]), occurredAt })
  return Object.freeze({ ...state, status, delivered: new Set([...state.delivered, ...notice.commentRefs]),
    reviews: Object.freeze([...state.reviews, review]), updatedAt: occurredAt })
}

/** The Human's comments no review has delivered yet, oldest first: what the next verdict delivers. */
export function pendingDocCommentRefs(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): readonly AgentTeamDocCommentRef[] {
  return state.comments
    .filter(({ comment }) => comment.author === humanMemberId && !state.delivered.has(comment.commentRef))
    .map(({ comment }) => comment.commentRef)
}

export function docView(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): AgentTeamDocView {
  const comments: AgentTeamDocCommentView[] = state.comments.map(({ comment, occurredAt }) => Object.freeze({ ...comment, occurredAt,
    pending: comment.author === humanMemberId && !state.delivered.has(comment.commentRef) }))
  return Object.freeze({ doc: state.doc, status: state.status, revision: state.revision, sections: state.sections,
    comments: Object.freeze(comments), reviews: state.reviews,
    ...(state.submittedRevision === undefined ? {} : { submittedRevision: state.submittedRevision }), updatedAt: state.updatedAt })
}

export function docSummary(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): AgentTeamDocSummary {
  return Object.freeze({ docRef: state.doc.docRef, channelRef: state.doc.channelRef, threadRef: state.doc.threadRef, title: state.doc.title,
    author: state.doc.author, status: state.status, revision: state.revision, sectionCount: state.sections.length,
    pendingCommentCount: pendingDocCommentRefs(state, humanMemberId).length, updatedAt: state.updatedAt })
}

/** One optional note, trimmed; an empty note is no note. */
function noteBlock(note: string | undefined): string {
  const trimmed = note?.trim() ?? ''
  return trimmed === '' ? '' : `\n\n${trimmed}`
}

/** The Thread notice a submit posts: it mentions the Human, which puts the Doc in their Inbox. */
export function docSubmitNoticeBody(doc: AgentTeamDoc, humanHandle: string, docRevision: number, note: string | undefined): string {
  return `@${humanHandle} Please review "${doc.title}" — ${doc.docRef} (revision ${docRevision}).${noteBlock(note)}`
}

/** The Thread notice a review posts: it mentions the author, which wakes it with the verdict. */
export function docReviewNoticeBody(doc: AgentTeamDoc, authorHandle: string, verdict: AgentTeamDocNotice & { readonly event: 'reviewed' }, note: string | undefined): string {
  const count = verdict.commentRefs.length
  const comments = count === 0 ? '' : ` with ${count} comment${count === 1 ? '' : 's'}`
  const head = verdict.verdict === 'approve'
    ? `@${authorHandle} Approved "${doc.title}" — ${doc.docRef}${comments}. Go ahead with it.`
    : verdict.verdict === 'cancel'
      ? `@${authorHandle} Cancelled "${doc.title}" — ${doc.docRef}${comments}. Stop work on it.`
      : `@${authorHandle} Requested changes on "${doc.title}" — ${doc.docRef}${comments}. Read them with team_doc read, revise, then submit again.`
  return `${head}${noteBlock(note)}`
}
