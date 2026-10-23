// Derived from multica-x packages/views/issues/components/issue-detail.tsx and
// packages/views/layout/breadcrumb-header.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue header — the breadcrumb (container ›
// identifier › title), the inline-editable title, and the actions dropdown —
// ported as one region of the issue view. The container crumb is the Channel
// the Task lives in and navigates back to it; the number comes from the
// Host's `taskNumber`, never from the title. The title edit is not optimistic:
// the Remote commits, the change-wake refetches, and only then does the title
// settle; a rejected write leaves the title where it was and shows why.

import { useRef, useState } from 'react'
import type { AgentTeamChannelRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY } from '../multica/status.ts'
import { StatusIcon } from '../multica-ui/StatusIcon.tsx'
import type { TeamConversationProps } from '../slots.ts'
import { IssueActionsMenu, type IssueActionsMenuProps } from './IssueActionsMenu.tsx'
import css from './issue-view.module.css'

export interface IssueHeaderProps {
  /** The Host-resolved title (R3) — never a client-side join of the Task's fields. */
  readonly title: string
  readonly taskNumber: number
  readonly status: TaskStatus
  /** The Channel the Task lives in; the breadcrumb's first crumb. */
  readonly channelName: string
  readonly channelRef: AgentTeamChannelRef
  /**
   * Navigates back to the Channel the crumb names. Absent renders the channel
   * name as plain text — the crumb is presentation, never a dead control.
   */
  readonly onOpenChannel?: ((channelRef: AgentTeamChannelRef) => void) | undefined
  /**
   * Commits a new title. Resolves with the failure message, or undefined when
   * the Host committed it — the caller does not move the title itself.
   */
  readonly onRename: (title: string) => Promise<string | undefined>
  /**
   * Opens the Task's Thread — the legacy surface D10 froze. It is the one
   * control that makes "legacy" visible in the product: the issue is what a
   * reader lands on, and the Thread is what they ask for.
   */
  readonly onOpenLegacyThread?: (() => void) | undefined
  /** The header's actions menu: the status, priority, assignee, Copy link and Close writes. */
  readonly actions: IssueActionsMenuProps
  /** A write is in flight; the editor waits for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's header: where the Task lives (`channel / #n`), what it is
 * called, and where it stands — with the one actions menu that moves it.
 * The title is the one editable field here; it writes through the board's
 * title field, which exists today.
 */
export function IssueHeader({ title, taskNumber, status, channelName, channelRef, onOpenChannel, onRename, onOpenLegacyThread, actions, pending, t }: IssueHeaderProps) {
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
        {onOpenChannel !== undefined
          ? <button type="button" className={css.crumbChannelLink} title={t('issueCrumbChannel', { channel: channelName })} onClick={() => { onOpenChannel(channelRef) }}>{channelName}</button>
          : <span className={css.crumbChannel}>{channelName}</span>}
        <span aria-hidden="true">/</span>
        <span>#{taskNumber}</span>
        {onOpenLegacyThread !== undefined && (
          <button type="button" className={css.crumbAction} onClick={onOpenLegacyThread}>
            {t('issueOpenLegacyThread')}
          </button>
        )}
      </div>
      <div className={css.titleRow}>
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
        <IssueActionsMenu {...actions} t={t} />
      </div>
    </header>
  )
}
