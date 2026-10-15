import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamDocCommentView,
  AgentTeamDocRef,
  AgentTeamDocVerdict,
  AgentTeamDocView,
  AgentTeamMemberId,
  AgentTeamThreadRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconChevronLeftOutlineRegular, IconPanelLeftOutlineRegular, MarkdownText, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { commentThreads, docQuote, docStatusDot, formatDocStatus, isFinalDocStatus } from './team-docs.ts'
import { mintRequestId } from './requests.ts'
import css from './conversation.module.css'
import channelCss from './channel.module.css'
import docCss from './doc.module.css'

interface TeamDocPageProps {
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly threadRef: AgentTeamThreadRef
  readonly humanName: string
  readonly loadDoc: TeamConversationProps['loadDoc']
  readonly commentDoc: TeamConversationProps['commentDoc']
  readonly reviewDoc: TeamConversationProps['reviewDoc']
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

/** Which durable write is in flight; every control waits for its answer. */
type Pending = 'comment' | AgentTeamDocVerdict | undefined

/**
 * One Team Document on its own page. The Human selects a passage to comment
 * on it; comments stay pending until one of the three verdicts sends them to
 * the author. Every write waits for the Host's answer and the page then
 * re-reads the Doc: nothing here is optimistic, and each verdict is fenced by
 * the Doc revision on screen, so a Doc that moved meanwhile is re-read rather
 * than judged blind.
 */
export function TeamDocPage({ workspaceId, docRef, threadRef, humanName, loadDoc, commentDoc, reviewDoc, loadMembers, subscribeChanges, backToThread, sidebarCollapsed, openSidebar, t }: TeamDocPageProps) {
  const [view, setView] = useState<AgentTeamDocView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [selection, setSelection] = useState<Selection>()
  const [commentText, setCommentText] = useState('')
  const [note, setNote] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
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

  const onCommentKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void addComment() }
    if (event.key === 'Escape') { setSelection(undefined); setCommentText('') }
  }

  const pendingCount = view?.comments.filter(comment => comment.pending).length ?? 0
  const final = view !== undefined && isFinalDocStatus(view.status)
  const reviewBlocked = pendingCount === 0 && note.trim() === ''
  const sectionHeading = (sectionId: string): string => view?.sections.find(section => section.sectionId === sectionId)?.heading ?? sectionId
  const commentRow = (comment: AgentTeamDocCommentView, reply: boolean) => <li key={comment.commentRef} className={reply ? docCss.commentReply : docCss.comment} data-team-doc-comment={comment.commentRef}>
    <div className={docCss.commentHead}>
      <span className={docCss.commentAuthor}>{nameOf(comment.author)}</span>
      {!reply && <span className={docCss.commentSection}>{sectionHeading(comment.sectionId)}</span>}
      {comment.pending ? <span className={docCss.badgePending}>{t('docPendingBadge')}</span>
        : comment.author === view?.humanMemberId ? <span className={docCss.badge}>{t('docDeliveredBadge')}</span> : null}
    </div>
    {comment.quote !== '' && <blockquote className={docCss.commentQuote}>{comment.quote}</blockquote>}
    <p className={docCss.commentBody}>{comment.body}</p>
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
            <h2 id={`doc-${section.sectionId}`} className={docCss.sectionHeading}>{section.heading}</h2>
            {section.markdown === ''
              ? <p className={docCss.emptySection}>{t('docEmptySection')}</p>
              : <div className={`${css.messageMarkdown} ${docCss.markdown}`}><MarkdownText key={section.markdown} text={section.markdown} labels={markdownLabels} /></div>}
          </section>)}
        </article>

        <aside className={docCss.side} aria-label={t('docCommentsHeading')}>
          {!final && <section className={docCss.panel}>
            {selection === undefined
              ? <p className={docCss.hint}>{t('docSelectionHint')}</p>
              : <form className={docCss.commentForm} onSubmit={event => { event.preventDefault(); void addComment() }}>
                <p className={docCss.selectionQuote}>{t('docSelectionQuote', { quote: selection.quote })}</p>
                <label className={docCss.fieldLabel} htmlFor="team-doc-comment">{t('docCommentLabel')}</label>
                <textarea id="team-doc-comment" ref={commentInputRef} className={docCss.textarea} rows={3} value={commentText}
                  onChange={event => { setCommentText(event.target.value) }} onKeyDown={onCommentKey} disabled={pending !== undefined} />
                <div className={docCss.formActions}>
                  <Button size="sm" variant="ghost" onClick={() => { setSelection(undefined); setCommentText('') }} disabled={pending !== undefined}>{t('docClearSelection')}</Button>
                  <Button size="sm" variant="primary" type="submit" disabled={pending !== undefined || commentText.trim() === ''}>
                    {pending === 'comment' ? t('docAddingComment') : t('docAddComment')}
                  </Button>
                </div>
              </form>}
          </section>}

          <section className={docCss.panel}>
            <h2 className={docCss.panelHeading}>{t('docCommentsHeading')}</h2>
            {view.comments.length === 0
              ? <p className={docCss.hint}>{t('docNoComments')}</p>
              : <ul className={docCss.commentList}>
                {commentThreads(view.comments).map(({ root, replies }) => <li key={root.commentRef} className={docCss.commentThread}>
                  <ul className={docCss.commentList}>{commentRow(root, false)}{replies.map(reply => commentRow(reply, true))}</ul>
                </li>)}
              </ul>}
          </section>
        </aside>
      </div>}
    </section>

    {view !== undefined && <footer className={docCss.reviewBar} aria-label={t('docVerdictActions')}>
      {notice !== undefined && <p className={docCss.notice} role="status">{notice}</p>}
      {final
        ? <p className={docCss.hint}>{t('docFinal', { status: formatDocStatus(view.status, t) })}</p>
        : <>
          {view.status === 'draft' && <p className={docCss.hint}>{t('docNotSubmitted')}</p>}
          <label className={docCss.fieldLabel} htmlFor="team-doc-note">{t('docReviewNoteLabel')}</label>
          <textarea id="team-doc-note" className={docCss.textarea} rows={2} value={note} onChange={event => { setNote(event.target.value) }} disabled={pending !== undefined} />
          <p className={docCss.hint}>{reviewBlocked ? t('docReviewNeedsComment') : t('docReviewHint', { count: pendingCount })}</p>
          <div className={docCss.reviewActions}>
            {confirmingCancel
              ? <Button size="sm" variant="outline" className={docCss.danger} disabled={pending !== undefined} onClick={() => { void review('cancel') }}>{t('docConfirmCancel')}</Button>
              : <Button size="sm" variant="ghost" disabled={pending !== undefined} onClick={() => { setConfirmingCancel(true) }}>{t('docCancel')}</Button>}
            <Button size="sm" variant="outline" disabled={pending !== undefined || reviewBlocked} onClick={() => { void review('review') }}>{t('docRequestReview')}</Button>
            <Button size="sm" variant="primary" disabled={pending !== undefined} onClick={() => { void review('approve') }}>{t('docApprove')}</Button>
          </div>
        </>}
    </footer>}
  </main>
}
