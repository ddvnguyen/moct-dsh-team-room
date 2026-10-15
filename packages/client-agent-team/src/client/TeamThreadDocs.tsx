import { useEffect, useRef, useState } from 'react'
import type { AgentTeamChannelRef, AgentTeamDocSummary, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamConversationProps } from './slots.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { docStatusDot, formatDocStatus } from './team-docs.ts'
import css from './doc.module.css'

interface TeamThreadDocsProps {
  readonly workspaceId: WorkspaceId
  /** Whose Docs: one Thread's, or every Doc of one Channel. */
  readonly home: { readonly threadRef: AgentTeamThreadRef } | { readonly channelRef: AgentTeamChannelRef }
  readonly loadDocs: TeamConversationProps['loadDocs']
  /** Bumped by the page on every wake of its change scope; a Doc write wakes its Thread, and a new Doc its Channel too. */
  readonly changeVersion: number
  readonly openDoc: (summary: AgentTeamDocSummary) => void
  readonly t: TeamConversationProps['t']
}

/**
 * A Thread's or a Channel's Team Documents as cards under the page header. The
 * page's own change subscription bumps `changeVersion`, which re-reads the
 * cards, so they open no stream of their own. Nothing renders while there is
 * no Doc.
 */
export function TeamThreadDocs({ workspaceId, home, loadDocs, changeVersion, openDoc, t }: TeamThreadDocsProps) {
  const [docs, setDocs] = useState<readonly AgentTeamDocSummary[]>([])
  const sequence = useRef(0)
  const homeRef = 'threadRef' in home ? home.threadRef : home.channelRef
  useEffect(() => {
    let live = true
    const mine = ++sequence.current
    void loadDocs({ workspaceId, ...home }).then(result => {
      if (live && mine === sequence.current && result.ok) setDocs(result.value.docs)
    })
    return () => { live = false }
  }, [workspaceId, homeRef, changeVersion])
  if (docs.length === 0) return null
  return <section className={css.threadDocs} aria-label={t('docsLabel')} data-team-thread-docs>
    {docs.map(summary => <button type="button" key={summary.docRef} className={css.docCard} aria-label={t('docOpen', { title: summary.title })}
      onClick={() => { openDoc(summary) }} data-team-doc-card={summary.docRef}>
      <span className={css.docCardTitle}>{summary.title}</span>
      <span className={css.docCardMeta}>
        <TeamStateDot size={8} state={docStatusDot(summary.status)} />
        {formatDocStatus(summary.status, t)}
        <span aria-hidden="true">·</span>
        {t('docRevision', { revision: summary.revision })}
        {summary.pendingCommentCount > 0 && <><span aria-hidden="true">·</span>{t('docPendingComments', { count: summary.pendingCommentCount })}</>}
      </span>
    </button>)}
  </section>
}
