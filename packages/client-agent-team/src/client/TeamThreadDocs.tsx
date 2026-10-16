import { useEffect, useRef, useState } from 'react'
import type { AgentTeamDocSummary, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TeamConversationProps } from './slots.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { docStatusDot, formatDocStatus } from './team-docs.ts'
import css from './doc.module.css'

interface TeamThreadDocsProps {
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  readonly loadDocs: TeamConversationProps['loadDocs']
  /** Bumped by the Thread page on every wake of the Thread's change scope, which every Doc write wakes. */
  readonly changeVersion: number
  readonly openDoc: (summary: AgentTeamDocSummary) => void
  readonly t: TeamConversationProps['t']
}

/**
 * The Thread's Team Documents as cards under its header. Every Doc write wakes
 * its Thread's change scope, and the Thread page's own subscription to that
 * scope re-reads the cards, so they open no stream of their own. Nothing
 * renders while the Thread has no Doc.
 */
export function TeamThreadDocs({ workspaceId, threadRef, loadDocs, changeVersion, openDoc, t }: TeamThreadDocsProps) {
  const [docs, setDocs] = useState<readonly AgentTeamDocSummary[]>([])
  const sequence = useRef(0)
  useEffect(() => {
    let live = true
    const mine = ++sequence.current
    void loadDocs({ workspaceId, threadRef }).then(result => {
      if (live && mine === sequence.current && result.ok) setDocs(result.value.docs)
    })
    return () => { live = false }
  }, [workspaceId, threadRef, changeVersion])
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
