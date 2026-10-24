// The GitHub issue surface: the communication face of the mirror.
//
// GitHub is the store, so this panel owns no copy of an issue: it reads one
// issue with its whole conversation, writes a comment or a field straight to
// GitHub, and re-reads. Nothing moves locally — the comment the reader typed
// appears when GitHub answers with it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AgentTeamGitHubColumn, AgentTeamGitHubCommentRequest, AgentTeamGitHubCommentRow, AgentTeamGitHubIssue,
  AgentTeamGitHubIssueRequest, AgentTeamGitHubIssueSummary, AgentTeamGitHubUpdateIssueRequest,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import look from '../multica-look.module.css'
import css from './github.module.css'

export interface GitHubIssuePanelProps {
  readonly workspaceId: WorkspaceId
  readonly number: number
  /** The board's columns: the status picker offers the ones a drop may target. */
  readonly columns: readonly AgentTeamGitHubColumn[]
  readonly loadIssue: (request: AgentTeamGitHubIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssue>>
  readonly updateIssue: (request: AgentTeamGitHubUpdateIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssueSummary>>
  readonly commentIssue: (request: AgentTeamGitHubCommentRequest) => Promise<RemoteResult<AgentTeamGitHubCommentRow>>
  readonly onClose: () => void
  readonly t: TeamConversationProps['t']
}

function failureText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * One issue over the board: the description, the properties GitHub holds, and
 * the conversation — the place the work is talked about.
 */
export function GitHubIssuePanel({ workspaceId, number, columns, loadIssue, updateIssue, commentIssue, onClose, t }: GitHubIssuePanelProps) {
  const [issue, setIssue] = useState<AgentTeamGitHubIssue>()
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingField, setPendingField] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const read = useCallback(async (): Promise<void> => {
    const result = await loadIssue({ workspaceId, number })
    if (!mounted.current) return
    if (result.ok) {
      setIssue(result.value)
      setError(undefined)
      return
    }
    setError(failureText(result.error))
  }, [loadIssue, workspaceId, number])

  useEffect(() => {
    setIssue(undefined)
    setDraft('')
    void read()
  }, [read])

  const timeAgo = useMemo(() => makeTimeAgo({
    justNow: t('timeAgoJustNow'),
    minutesAgo: t('timeAgoMinutes'),
    hoursAgo: t('timeAgoHours'),
    daysAgo: t('timeAgoDays'),
  }), [t])

  /** One field write: GitHub commits it, then the read brings the new truth back. */
  const writeField = useCallback(async (request: Omit<AgentTeamGitHubUpdateIssueRequest, 'workspaceId' | 'number'>): Promise<void> => {
    if (pendingField) return
    setPendingField(true)
    setError(undefined)
    const result = await updateIssue({ ...request, workspaceId, number })
    if (!mounted.current) return
    setPendingField(false)
    if (!result.ok) { setError(failureText(result.error)); return }
    await read()
  }, [pendingField, updateIssue, workspaceId, number, read])

  const submitComment = useCallback(async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || sending) return
    setSending(true)
    setError(undefined)
    const result = await commentIssue({ workspaceId, number, body })
    if (!mounted.current) return
    setSending(false)
    if (!result.ok) { setError(failureText(result.error)); return }
    // The draft clears only once GitHub holds the comment: a refused write
    // keeps the text so the reader can retry without retyping it.
    setDraft('')
    await read()
  }, [draft, sending, commentIssue, workspaceId, number, read])

  const statusOptions = columns.filter(column => column.kind === 'project-status' && column.droppable)

  return (
    <Modal
      open
      onClose={onClose}
      title={t('githubIssueLabel')}
      headless
      contentClassName={`${css.issueContent} ${look.multicaLook}`}
    >
      <div className={`${look.multicaLook} ${css.issuePanel}`} data-github-issue-panel={number}>
        {issue === undefined ? (
          <>
            <p className={css.muted}>{error ?? t('githubLoadingIssue')}</p>
            <button type="button" className={css.ghostButton} onClick={() => { void read() }}>{t('retry')}</button>
          </>
        ) : (
          <>
            <header className={css.issueHead}>
              <span className={css.issueNumber}>#{issue.number}</span>
              <h2 className={css.issueTitle} data-github-issue-title>{issue.title}</h2>
              <span className={css.stateChip} data-state={issue.state}>{issue.state === 'open' ? t('githubStateOpen') : t('githubStateClosed')}</span>
              <button type="button" className={css.ghostButton} onClick={onClose}>{t('close')}</button>
            </header>
            <p className={css.issueMeta}>
              {issue.author} · {timeAgo(issue.updatedAt)} ·{' '}
              <a href={issue.url} target="_blank" rel="noreferrer">{t('githubOpenOnGitHub')}</a>
            </p>
            <div className={css.issueFields}>
              {statusOptions.length > 0 && (
                <label className={css.field}>
                  <span>{t('githubStatusLabel')}</span>
                  <select
                    className={css.statusSelect}
                    value={issue.columnId}
                    disabled={pendingField}
                    onChange={event => { void writeField({ status: event.target.value }) }}
                  >
                    {statusOptions.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}
                  </select>
                </label>
              )}
              <div className={css.field}>
                <span>{t('githubLabelsLabel')}</span>
                <span className={css.chips}>
                  {issue.labels.length === 0
                    ? <span className={css.muted}>{t('githubNone')}</span>
                    : issue.labels.map(label => (
                      <span key={label.name} className={css.labelChip} data-label={label.name}>
                        <i style={{ background: `#${label.color === '' ? '888888' : label.color}` }} />{label.name}
                      </span>
                    ))}
                </span>
              </div>
              <div className={css.field}>
                <span>{t('githubAssigneesLabel')}</span>
                <span className={css.chips}>
                  {issue.assignees.length === 0
                    ? <span className={css.muted}>{t('githubNone')}</span>
                    : issue.assignees.map(login => <span key={login} className={css.personChip}>{login}</span>)}
                </span>
              </div>
              <button
                type="button"
                className={css.ghostButton}
                disabled={pendingField}
                onClick={() => { void writeField({ state: issue.state === 'open' ? 'closed' : 'open' }) }}
              >
                {issue.state === 'open' ? t('githubCloseIssue') : t('githubReopenIssue')}
              </button>
            </div>
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('githubDescription')}</h3>
              <div className={css.bodyText} data-github-issue-body>{issue.body === '' ? t('githubNoDescription') : issue.body}</div>
            </section>
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('githubCommentsTitle', { count: issue.comments.length })}</h3>
              {issue.comments.length === 0
                ? <p className={css.muted}>{t('githubCommentsEmpty')}</p>
                : (
                  <ul className={css.commentList}>
                    {issue.comments.map(comment => (
                      <li key={comment.id} className={css.comment} data-github-comment={comment.id}>
                        <div className={css.commentHead}>
                          <strong>{comment.author}</strong>
                          <span className={css.muted}>{timeAgo(comment.createdAt)}</span>
                        </div>
                        <div className={css.commentBody}>{comment.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
              {issue.truncatedComments && <p className={css.muted}>{t('githubCommentsTruncated')}</p>}
              <form
                className={css.composer}
                onSubmit={event => { event.preventDefault(); void submitComment() }}
              >
                <textarea
                  className={css.composerInput}
                  value={draft}
                  placeholder={t('githubCommentPlaceholder')}
                  aria-label={t('githubCommentPlaceholder')}
                  onChange={event => { setDraft(event.target.value) }}
                  rows={3}
                />
                <div className={css.composerActions}>
                  <button type="submit" className={css.primaryButton} disabled={sending || draft.trim() === ''}>
                    {sending ? t('githubCommentSending') : t('githubCommentSubmit')}
                  </button>
                </div>
              </form>
            </section>
            {error !== undefined && <p className={css.error} role="alert">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
