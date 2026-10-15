import { useEffect, useState } from 'react'
import type { AgentTeamDocRef, AgentTeamDocSectionHistory, AgentTeamDocSectionVersion, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { formatAbsoluteTime } from './team-formatters.ts'
import docCss from './doc.module.css'

interface TeamDocHistoryProps {
  readonly workspaceId: WorkspaceId
  readonly docRef: AgentTeamDocRef
  readonly sectionId: string
  readonly heading: string
  /** The Doc revision on the page; history is re-read whenever it moves. */
  readonly revision: number
  readonly loadHistory: TeamConversationProps['loadDocSectionHistory']
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  /** Absent when the Doc is final: an old version can be read but not restored. */
  readonly restore?: (version: AgentTeamDocSectionVersion) => void
  readonly restoring: boolean
  readonly close: () => void
  readonly t: TeamConversationProps['t']
}

/**
 * Every version of one section, newest first, from the ledger's own section
 * writes. Restoring a version writes it again as a new version, fenced like any
 * edit; nothing is rewritten in place.
 */
export function TeamDocHistory({ workspaceId, docRef, sectionId, heading, revision, loadHistory, nameOf, restore, restoring, close, t }: TeamDocHistoryProps) {
  const [history, setHistory] = useState<AgentTeamDocSectionHistory>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    void loadHistory({ workspaceId, docRef, sectionId }).then(result => {
      if (!live) return
      if (result.ok) { setHistory(result.value); setError(undefined) } else setError(result.error.message)
    })
    return () => { live = false }
  }, [workspaceId, docRef, sectionId, revision])
  return <section className={docCss.panel} aria-label={t('docHistoryTitle', { heading })} data-team-doc-history={sectionId}>
    <div className={docCss.panelHead}>
      <h2 className={docCss.panelHeading}>{t('docHistoryTitle', { heading })}</h2>
      <button type="button" className={docCss.chatClear} aria-label={t('docHistoryClose')} title={t('docHistoryClose')} onClick={close}>×</button>
    </div>
    {error !== undefined && <p className={docCss.notice} role="alert">{error}</p>}
    {history === undefined && error === undefined && <p className={docCss.hint}>{t('docHistoryLoading')}</p>}
    {history !== undefined && <ol className={docCss.commentList}>
      {history.versions.map((version, index) => <li key={version.sequence} className={docCss.commentThread} data-doc-version={version.sequence}>
        <div className={docCss.commentHead}>
          <span className={docCss.commentAuthor}>{nameOf(version.writer)}</span>
          <span className={docCss.commentSection} title={formatAbsoluteTime(version.occurredAt)}>{formatAbsoluteTime(version.occurredAt)}</span>
          {index === 0 && <span className={docCss.badgePending}>{t('docHistoryCurrent')}</span>}
        </div>
        {version.heading !== heading && <p className={docCss.commentQuote}>{version.heading}</p>}
        <p className={docCss.versionBody}>{version.markdown === '' ? t('docEmptySection') : version.markdown}</p>
        {index > 0 && restore !== undefined && <div className={docCss.reviewActions}>
          <Button size="sm" variant="outline" disabled={restoring} onClick={() => { restore(version) }}>{t('docHistoryRestore')}</Button>
        </div>}
      </li>)}
    </ol>}
  </section>
}
