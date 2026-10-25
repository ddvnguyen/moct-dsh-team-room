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
import { Button, IconChevronRightOutlineRegular, IconCloseOutlineRegular, IconPanelLeftOutlineRegular, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
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
   * Opens the Task's Thread — the legacy surface D10 froze. The page's header
   * carries it as an icon; the slice's own icon bar carries it instead, so the
   * control exists once per presentation.
   */
  readonly onOpenLegacyThread?: (() => void) | undefined
  /**
   * Reopens the shell's left column. The control renders only while the column
   * is closed — the open column needs no way to be opened.
   */
  readonly sidebarCollapsed?: boolean | undefined
  readonly openSidebar?: (() => void) | undefined
  /** Puts the issue back into its slice presentation; the page's own control. */
  readonly onBackToPanel?: (() => void) | undefined
  /** Closes the issue surface; the page's own control. */
  readonly onClose?: (() => void) | undefined
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
export function IssueHeader({ title, taskNumber, status, channelName, channelRef, onOpenChannel, onRename, onOpenLegacyThread, sidebarCollapsed, openSidebar, onBackToPanel, onClose, actions, pending, t }: IssueHeaderProps) {
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
    <header className={css.head} data-team-slim-header="issue" data-testid="issue-header">
      <div className={css.crumb}>
        {sidebarCollapsed === true && openSidebar !== undefined && (
          <Button size="sm" variant="outline" icon={<IconPanelLeftOutlineRegular size={16} />} aria-label={t('openSidebar')} title={t('openSidebar')} onClick={openSidebar} data-testid="issue-open-sidebar" />
        )}
        {onOpenChannel !== undefined
          ? <button type="button" className={css.crumbChannelLink} title={t('issueCrumbChannel', { channel: channelName })} onClick={() => { onOpenChannel(channelRef) }}>{channelName}</button>
          : <span className={css.crumbChannel}>{channelName}</span>}
        <span aria-hidden="true">/</span>
        <span>#{taskNumber}</span>
        <span className={css.headActions}>
          {onOpenLegacyThread !== undefined && (
            <Button size="sm" icon={<IconRightUpOutlineRegular size={16} />} aria-label={t('issueOpenLegacyThread')} title={t('issueOpenLegacyThread')} onClick={onOpenLegacyThread} data-testid="issue-open-legacy-thread" />
          )}
          {onBackToPanel !== undefined && (
            <Button size="sm" icon={<IconChevronRightOutlineRegular size={16} />} aria-label={t('issueBackToSlice')} title={t('issueBackToSlice')} onClick={onBackToPanel} data-testid="issue-back-to-slice" />
          )}
          {onClose !== undefined && (
            <Button size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t('issueClose')} title={t('issueClose')} onClick={onClose} data-testid="issue-close" />
          )}
        </span>
      </div>
      <div className={css.titleRow}>
        {editing
          ? <span className={css.titleEditor}>
              <input
                autoFocus
                className={css.titleInput}
                data-testid="issue-title-input"
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
          : <button type="button" className={css.title} data-testid="issue-title" aria-label={t('editTitle')} title={title === '' ? undefined : title} onClick={startEdit}>
              {title === '' ? <span className={css.titlePlaceholder}>{t('titlePlaceholder')}</span> : title}
            </button>}
        <span className={css.statusChip} data-testid="issue-status">
          <StatusIcon status={status} />
          {t(STATUS_LABEL_KEY[status])}
        </span>
        <IssueActionsMenu {...actions} t={t} />
      </div>
    </header>
  )
}
