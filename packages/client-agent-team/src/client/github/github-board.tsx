// The GitHub board: GitHub Issues are the cards and, when a project is bound,
// the project's `Status` field is the columns.
//
// Nothing here mirrors into the Team: the board reads GitHub, a drop writes the
// column's field on GitHub, and the card moves only when the re-read brings the
// new truth back. A deployment with no repo or no token has not been bound yet,
// and says so instead of showing an empty board.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AgentTeamGitHubBoard, AgentTeamGitHubBoardRequest, AgentTeamGitHubColumn, AgentTeamGitHubCommentRequest,
  AgentTeamGitHubCommentRow, AgentTeamGitHubCreateIssueRequest, AgentTeamGitHubIssue, AgentTeamGitHubIssueRequest,
  AgentTeamGitHubIssueSummary, AgentTeamGitHubStatus, AgentTeamGitHubUpdateIssueRequest,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { GitHubIssuePanel } from './github-issue-panel.tsx'
import { githubFailureText } from './failure.ts'
import look from '../multica-look.module.css'
import css from './github.module.css'

export interface GitHubBoardProps {
  readonly workspaceId: WorkspaceId
  readonly status: AgentTeamGitHubStatus
  readonly loadBoard: (request: AgentTeamGitHubBoardRequest) => Promise<RemoteResult<AgentTeamGitHubBoard>>
  readonly loadIssue: (request: AgentTeamGitHubIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssue>>
  readonly createIssue: (request: AgentTeamGitHubCreateIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssueSummary>>
  readonly updateIssue: (request: AgentTeamGitHubUpdateIssueRequest) => Promise<RemoteResult<AgentTeamGitHubIssueSummary>>
  readonly commentIssue: (request: AgentTeamGitHubCommentRequest) => Promise<RemoteResult<AgentTeamGitHubCommentRow>>
  readonly t: TeamConversationProps['t']
}

/**
 * The open issue is in the URL, so a reload reopens it and a link shares it.
 * It is not a Team position: the query key belongs to the GitHub board alone,
 * and the write is a query-only relative URL that leaves every other parameter
 * (including the Team's own) alone.
 */
export const GITHUB_ISSUE_QUERY_KEY = 'ghIssue'

/** The issue a link names, if any: a cold load of a shared link opens it. */
export function queriedIssueNumber(): number | undefined {
  if (typeof location === 'undefined') return undefined
  const raw = new URLSearchParams(location.search).get(GITHUB_ISSUE_QUERY_KEY)
  if (raw === null) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function writeQueriedIssue(number: number | undefined): void {
  if (typeof window === 'undefined' || typeof location === 'undefined') return
  const params = new URLSearchParams(location.search)
  if (number === undefined) params.delete(GITHUB_ISSUE_QUERY_KEY)
  else params.set(GITHUB_ISSUE_QUERY_KEY, String(number))
  const query = params.toString()
  // The harness mounts under a `<base href="./">`, so the query resolves
  // against the current document; the path never moves.
  window.history.replaceState(window.history.state, '', query === '' ? '?' : `?${query}`)
}

/**
 * The issue open over the board. Its number lives in the URL rather than in
 * the board's own state, so a shared link and a reload open the same issue;
 * closing re-reads the board (the panel's writes changed it) and returns the
 * keyboard to the card the reader came from — or, for a panel opened from a
 * link, to that issue's card.
 */
function useOpenIssue(reload: () => Promise<void>) {
  const [openNumber, setOpenNumber] = useState<number | undefined>(() => queriedIssueNumber())
  const opener = useRef<HTMLElement | null>(null)
  const open = useCallback((number: number): void => {
    opener.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null
    setOpenNumber(number)
    writeQueriedIssue(number)
  }, [])
  const close = useCallback((): void => {
    const closed = openNumber
    setOpenNumber(undefined)
    writeQueriedIssue(undefined)
    void reload()
    const target = opener.current
      ?? (closed === undefined ? null : document.querySelector<HTMLElement>(`[data-github-card="${closed}"]`))
    opener.current = null
    target?.focus()
  }, [reload, openNumber])
  return { openNumber, open, close }
}

/**
 * The mirror's board face. The binding is decided by the Host, so an unbound
 * deployment renders its setup instead of an empty board that would read as
 * "no issues".
 */
export function GitHubBoard(props: GitHubBoardProps) {
  if (!props.status.configured) return <GitHubSetup status={props.status} t={props.t} />
  return <GitHubIssueBoard {...props} />
}

function GitHubSetup({ status, t }: { readonly status: AgentTeamGitHubStatus; readonly t: TeamConversationProps['t'] }) {
  return (
    <div className={`${look.multicaLook} ${css.setup}`} data-github-setup="">
      <h2 className={css.setupTitle}>{t('githubSetupTitle')}</h2>
      <p className={css.setupBody}>
        {status.reason === 'missing-token' && status.repo !== undefined
          ? t('githubSetupMissingToken', { repo: status.repo })
          : t('githubSetupMissingRepo')}
      </p>
      <dl className={css.setupList}>
        <dt><code>DSH_AGENT_TEAM_GITHUB_REPO</code></dt>
        <dd>{t('githubSetupRepoHint')}</dd>
        <dt><code>DSH_AGENT_TEAM_GITHUB_TOKEN</code></dt>
        <dd>{t('githubSetupTokenHint')}</dd>
        <dt><code>DSH_AGENT_TEAM_GITHUB_PROJECT</code></dt>
        <dd>{t('githubSetupProjectHint')}</dd>
        <dt><code>DSH_AGENT_TEAM_GITHUB_API</code></dt>
        <dd>{t('githubSetupApiHint')}</dd>
      </dl>
    </div>
  )
}

function GitHubIssueBoard({ workspaceId, status, loadBoard, loadIssue, createIssue, updateIssue, commentIssue, t }: GitHubBoardProps) {
  const [board, setBoard] = useState<AgentTeamGitHubBoard>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [activeIssue, setActiveIssue] = useState<AgentTeamGitHubIssueSummary | null>(null)
  const [busy, setBusy] = useState(false)
  // Reads can overtake each other; only the newest one may write state.
  const serial = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const ticket = serial.current += 1
    const result = await loadBoard({ workspaceId })
    if (ticket !== serial.current) return
    if (!result.ok) {
      setError(githubFailureText(result.error, t))
      return
    }
    setBoard(result.value)
    setError(undefined)
  }, [loadBoard, workspaceId, t])

  useEffect(() => { void reload() }, [reload])
  const { openNumber, open: openIssue, close: closeIssue } = useOpenIssue(reload)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  /** A drop writes the target column's field on GitHub; the card waits for the re-read. */
  const move = useCallback(async (issue: AgentTeamGitHubIssueSummary, column: AgentTeamGitHubColumn): Promise<void> => {
    if (!column.droppable) { setNotice(t('githubBucketColumn')); return }
    if (issue.columnId === column.id || busy) return
    setBusy(true)
    setNotice(undefined)
    setError(undefined)
    const result = column.kind === 'state'
      ? await updateIssue({ workspaceId, number: issue.number, state: column.id === 'closed' ? 'closed' : 'open' })
      : await updateIssue({ workspaceId, number: issue.number, status: column.id })
    setBusy(false)
    if (!result.ok) { setError(githubFailureText(result.error, t)); return }
    await reload()
  }, [busy, updateIssue, workspaceId, t, reload])

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    const issue = (event.active.data.current as { readonly issue?: AgentTeamGitHubIssueSummary } | undefined)?.issue
    setActiveIssue(issue ?? null)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent): void => {
    setActiveIssue(null)
    const issue = (event.active.data.current as { readonly issue?: AgentTeamGitHubIssueSummary } | undefined)?.issue
    const target = event.over?.id
    if (issue === undefined || typeof target !== 'string') return
    const column = board?.columns.find(entry => entry.id === target)
    if (column === undefined) return
    void move(issue, column)
  }, [board, move])

  const byColumn = useMemo(() => {
    const map = new Map<string, AgentTeamGitHubIssueSummary[]>()
    for (const issue of board?.issues ?? []) {
      const rows = map.get(issue.columnId)
      if (rows === undefined) map.set(issue.columnId, [issue])
      else rows.push(issue)
    }
    return map
  }, [board])

  const handleCreate = useCallback(async (title: string, body: string): Promise<string | undefined> => {
    const firstColumn = board?.columns.find(column => column.droppable && column.kind === 'project-status')
    const result = await createIssue({
      workspaceId, title, body,
      ...(firstColumn === undefined ? {} : { columnId: firstColumn.id }),
    })
    if (!result.ok) return githubFailureText(result.error, t)
    setCreating(false)
    await reload()
    return undefined
  }, [board, createIssue, workspaceId, t, reload])

  return (
    <div className={`${look.multicaLook} ${css.page}`} data-github-board="">
      <div className={css.toolbar}>
        <span className={css.repoBadge}>{board?.repo ?? status.repo ?? 'GitHub'}</span>
        {board?.projectNumber !== undefined && <span className={css.projectBadge}>#{board.projectNumber}</span>}
        <span className={css.spacer} />
        <button type="button" className={css.ghostButton} onClick={() => { void reload() }}>{t('githubRefresh')}</button>
        <button type="button" className={css.primaryButton} data-github-new-issue="" onClick={() => { setCreating(true) }}>
          + {t('githubNewIssue')}
        </button>
      </div>
      {notice !== undefined && <p className={css.info} role="status" data-github-notice="">{notice}</p>}
      {error !== undefined && <p className={css.error} role="alert" data-github-error="">{error}</p>}
      {board === undefined ? (
        error === undefined ? <p className={css.muted}>{t('githubLoadingBoard')}</p> : null
      ) : (
        <>
          {board.truncated && <p className={css.info}>{t('githubTruncated')}</p>}
          {board.issues.length === 0 && <p className={css.muted}>{t('githubBoardEmpty')}</p>}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className={css.scroller} data-github-scroller="">
              {board.columns.map(column => (
                <GitHubColumn
                  key={column.id}
                  column={column}
                  issues={byColumn.get(column.id) ?? []}
                  onOpen={openIssue}
                  busy={busy}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeIssue !== null && (
                <div className={css.overlayCard}>#{activeIssue.number} {activeIssue.title}</div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}
      {creating && (
        <CreateIssueDialog onCreate={handleCreate} onClose={() => { setCreating(false) }} t={t} />
      )}
      {openNumber !== undefined && board !== undefined && (
        <GitHubIssuePanel
          workspaceId={workspaceId}
          number={openNumber}
          columns={board.columns}
          catalog={{ labels: board.labels, people: board.people }}
          loadIssue={loadIssue}
          updateIssue={updateIssue}
          commentIssue={commentIssue}
          onClose={closeIssue}
          t={t}
        />
      )}
    </div>
  )
}

function GitHubColumn({ column, issues, onOpen, busy }: {
  readonly column: AgentTeamGitHubColumn
  readonly issues: readonly AgentTeamGitHubIssueSummary[]
  readonly onOpen: (number: number) => void
  readonly busy: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <section
      ref={setNodeRef}
      className={css.column}
      data-github-column={column.id}
      data-over={isOver && column.droppable ? '' : undefined}
    >
      <header className={css.columnHead}>
        <span className={css.columnDot} style={column.color === undefined ? undefined : { background: dotColor(column.color) }} />
        <h3 className={css.columnTitle}>{column.name}</h3>
        <span className={css.columnCount}>{issues.length}</span>
      </header>
      <ul className={css.cardList}>
        {issues.map(issue => (
          <GitHubCard key={issue.number} issue={issue} onOpen={onOpen} busy={busy} />
        ))}
      </ul>
    </section>
  )
}

/** GitHub's project colours are names (`GRAY`, `BLUE`…); the board paints them as tokens. */
function dotColor(color: string): string {
  const named: Record<string, string> = {
    GRAY: 'var(--ml-text-tertiary)',
    BLUE: '#0969da',
    GREEN: '#1a7f37',
    YELLOW: '#9a6700',
    ORANGE: '#bc4c00',
    RED: '#cf222e',
    PINK: '#bf3989',
    PURPLE: '#8250df',
  }
  return named[color.toUpperCase()] ?? 'var(--ml-text-tertiary)'
}

function GitHubCard({ issue, onOpen, busy }: {
  readonly issue: AgentTeamGitHubIssueSummary
  readonly onOpen: (number: number) => void
  readonly busy: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `issue:${issue.number}`,
    data: { issue },
  })
  return (
    <li className={css.cardItem}>
      <button
        ref={setNodeRef}
        type="button"
        className={css.card}
        data-github-card={issue.number}
        data-state={issue.state}
        data-dragging={isDragging ? '' : undefined}
        disabled={busy}
        onClick={() => { onOpen(issue.number) }}
        {...attributes}
        {...listeners}
      >
        <span className={css.cardTitle}>{issue.title}</span>
        <span className={css.cardMeta}>
          <span className={css.cardNumber}>#{issue.number}</span>
          {issue.labels.length > 0 && (
            <span className={css.cardLabels}>
              {issue.labels.slice(0, 3).map(label => (
                <span key={label.name} className={css.cardLabel} title={label.name}>
                  <i style={{ background: `#${label.color === '' ? '888888' : label.color}` }} />{label.name}
                </span>
              ))}
            </span>
          )}
          {issue.commentCount > 0 && <span className={css.cardCount}>💬 {issue.commentCount}</span>}
          {issue.assignees.length > 0 && <span className={css.cardAssignee}>{issue.assignees.join(', ')}</span>}
        </span>
      </button>
    </li>
  )
}

function CreateIssueDialog({ onCreate, onClose, t }: {
  readonly onCreate: (title: string, body: string) => Promise<string | undefined>
  readonly onClose: () => void
  readonly t: TeamConversationProps['t']
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const submit = async (): Promise<void> => {
    if (saving) return
    if (title.trim() === '') { setError(t('githubTitleRequired')); return }
    setSaving(true)
    setError(undefined)
    const failure = await onCreate(title.trim(), body)
    setSaving(false)
    if (failure !== undefined) setError(failure)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('githubNewIssue')}
      closeLabel={t('close')}
      contentClassName={`${css.dialogBody} ${look.multicaLook}`}
    >
      <form className={css.form} onSubmit={event => { event.preventDefault(); void submit() }}>
        <label className={css.field}>
          <span>{t('githubIssueTitleField')}</span>
          <input
            className={css.input}
            value={title}
            data-github-new-title=""
            onChange={event => { setTitle(event.target.value) }}
            autoFocus
          />
        </label>
        <label className={css.field}>
          <span>{t('githubIssueBodyField')}</span>
          <textarea
            className={css.composerInput}
            value={body}
            rows={6}
            onChange={event => { setBody(event.target.value) }}
          />
        </label>
        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
        <div className={css.composerActions}>
          <button type="button" className={css.ghostButton} onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className={css.primaryButton} disabled={saving}>
            {saving ? t('githubCreating') : t('githubCreate')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
