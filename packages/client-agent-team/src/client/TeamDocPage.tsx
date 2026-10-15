import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamDocCommentRef,
  AgentTeamDocCommentView,
  AgentTeamDocSectionVersion,
  AgentTeamDocRef,
  AgentTeamDocVerdict,
  AgentTeamDocView,
  AgentTeamMemberId,
  AgentTeamThreadRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconChevronLeftOutlineRegular, IconPanelLeftOutlineRegular, IconSendOutlineRegular, MarkdownText, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { commentThreads, docQuote, docStatusDot, formatDocStatus, isFinalDocStatus, quoteRange } from './team-docs.ts'
import { TeamDocSectionEditor } from './TeamDocSectionEditor.tsx'
import { TeamDocHistory } from './TeamDocHistory.tsx'
import { mintRequestId } from './requests.ts'
import css from './conversation.module.css'
import channelCss from './channel.module.css'
import composerCss from './composer.module.css'
import docCss from './doc.module.css'

interface TeamDocPageProps {
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly threadRef: AgentTeamThreadRef
  readonly humanName: string
  readonly loadDoc: TeamConversationProps['loadDoc']
  readonly commentDoc: TeamConversationProps['commentDoc']
  readonly reviewDoc: TeamConversationProps['reviewDoc']
  readonly writeDocSection: TeamConversationProps['writeDocSection']
  readonly resolveDocComment: TeamConversationProps['resolveDocComment']
  readonly loadDocSectionHistory: TeamConversationProps['loadDocSectionHistory']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  /** Back to the Doc's Thread. */
  readonly backToThread: () => void
  readonly sidebarCollapsed: boolean
  readonly openSidebar: () => void
  readonly t: TeamConversationProps['t']
}

/** A passage the Human selected inside one section, waiting for its comment text. */
interface Selection {
  readonly sectionId: string
  readonly quote: string
}

/** Grow a chat box with its text, up to the same cap the Thread composer uses. */
function grow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`
}

/** Which durable write is in flight; every control waits for its answer. */
type Pending = 'comment' | 'edit' | 'restore' | 'resolve' | AgentTeamDocVerdict | undefined

/** One section open in the editor, with the text the edit started from. */
interface Editing {
  readonly sectionId: string
  readonly baseMarkdown: string
}

/** The CSS Custom Highlight name the commented passages are painted with. */
const COMMENT_HIGHLIGHT = 'team-doc-comment'

/**
 * One Team Document on its own page. The Human selects a passage to comment
 * on it; comments stay pending until one of the three verdicts sends them to
 * the author. The Human may also edit a section, read its history and restore
 * an earlier version, and resolve a comment thread. Every write waits for the Host's answer and the page then
 * re-reads the Doc: nothing here is optimistic, and each verdict is fenced by
 * the Doc revision on screen, so a Doc that moved meanwhile is re-read rather
 * than judged blind.
 */
export function TeamDocPage({ workspaceId, docRef, threadRef, humanName, loadDoc, commentDoc, reviewDoc, writeDocSection, resolveDocComment, loadDocSectionHistory, loadMembers, subscribeChanges, backToThread, sidebarCollapsed, openSidebar, t }: TeamDocPageProps) {
  const [view, setView] = useState<AgentTeamDocView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [selection, setSelection] = useState<Selection>()
  const [commentText, setCommentText] = useState('')
  const [note, setNote] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const [editing, setEditing] = useState<Editing>()
  const [historyFor, setHistoryFor] = useState<string>()
  const [showResolved, setShowResolved] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const sequence = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const mine = ++sequence.current
    const result = await loadDoc({ workspaceId, docRef })
    if (!mounted.current || mine !== sequence.current) return
    if (result.ok) { setView(result.value); setError(undefined) } else setError(result.error.message)
  }, [workspaceId, docRef])

  useEffect(() => {
    mounted.current = true
    void refresh()
    void loadMembers({ workspaceId }).then(result => { if (mounted.current && result.ok) setMembers(result.value) })
    const dispose = subscribeChanges({ kind: 'thread', threadRef }, update => {
      if (!mounted.current) return
      if (update.type === 'failed') { setError(update.message); return }
      void refresh()
    })
    return () => { mounted.current = false; sequence.current += 1; dispose() }
  }, [workspaceId, docRef, threadRef])

  useEffect(() => { if (commentInputRef.current !== null) grow(commentInputRef.current) }, [commentText, selection])
  useEffect(() => { if (noteInputRef.current !== null) grow(noteInputRef.current) }, [note, view?.status])

  // A selection inside one section becomes the comment draft's anchor. A
  // collapsed or cross-section selection leaves the current anchor alone, so
  // focusing the comment box (which collapses the page selection) keeps it.
  useEffect(() => {
    const capture = (): void => {
      const body = bodyRef.current
      const current = document.getSelection()
      if (body === null || current === null || current.isCollapsed || current.rangeCount === 0) return
      const sectionOf = (node: Node | null): HTMLElement | null => {
        const element = node instanceof HTMLElement ? node : node?.parentElement ?? null
        const section = element?.closest<HTMLElement>('[data-doc-section]') ?? null
        return section !== null && body.contains(section) ? section : null
      }
      const anchor = sectionOf(current.anchorNode)
      if (anchor === null || anchor !== sectionOf(current.focusNode)) return
      // Text picked inside the section editor is a draft, not a passage to comment on.
      const element = current.anchorNode instanceof HTMLElement ? current.anchorNode : current.anchorNode?.parentElement
      if (element?.closest('[data-doc-editor]') != null) return
      const quote = docQuote(current.toString())
      const sectionId = anchor.dataset['docSection']
      if (quote === '' || sectionId === undefined) return
      setSelection({ sectionId, quote })
    }
    document.addEventListener('selectionchange', capture)
    return () => { document.removeEventListener('selectionchange', capture) }
  }, [])

  const nameOf = (memberId: AgentTeamMemberId): string => {
    if (memberId === view?.humanMemberId) return humanName
    const member = members.find(status => status.member.memberId === memberId)
    return member === undefined ? memberId : `@${member.member.handle}`
  }
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') },
    footnotes: t('markdownFootnotes'),
  }), [t])

  const addComment = async (): Promise<void> => {
    if (view === undefined || selection === undefined || commentText.trim() === '' || pending !== undefined) return
    setPending('comment')
    setNotice(undefined)
    const result = await commentDoc({ requestId: mintRequestId(), workspaceId, docRef: view.doc.docRef, sectionId: selection.sectionId,
      quote: selection.quote, body: commentText })
    if (!mounted.current) return
    setPending(undefined)
    if (!result.ok) { setError(result.error.message); return }
    setCommentText('')
    setSelection(undefined)
    document.getSelection()?.removeAllRanges()
    await refresh()
  }

  const review = async (verdict: AgentTeamDocVerdict): Promise<void> => {
    if (view === undefined || pending !== undefined) return
    setPending(verdict)
    setNotice(undefined)
    const result = await reviewDoc({ requestId: mintRequestId(), workspaceId, docRef: view.doc.docRef, docRevision: view.revision, verdict,
      ...(note.trim() === '' ? {} : { note }) })
    if (!mounted.current) return
    setPending(undefined)
    setConfirmingCancel(false)
    if (!result.ok) { setError(result.error.message); return }
    if (result.value.kind === 'stale_doc_revision') setNotice(t('docStale'))
    else setNote('')
    await refresh()
  }

  const saveSection = async (sectionId: string, heading: string, markdown: string, kind: 'edit' | 'restore'): Promise<void> => {
    if (view === undefined || pending !== undefined) return
    setPending(kind)
    setNotice(undefined)
    const result = await writeDocSection({ requestId: mintRequestId(), workspaceId, docRef: view.doc.docRef, baseDocRevision: view.revision,
      sectionId, heading, markdown })
    if (!mounted.current) return
    setPending(undefined)
    if (!result.ok) { setError(result.error.message); return }
    // A stale save keeps the editor open: the re-read puts the newer text above the draft.
    if (result.value.kind === 'stale_doc_revision') setNotice(t('docStale'))
    else if (kind === 'edit') setEditing(undefined)
    await refresh()
  }

  const resolveThread = async (commentRef: AgentTeamDocCommentRef): Promise<void> => {
    if (view === undefined || pending !== undefined) return
    setPending('resolve')
    setNotice(undefined)
    const result = await resolveDocComment({ requestId: mintRequestId(), workspaceId, docRef: view.doc.docRef, commentRef })
    if (!mounted.current) return
    setPending(undefined)
    if (!result.ok) { setError(result.error.message); return }
    await refresh()
  }

  // Paint each open comment's passage where the text still holds it. The
  // highlight is a CSS Custom Highlight over the rendered Markdown, so the
  // Markdown DOM itself is never rewritten; browsers without the API skip it.
  useEffect(() => {
    const body = bodyRef.current
    const registry = typeof CSS === 'undefined' ? undefined : (CSS as { highlights?: Map<string, unknown> }).highlights
    const HighlightType = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (body === null || view === undefined || registry === undefined || HighlightType === undefined) return
    const ranges = view.comments.filter(comment => comment.parentCommentRef === undefined && !comment.resolved && comment.quote !== '').flatMap(comment => {
      const section = body.querySelector(`[data-doc-section="${CSS.escape(comment.sectionId)}"] [data-doc-section-body]`)
      const range = section === null ? undefined : quoteRange(section, comment.quote)
      return range === undefined ? [] : [range]
    })
    registry.set(COMMENT_HIGHLIGHT, new HighlightType(...ranges))
    return () => { registry.delete(COMMENT_HIGHLIGHT) }
  }, [view, editing])

  const onCommentKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void addComment() }
    if (event.key === 'Escape') { setSelection(undefined); setCommentText('') }
  }

  const pendingCount = view?.comments.filter(comment => comment.pending).length ?? 0
  const final = view !== undefined && isFinalDocStatus(view.status)
  const reviewBlocked = pendingCount === 0 && note.trim() === ''
  const threads = view === undefined ? [] : commentThreads(view.comments)
  const resolvedCount = threads.filter(({ root }) => root.resolved).length
  const sectionHeading = (sectionId: string): string => view?.sections.find(section => section.sectionId === sectionId)?.heading ?? sectionId
  const commentRow = (comment: AgentTeamDocCommentView, reply: boolean) => <li key={comment.commentRef} className={reply ? docCss.commentReply : docCss.comment} data-team-doc-comment={comment.commentRef}>
    <div className={docCss.commentHead}>
      <span className={docCss.commentAuthor}>{nameOf(comment.author)}</span>
      {!reply && <span className={docCss.commentSection}>{sectionHeading(comment.sectionId)}</span>}
      {!reply && comment.resolved ? <span className={docCss.badge}>{t('docResolvedBadge')}</span>
        : comment.pending ? <span className={docCss.badgePending}>{t('docPendingBadge')}</span>
        : comment.author === view?.humanMemberId ? <span className={docCss.badge}>{t('docDeliveredBadge')}</span> : null}
    </div>
    {comment.quote !== '' && <blockquote className={docCss.commentQuote}>{comment.quote}</blockquote>}
    <p className={docCss.commentBody}>{comment.body}</p>
    {!reply && !comment.resolved && !final && <div className={docCss.reviewActions}>
      <Button size="sm" variant="ghost" disabled={pending !== undefined} onClick={() => { void resolveThread(comment.commentRef) }}>{t('docResolve')}</Button>
    </div>}
  </li>

  return <main className={css.surface} data-team-doc={docRef}>
    <div className={css.surfaceHeader}>
      <header className={channelCss.slimHeader} data-team-slim-header="doc">
        {sidebarCollapsed && <Button size="sm" variant="outline" icon={<IconPanelLeftOutlineRegular size={16} />} aria-label={t('openSidebar')} onClick={openSidebar} />}
        <button type="button" className={channelCss.slimCrumb} aria-label={t('docBack')} title={t('docBack')} onClick={backToThread}>
          <IconChevronLeftOutlineRegular size={14} />
          <span className={channelCss.slimCrumbText}>{view?.doc.title ?? t('docBack')}</span>
        </button>
        {view !== undefined && <span className={docCss.headerMeta}>
          <Pill><TeamStateDot size={8} state={docStatusDot(view.status)} />{formatDocStatus(view.status, t)}</Pill>
          <span className={docCss.revision}>{t('docRevision', { revision: view.revision })}</span>
        </span>}
      </header>
    </div>

    <section className={css.timeline} aria-label={view?.doc.title ?? t('docsLabel')}>
      {view === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('docLoading')}</p></div>}
      {error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { setError(undefined); void refresh() }}>{t('retry')}</Button></div>}
      {view !== undefined && <div className={docCss.layout}>
        <article className={docCss.document} ref={bodyRef} aria-label={view.doc.title}>
          <h1 className={docCss.title}>{view.doc.title}</h1>
          {view.sections.map(section => <section key={section.sectionId} className={docCss.section} data-doc-section={section.sectionId}
            aria-labelledby={`doc-${section.sectionId}`}>
            <div className={docCss.sectionHead}>
              <h2 id={`doc-${section.sectionId}`} className={docCss.sectionHeading}>{section.heading}</h2>
              <span className={docCss.sectionActions}>
                {!final && editing?.sectionId !== section.sectionId && <Button size="sm" variant="ghost" disabled={pending !== undefined}
                  aria-label={t('docEditSectionNamed', { heading: section.heading })}
                  onClick={() => { setEditing({ sectionId: section.sectionId, baseMarkdown: section.markdown }) }}>{t('docEditSection')}</Button>}
                <Button size="sm" variant="ghost" aria-label={t('docHistoryNamed', { heading: section.heading })} aria-pressed={historyFor === section.sectionId}
                  onClick={() => { setHistoryFor(current => current === section.sectionId ? undefined : section.sectionId) }}>{t('docHistory')}</Button>
              </span>
            </div>
            {section.writer !== view.doc.author && <p className={docCss.editedBy}>{t('docEditedBy', { name: nameOf(section.writer) })}</p>}
            {editing?.sectionId === section.sectionId
              ? <TeamDocSectionEditor key={section.sectionId} section={section} baseMarkdown={editing.baseMarkdown} saving={pending === 'edit'}
                save={(heading, markdown) => { void saveSection(section.sectionId, heading, markdown, 'edit') }}
                cancel={() => { setEditing(undefined) }} markdownLabels={markdownLabels} t={t} />
              : section.markdown === ''
                ? <p className={docCss.emptySection}>{t('docEmptySection')}</p>
                : <div className={`${css.messageMarkdown} ${docCss.markdown}`} data-doc-section-body><MarkdownText key={section.markdown} text={section.markdown} labels={markdownLabels} /></div>}
          </section>)}
        </article>

        <aside className={docCss.side} aria-label={t('docCommentsHeading')}>
          {historyFor !== undefined && view.sections.some(section => section.sectionId === historyFor) && <TeamDocHistory key={historyFor}
            workspaceId={workspaceId} docRef={view.doc.docRef} sectionId={historyFor} heading={sectionHeading(historyFor)} revision={view.revision}
            loadHistory={loadDocSectionHistory} nameOf={nameOf} restoring={pending === 'restore'} close={() => { setHistoryFor(undefined) }} t={t}
            {...(final ? {} : { restore: (version: AgentTeamDocSectionVersion) => { void saveSection(historyFor, version.heading, version.markdown, 'restore') } })} />}
          {!final && (selection === undefined
            ? <section className={docCss.panel}><p className={docCss.hint}>{t('docSelectionHint')}</p></section>
            : <form className={docCss.chatCard} onSubmit={event => { event.preventDefault(); void addComment() }} data-team-doc-comment-box>
              <div className={docCss.chatQuoteRow}>
                <p className={docCss.selectionQuote}>{t('docSelectionQuote', { quote: selection.quote })}</p>
                <button type="button" className={docCss.chatClear} aria-label={t('docClearSelection')} title={t('docClearSelection')}
                  onClick={() => { setSelection(undefined); setCommentText('') }} disabled={pending !== undefined}>×</button>
              </div>
              <textarea id="team-doc-comment" ref={commentInputRef} className={docCss.chatInput} rows={1} value={commentText}
                aria-label={t('docCommentLabel')} placeholder={t('docCommentPlaceholder')}
                onChange={event => { setCommentText(event.target.value) }} onKeyDown={onCommentKey} disabled={pending !== undefined} />
              <div className={docCss.chatToolbar}>
                <span className={docCss.chatHint}>{t('docCommentShortcut')}</span>
                <button type="submit" className={composerCss.sendButton} aria-label={pending === 'comment' ? t('docAddingComment') : t('docAddComment')}
                  disabled={pending !== undefined || commentText.trim() === ''}>
                  <IconSendOutlineRegular size={16} />
                </button>
              </div>
            </form>)}

          <section className={docCss.panel}>
            <h2 className={docCss.panelHeading}>{t('docCommentsHeading')}</h2>
            {view.comments.length === 0
              ? <p className={docCss.hint}>{t('docNoComments')}</p>
              : <ul className={docCss.commentList}>
                {threads.filter(({ root }) => showResolved || !root.resolved).map(({ root, replies }) => <li key={root.commentRef}
                  className={root.resolved ? `${docCss.commentThread} ${docCss.resolvedThread}` : docCss.commentThread}>
                  <ul className={docCss.commentList}>{commentRow(root, false)}{replies.map(reply => commentRow(reply, true))}</ul>
                </li>)}
              </ul>}
            {resolvedCount > 0 && <button type="button" className={docCss.resolvedToggle} aria-expanded={showResolved}
              onClick={() => { setShowResolved(current => !current) }}>
              {showResolved ? t('docHideResolved') : t('docShowResolved', { count: resolvedCount })}
            </button>}
          </section>
        </aside>
      </div>}
    </section>

    {view !== undefined && <footer className={`${composerCss.root} ${docCss.reviewBar}`} aria-label={t('docVerdictActions')}>
      {notice !== undefined && <p className={docCss.notice} role="status">{notice}</p>}
      {final
        ? <p className={docCss.hint}>{t('docFinal', { status: formatDocStatus(view.status, t) })}</p>
        : <div className={composerCss.card} data-team-doc-review>
          {view.status === 'draft' && <p className={docCss.reviewHint}>{t('docNotSubmitted')}</p>}
          <div className={composerCss.inputArea}>
            <textarea id="team-doc-note" ref={noteInputRef} rows={1} value={note} aria-label={t('docReviewNoteLabel')} placeholder={t('docReviewNotePlaceholder')}
              onChange={event => { setNote(event.target.value) }} disabled={pending !== undefined} />
          </div>
          <div className={docCss.reviewToolbar}>
            <span className={docCss.chatHint}>{reviewBlocked ? t('docReviewNeedsComment') : t('docReviewHint', { count: pendingCount })}</span>
            <div className={docCss.reviewActions}>
              {confirmingCancel
                ? <Button size="sm" variant="outline" className={docCss.danger} disabled={pending !== undefined} onClick={() => { void review('cancel') }}>{t('docConfirmCancel')}</Button>
                : <Button size="sm" variant="ghost" disabled={pending !== undefined} onClick={() => { setConfirmingCancel(true) }}>{t('docCancel')}</Button>}
              <Button size="sm" variant="outline" disabled={pending !== undefined || reviewBlocked} onClick={() => { void review('review') }}>{t('docRequestReview')}</Button>
              <Button size="sm" variant="primary" disabled={pending !== undefined} onClick={() => { void review('approve') }}>{t('docApprove')}</Button>
            </div>
          </div>
        </div>}
    </footer>}
  </main>
}
