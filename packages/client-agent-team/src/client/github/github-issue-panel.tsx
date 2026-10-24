// The GitHub issue surface: the communication face of the mirror.
//
// GitHub is the store, so this panel owns no copy of an issue: it reads one
// issue with its whole conversation, writes a comment or a field straight to
// GitHub, and re-reads. Nothing moves locally — the comment the reader typed
// appears when GitHub answers with it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { MarkdownText, Modal, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AgentTeamGitHubColumn, AgentTeamGitHubCommentRequest, AgentTeamGitHubCommentRow, AgentTeamGitHubIssue,
  AgentTeamGitHubIssueRequest, AgentTeamGitHubIssueSummary, AgentTeamGitHubLabel, AgentTeamGitHubUpdateIssueRequest,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { githubFailureText } from './failure.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import look from '../multica-look.module.css'
import conversationCss from '../conversation.module.css'
import css from './github.module.css'

export interface GitHubIssuePanelProps {
  readonly workspaceId: WorkspaceId
  readonly number: number
  /** The board's columns: the status picker offers the ones a drop may target. */
  readonly columns: readonly AgentTeamGitHubColumn[]
  /** The repository's labels and people: a field offers only names GitHub knows. */
  readonly catalog: { readonly labels: readonly AgentTeamGitHubLabel[]; readonly people: readonly string[] }
  readonly loadIssue: (request: AgentTeamGitHubIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssue>>
  readonly updateIssue: (request: AgentTeamGitHubUpdateIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssueSummary>>
  readonly commentIssue: (request: AgentTeamGitHubCommentRequest) => Promise<RemoteResult<AgentTeamGitHubCommentRow>>
  readonly onClose: () => void
  readonly t: TeamConversationProps['t']
}

/**
 * One issue over the board: the description, the properties GitHub holds, and
 * the conversation — the place the work is talked about.
 */
export function GitHubIssuePanel({ workspaceId, number, columns, catalog, loadIssue, updateIssue, commentIssue, onClose, t }: GitHubIssuePanelProps) {
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
    setError(githubFailureText(result.error, t))
  }, [loadIssue, workspaceId, number, t])

  useEffect(() => {
    setIssue(undefined)
    setDraft('')
    void read()
  }, [read])

  // The description and the comments are Markdown on GitHub, so they are read
  // as Markdown here: the chat typography the Team's own bodies use.
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') },
    footnotes: t('markdownFootnotes'),
  }), [t])

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
    if (!result.ok) { setError(githubFailureText(result.error, t)); return }
    await read()
  }, [pendingField, updateIssue, workspaceId, number, t, read])

  const submitComment = useCallback(async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || sending) return
    setSending(true)
    setError(undefined)
    const result = await commentIssue({ workspaceId, number, body })
    if (!mounted.current) return
    setSending(false)
    if (!result.ok) { setError(githubFailureText(result.error, t)); return }
    // The draft clears only once GitHub holds the comment: a refused write
    // keeps the text so the reader can retry without retyping it.
    setDraft('')
    await read()
  }, [draft, sending, commentIssue, workspaceId, number, t, read])

  const statusOptions = columns.filter(column => column.kind === 'project-status' && column.droppable)
  // An issue the project does not hold has no status, and no option matches
  // that: the picker names the bucket instead of falling back to the project's
  // first column and claiming a placement GitHub does not have.
  const bucketColumn = columns.find(column => !column.droppable)
  const bucketChoice = statusOptions.some(column => column.id === issue?.columnId) ? undefined : bucketColumn
  // Both fields are replaced wholesale on GitHub, so the pickers offer exactly
  // what is not attached yet and a removal sends the rest of the set.
  const attachedLabels = issue?.labels.map(label => label.name) ?? []
  const addableLabels = catalog.labels.filter(label => !attachedLabels.includes(label.name))
  const attachedPeople = issue?.assignees ?? []
  const addablePeople = catalog.people.filter(login => !attachedPeople.includes(login))

  // A headless dialog renders its children in the card itself, so `className`
  // is what carries the width and the height cap; `contentClassName` never
  // reaches a card whose header and body chrome are absent.
  return (
    <Modal
      open
      onClose={onClose}
      title={t('githubIssueLabel')}
      headless
      className={`${css.issueContent} ${look.multicaLook}`}
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
                    aria-label={t('githubStatusLabel')}
                    data-github-status=""
                    disabled={pendingField}
                    onChange={event => { void writeField({ status: event.target.value }) }}
                  >
                    {bucketChoice !== undefined && <option value={issue.columnId}>{bucketChoice.name}</option>}
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
                        <button
                          type="button"
                          className={css.chipRemove}
                          aria-label={t('githubRemoveLabel', { name: label.name })}
                          title={t('githubRemoveLabel', { name: label.name })}
                          data-github-remove-label={label.name}
                          disabled={pendingField}
                          onClick={() => { void writeField({ labels: attachedLabels.filter(name => name !== label.name) }) }}
                        >×</button>
                      </span>
                    ))}
                </span>
                {addableLabels.length > 0 && (
                  <select
                    className={css.fieldSelect}
                    value=""
                    aria-label={t('githubAddLabel')}
                    data-github-add-label=""
                    disabled={pendingField}
                    onChange={event => {
                      const name = event.target.value
                      if (name !== '') void writeField({ labels: [...attachedLabels, name] })
                    }}
                  >
                    <option value="">{t('githubAddLabel')}</option>
                    {addableLabels.map(label => <option key={label.name} value={label.name}>{label.name}</option>)}
                  </select>
                )}
              </div>
              <div className={css.field}>
                <span>{t('githubAssigneesLabel')}</span>
                <span className={css.chips}>
                  {issue.assignees.length === 0
                    ? <span className={css.muted}>{t('githubNone')}</span>
                    : issue.assignees.map(login => (
                      <span key={login} className={css.personChip} data-assignee={login}>
                        {login}
                        <button
                          type="button"
                          className={css.chipRemove}
                          aria-label={t('githubRemoveAssignee', { name: login })}
                          title={t('githubRemoveAssignee', { name: login })}
                          data-github-remove-assignee={login}
                          disabled={pendingField}
                          onClick={() => { void writeField({ assignees: attachedPeople.filter(name => name !== login) }) }}
                        >×</button>
                      </span>
                    ))}
                </span>
                {addablePeople.length > 0 && (
                  <select
                    className={css.fieldSelect}
                    value=""
                    aria-label={t('githubAddAssignee')}
                    data-github-add-assignee=""
                    disabled={pendingField}
                    onChange={event => {
                      const login = event.target.value
                      if (login !== '') void writeField({ assignees: [...attachedPeople, login] })
                    }}
                  >
                    <option value="">{t('githubAddAssignee')}</option>
                    {addablePeople.map(login => <option key={login} value={login}>{login}</option>)}
                  </select>
                )}
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
              {issue.body === ''
                ? <p className={css.muted} data-github-issue-body>{t('githubNoDescription')}</p>
                : (
                  <div className={`${css.bodyText} ${conversationCss.messageBody}`} data-github-issue-body>
                    <div className={conversationCss.messageMarkdown}>
                      <MarkdownText text={issue.body} labels={markdownLabels} />
                    </div>
                  </div>
                )}
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
                        <div className={`${css.commentBody} ${conversationCss.messageBody}`}>
                          <div className={conversationCss.messageMarkdown}>
                            <MarkdownText text={comment.body} labels={markdownLabels} />
                          </div>
                        </div>
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
