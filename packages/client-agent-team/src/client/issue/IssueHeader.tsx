// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue header — the breadcrumb, the `#n`
// identifier, the inline-editable title and the status chip — ported as one
// region of the issue view. The title edit is not optimistic: the Remote
// commits, the change-wake refetches, and only then does the title settle; a
// rejected write leaves the title where it was and shows why.

import { useRef, useState } from 'react'
import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueHeaderProps {
  /** The Host-resolved title (R3) — never a client-side join of the Task's fields. */
  readonly title: string
  readonly taskNumber: number
  readonly status: TaskStatus
  /** The Channel the Task lives in; the breadcrumb's first crumb. */
  readonly channelName: string
  /**
   * Commits a new title. Resolves with the failure message, or undefined when
   * the Host committed it — the caller does not move the title itself.
   */
  readonly onRename: (title: string) => Promise<string | undefined>
  /** A write is in flight; the editor waits for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's header: where the Task lives, which one it is, what it is
 * called, and where it stands. The title is the one editable field here; it
 * writes through the board's title field, which exists today.
 */
export function IssueHeader({ title, taskNumber, status, channelName, onRename, pending, t }: IssueHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  // Enter and blur both save; the busy ref keeps the blur that the Enter path
  // itself causes from re-submitting the patch.
  const busy = useRef(false)

  const startEdit = (): void => {
    setDraft(title)
    setError(undefined)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setDraft('')
    setError(undefined)
  }

  const commit = (): void => {
    if (busy.current || pending) return
    const next = draft.trim()
    if (next === '' || next === title) { cancelEdit(); return }
    busy.current = true
    void (async () => {
      const failure = await onRename(next)
      busy.current = false
      if (failure === undefined) cancelEdit(); else setError(failure)
    })()
  }

  return (
    <header className={css.head}>
      <div className={css.crumb}>
        <span className={css.crumbChannel}>{channelName}</span>
        <span aria-hidden="true">/</span>
        <span>{t('issueLabel')}</span>
      </div>
      <div className={css.titleRow}>
        <span className={css.number} aria-hidden="true">#{taskNumber}</span>
        {editing
          ? <span className={css.titleEditor}>
              <input
                autoFocus
                className={css.titleInput}
                aria-label={t('editTitle')}
                value={draft}
                disabled={pending}
                onChange={event => { setDraft(event.currentTarget.value) }}
                onBlur={commit}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); commit() }
                  if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
                }}
              />
              {error !== undefined && <span className={css.titleError} role="alert">{error}</span>}
            </span>
          : <button type="button" className={css.title} aria-label={t('editTitle')} title={title === '' ? undefined : title} onClick={startEdit}>
              {title === '' ? <span className={css.titlePlaceholder}>{t('titlePlaceholder')}</span> : title}
            </button>}
        <span className={css.statusChip}>
          <StatusIcon status={status} />
          {t(STATUS_LABEL_KEY[status])}
        </span>
      </div>
    </header>
  )
}
