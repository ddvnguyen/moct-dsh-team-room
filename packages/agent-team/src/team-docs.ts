import type {
  AgentTeamDoc,
  AgentTeamDocComment,
  AgentTeamDocCommentRef,
  AgentTeamDocCommentView,
  AgentTeamDocNotice,
  AgentTeamDocReview,
  AgentTeamDocSection,
  AgentTeamDocSectionHistory,
  AgentTeamDocSectionVersion,
  AgentTeamDocSectionView,
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
  /** Every written version of each section, oldest first; the last one is the current text. */
  readonly sectionVersions: ReadonlyMap<string, readonly AgentTeamDocSectionVersion[]>
  readonly comments: readonly { readonly comment: AgentTeamDocComment; readonly occurredAt: string }[]
  readonly delivered: ReadonlySet<AgentTeamDocCommentRef>
  /** Root comments whose thread is closed. */
  readonly resolved: ReadonlySet<AgentTeamDocCommentRef>
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

function sectionVersion(section: AgentTeamDocSection, writer: AgentTeamMemberId, sequence: number, occurredAt: string): AgentTeamDocSectionVersion {
  return Object.freeze({ sequence, writer, heading: section.heading, markdown: section.markdown, occurredAt })
}

export function createdDocState(doc: AgentTeamDoc, sections: readonly AgentTeamDocSection[], occurredAt: string): AgentTeamDocState {
  const sectionVersions = new Map(sections.map(section => [section.sectionId, Object.freeze([sectionVersion(section, doc.author, doc.createdAtSequence, occurredAt)])] as const))
  return Object.freeze({ doc, sections: Object.freeze([...sections]), sectionVersions, comments: Object.freeze([]), delivered: new Set<AgentTeamDocCommentRef>(),
    resolved: new Set<AgentTeamDocCommentRef>(), reviews: Object.freeze([]), status: 'draft' as const, revision: doc.createdAtSequence, updatedAt: occurredAt })
}

/** Replace the section with the same id, or append it when the id is new; the write becomes the section's newest version. */
export function withDocSection(state: AgentTeamDocState, section: AgentTeamDocSection, writer: AgentTeamMemberId, sequence: number, occurredAt: string): AgentTeamDocState {
  const index = state.sections.findIndex(candidate => candidate.sectionId === section.sectionId)
  const sections = index === -1 ? [...state.sections, section] : state.sections.map((candidate, at) => at === index ? section : candidate)
  const sectionVersions = new Map(state.sectionVersions)
  sectionVersions.set(section.sectionId, Object.freeze([...(state.sectionVersions.get(section.sectionId) ?? []), sectionVersion(section, writer, sequence, occurredAt)]))
  return Object.freeze({ ...state, sections: Object.freeze(sections), sectionVersions, revision: sequence, updatedAt: occurredAt })
}

/** The root of the thread a comment belongs to: itself, or the first comment its replies lead back to. */
export function rootDocCommentRef(state: Pick<AgentTeamDocState, 'comments'>, commentRef: AgentTeamDocCommentRef): AgentTeamDocCommentRef {
  const parents = new Map(state.comments.map(({ comment }) => [comment.commentRef, comment.parentCommentRef] as const))
  let current = commentRef
  for (let parent = parents.get(current); parent !== undefined; parent = parents.get(current)) current = parent
  return current
}

export function isDocCommentResolved(state: Pick<AgentTeamDocState, 'comments' | 'resolved'>, commentRef: AgentTeamDocCommentRef): boolean {
  return state.resolved.has(rootDocCommentRef(state, commentRef))
}

export function withDocCommentResolved(state: AgentTeamDocState, commentRef: AgentTeamDocCommentRef, occurredAt: string): AgentTeamDocState {
  return Object.freeze({ ...state, resolved: new Set([...state.resolved, commentRef]), updatedAt: occurredAt })
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

/**
 * The Human's comments no review has delivered yet, oldest first: what the next
 * verdict delivers. A comment in a resolved thread is withdrawn, not pending.
 */
export function pendingDocCommentRefs(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): readonly AgentTeamDocCommentRef[] {
  return state.comments
    .filter(({ comment }) => comment.author === humanMemberId && !state.delivered.has(comment.commentRef) && !isDocCommentResolved(state, comment.commentRef))
    .map(({ comment }) => comment.commentRef)
}

/** Headings of the sections the Human rewrote since the author last submitted: the verdict tells the author to re-read them. */
export function humanEditedDocHeadings(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): readonly string[] {
  const since = state.submittedRevision ?? 0
  return state.sections.filter(section => {
    const latest = state.sectionVersions.get(section.sectionId)?.at(-1)
    return latest !== undefined && latest.writer === humanMemberId && latest.sequence > since
  }).map(section => section.heading)
}

function sectionView(state: AgentTeamDocState, section: AgentTeamDocSection): AgentTeamDocSectionView {
  const latest = state.sectionVersions.get(section.sectionId)?.at(-1)
  return Object.freeze({ ...section, writer: latest?.writer ?? state.doc.author, writtenAtSequence: latest?.sequence ?? state.doc.createdAtSequence })
}

export function docSectionHistory(state: AgentTeamDocState, sectionId: string): AgentTeamDocSectionHistory {
  const versions = state.sectionVersions.get(sectionId)
  if (versions === undefined) throw new Error(`Doc '${state.doc.docRef}' has no section '${sectionId}'`)
  return Object.freeze({ docRef: state.doc.docRef, sectionId, versions: Object.freeze([...versions].reverse()) })
}

export function docView(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): AgentTeamDocView {
  const comments: AgentTeamDocCommentView[] = state.comments.map(({ comment, occurredAt }) => {
    const resolved = isDocCommentResolved(state, comment.commentRef)
    return Object.freeze({ ...comment, occurredAt, resolved,
      pending: comment.author === humanMemberId && !state.delivered.has(comment.commentRef) && !resolved })
  })
  return Object.freeze({ doc: state.doc, humanMemberId, status: state.status, revision: state.revision,
    sections: Object.freeze(state.sections.map(section => sectionView(state, section))),
    comments: Object.freeze(comments), reviews: state.reviews,
    ...(state.submittedRevision === undefined ? {} : { submittedRevision: state.submittedRevision }), updatedAt: state.updatedAt })
}

export function docSummary(state: AgentTeamDocState, humanMemberId: AgentTeamMemberId): AgentTeamDocSummary {
  return Object.freeze({ docRef: state.doc.docRef, channelRef: state.doc.channelRef, threadRef: state.doc.threadRef,
    ...(state.doc.taskRef === undefined ? {} : { taskRef: state.doc.taskRef }), title: state.doc.title,
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
export function docReviewNoticeBody(doc: AgentTeamDoc, authorHandle: string, verdict: AgentTeamDocNotice & { readonly event: 'reviewed' }, note: string | undefined,
  editedHeadings: readonly string[] = []): string {
  const count = verdict.commentRefs.length
  const comments = count === 0 ? '' : ` with ${count} comment${count === 1 ? '' : 's'}`
  const head = verdict.verdict === 'approve'
    ? `@${authorHandle} Approved "${doc.title}" — ${doc.docRef}${comments}. Go ahead with it.`
    : verdict.verdict === 'cancel'
      ? `@${authorHandle} Cancelled "${doc.title}" — ${doc.docRef}${comments}. Stop work on it.`
      : `@${authorHandle} Requested changes on "${doc.title}" — ${doc.docRef}${comments}. Read them with team_doc read, revise, then submit again.`
  const edited = editedHeadings.length === 0 ? '' : ` The Human edited ${editedHeadings.map(heading => `"${heading}"`).join(', ')} since your submit; re-read before you write.`
  return `${head}${edited}${noteBlock(note)}`
}
