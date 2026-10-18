// Derived from multica-x packages/views/modals/create-issue-dialog.tsx and
// packages/views/modals/quick-create-issue.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: one manual mode only. Fields are title, description
// (plain textarea), channel (default = the last channel a Task was created in,
// remembered in localStorage), priority and assignee (default Unassigned —
// creating never assigns). The dialog is a plain fixed overlay, not the dsh
// dialog primitive, because the board renders inside both the main seat and
// the native tab body and must not depend on the shell's portal stack.

import { useState } from 'react'
import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamTaskPriority } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import { PRIORITY_LABEL_KEY } from '../multica/priority.ts'
import { AssigneePicker, type AssigneeOption } from '../multica-ui/AssigneePicker.tsx'
import css from './board.module.css'

/** localStorage key for the last channel a Task was created in. */
export const LAST_CHANNEL_KEY = 'dsh.agent-team.board.lastChannel'

export interface CreateTaskDialogProps {
  readonly channels: readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string }[]
  readonly members: readonly AssigneeOption[]
  readonly defaultChannelRef?: AgentTeamChannelRef | undefined
  readonly onCreate: (request: {
    readonly channelRef: AgentTeamChannelRef
    readonly title: string
    readonly body: string
    readonly priority?: AgentTeamTaskPriority
    readonly assignee?: AgentTeamMemberId | null
  }) => Promise<void>
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}

/** The board's create dialog: one unassigned Task over a chosen Channel. */
export function CreateTaskDialog({ channels, members, defaultChannelRef, onCreate, onClose, t }: CreateTaskDialogProps) {
  const storedChannel = ((): AgentTeamChannelRef | undefined => {
    try { return localStorage.getItem(LAST_CHANNEL_KEY) as AgentTeamChannelRef | null ?? undefined } catch { return undefined }
  })()
  const initialChannel = defaultChannelRef
    ?? (channels.some(channel => channel.channelRef === storedChannel) ? storedChannel : undefined)
    ?? channels[0]?.channelRef
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [channelRef, setChannelRef] = useState<AgentTeamChannelRef | undefined>(initialChannel)
  const [priority, setPriority] = useState<AgentTeamTaskPriority>('none')
  const [assignee, setAssignee] = useState<AgentTeamMemberId | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (): Promise<void> => {
    if (channelRef === undefined || title.trim() === '' || submitting) return
    setSubmitting(true)
    setError(undefined)
    try {
      await onCreate({
        channelRef,
        title: title.trim(),
        body: body.trim() === '' ? title.trim() : body.trim(),
        ...(priority === 'none' ? {} : { priority }),
        assignee,
      })
      try { localStorage.setItem(LAST_CHANNEL_KEY, channelRef) } catch { /* private mode */ }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
    }
  }

  return (
    <div className={css.dialogBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.dialog} role="dialog" aria-label={t('boardCreateTask')} data-testid="board-create-dialog">
        <h2 className={css.dialogTitle}>{t('boardCreateTask')}</h2>
        <label className={css.fieldLabel}>
          {t('boardCreateTitle')}
          <input
            className={css.fieldInput}
            value={title}
            autoFocus
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }}
          />
        </label>
        <label className={css.fieldLabel}>
          {t('boardCreateDescription')}
          <textarea className={`${css.fieldInput} ${css.fieldTextarea}`} value={body} onChange={event => setBody(event.target.value)} />
        </label>
        <div className={css.fieldRow}>
          <label className={css.fieldLabel}>
            {t('boardCreateChannel')}
            <select
              className={css.fieldSelect}
              value={channelRef ?? ''}
              onChange={event => setChannelRef(event.target.value as AgentTeamChannelRef)}
            >
              {channels.map(channel => <option key={channel.channelRef} value={channel.channelRef}>{channel.name}</option>)}
            </select>
          </label>
          <label className={css.fieldLabel}>
            {t('boardCreatePriority')}
            <select
              className={css.fieldSelect}
              value={priority}
              onChange={event => setPriority(event.target.value as AgentTeamTaskPriority)}
            >
              {(['urgent', 'high', 'medium', 'low', 'none'] as const).map(option => (
                <option key={option} value={option}>{t(PRIORITY_LABEL_KEY[option])}</option>
              ))}
            </select>
          </label>
        </div>
        <div className={css.fieldLabel}>
          {t('boardCreateAssignee')}
          <AssigneePicker assignee={assignee} members={members} onChange={memberId => setAssignee(memberId as AgentTeamMemberId | null)} t={t} />
        </div>
        {error !== undefined && <p className={css.dialogError} role="alert">{error}</p>}
        <div className={css.dialogActions}>
          <button type="button" className={css.dialogButton} onClick={onClose}>{t('boardCancel')}</button>
          <button
            type="button"
            className={`${css.dialogButton} ${css.dialogPrimary}`}
            disabled={submitting || title.trim() === '' || channelRef === undefined}
            data-testid="board-create-submit"
            onClick={() => { void submit() }}
          >
            {t('boardCreateSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}
