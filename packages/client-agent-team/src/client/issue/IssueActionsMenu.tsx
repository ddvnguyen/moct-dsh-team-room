// Derived from multica-x packages/views/issues/actions/issue-actions-dropdown.tsx and
// packages/views/issues/actions/issue-actions-menu-items.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: upstream's three-dot DropdownMenu with submenus becomes
// one dsh `Menu` whose content swaps between the root list and a field's
// option panel — the primitive already owns outside-click, Escape, the
// keyboard walk and the post-selection focus return, and the Team port does
// not add a submenu primitive. Upstream's pins, sub-issues, delete and
// open-in-new-tab are out: each needs a Host fact this Host does not hold.
//
// Every item writes through a path that already exists: the three fields
// through the issue view's `onStatus` / `onPriority` / `onAssignee` seams
// (`changeTask` / `updateTask`), Copy link through the URL string
// `history.ts` itself builds (`issueShareHref` — one builder, so the copied
// link cannot drift from the history stack), and Close through the Task's
// close write (`changeTask` action `close`), asked for first and never
// optimistic: the value settles when the change-wake refetches.

import { useState, type ReactNode } from 'react'
import { Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconEllipsisOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamMemberId, AgentTeamTaskPriority, AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'
import { STATUS_LABEL_KEY, ISSUE_STATUS_OPTIONS, isHumanStatusTarget } from '../multica/status.ts'
import { PRIORITY_DISPLAY_ORDER, PRIORITY_LABEL_KEY, normalizePriority } from '../multica/priority.ts'
import { issueShareHref } from '../history.ts'
import { ActorAvatar, PickerItem, PriorityIcon, StatusIcon, type AssigneeOption } from '../multica-ui/index.ts'
import type { TeamConversationProps } from '../slots.ts'
import look from '../multica-look.module.css'
import css from './issue-view.module.css'

export interface IssueActionsMenuProps {
  readonly taskRef: AgentTeamTaskRef
  readonly status: TaskStatus
  readonly priority: AgentTeamTaskPriority
  readonly assignee: AgentTeamMemberId | null | undefined
  /** The seats the assignee panel offers. */
  readonly members: readonly AssigneeOption[]
  /** Moves the Task's status; Close is this seam with the `closed` target. */
  readonly onStatus: (status: TaskStatus) => void
  readonly onPriority: (priority: AgentTeamTaskPriority) => void
  readonly onAssignee: (memberId: AgentTeamMemberId | null) => void
  /** A write is in flight; the field rows wait for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/** Which list the open menu is showing: the root, or one field's options. */
type MenuLevel = 'root' | 'status' | 'priority' | 'assignee'

/** Id of the one visible hint that the disabled status rows point to. */
const STATUS_HINT_ID = 'issue-menu-status-hint'

/**
 * The issue's actions menu: status, priority, assignee, Copy link and Close
 * behind one trigger in the header. The menu closes on selection, on `Esc`
 * and on an outside click — the primitive's own behavior, not this port's.
 */
export function IssueActionsMenu({ taskRef, status, priority, assignee, members, onStatus, onPriority, onAssignee, pending, t }: IssueActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<MenuLevel>('root')
  const [confirmClose, setConfirmClose] = useState(false)
  const [linkNotice, setLinkNotice] = useState<string>()

  const closeMenu = (): void => {
    setOpen(false)
    setLevel('root')
  }

  const copyLink = (): void => {
    // Inside the click's own task, so the browser's transient user activation
    // still covers the clipboard write (upstream learned the same lesson).
    const url = new URL(issueShareHref(taskRef), location.href).href
    closeMenu()
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      navigator.clipboard.writeText(url).then(
        () => { setLinkNotice(t('issueLinkCopied')) },
        () => { setLinkNotice(t('issueLinkCopyFailed', { url })) },
      )
      return
    }
    setLinkNotice(t('issueLinkCopyFailed', { url }))
  }

  const currentPriority = normalizePriority(priority)
  const currentMember = members.find(member => member.memberId === assignee)
  const orphan = currentMember === undefined && assignee != null

  const fieldRow = (levelName: Exclude<MenuLevel, 'root'>, label: string, valueLabel: string, icon: ReactNode) => (
    <PickerItem selected={false} onSelect={() => { setLevel(levelName) }}>
      {icon}
      <span className={css.menuFieldLabel}>{label}</span>
      <span className={css.menuFieldValue}>{valueLabel}</span>
      <IconChevronRightOutlineRegular size={12} className={css.menuChevron} />
    </PickerItem>
  )

  const backRow = (
    <PickerItem selected={false} onSelect={() => { setLevel('root') }}>
      <IconChevronLeftOutlineRegular size={14} />
      <span className={css.menuFieldLabel}>{t('issueActionsBack')}</span>
    </PickerItem>
  )

  const write = (writeIt: () => void): void => {
    if (pending) return
    closeMenu()
    writeIt()
  }

  return (
    <span className={`${look.multicaLook} ${css.menuRoot}`}>
      {linkNotice !== undefined && <span className={css.menuNotice} role="status">{linkNotice}</span>}
      <Menu
        open={open}
        onClose={closeMenu}
        autoFocus
        portal
        align="end"
        className={css.menuAnchor}
        listClassName={`${look.multicaLook} ${css.menuList}`}
        anchor={(
          <button
            type="button"
            className={css.menuTrigger}
            aria-label={t('issueActionsLabel')}
            title={t('issueActionsLabel')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              setLevel('root')
              setOpen(value => !value)
            }}
          >
            <IconEllipsisOutlineRegular />
          </button>
        )}
      >
        {level === 'root' && (
          <>
            {fieldRow('status', t('propStatus'), t(STATUS_LABEL_KEY[status]), <StatusIcon status={status} size={14} />)}
            {fieldRow('priority', t('propPriority'), t(PRIORITY_LABEL_KEY[currentPriority]), <PriorityIcon priority={currentPriority} size={14} />)}
            {fieldRow('assignee', t('propAssignee'), currentMember !== undefined ? currentMember.handle : orphan ? String(assignee) : t('assigneeUnassigned'), currentMember === undefined ? undefined : <ActorAvatar name={currentMember.handle} avatarUrl={currentMember.avatarUrl} kind="agent" size="xs" />)}
            <PickerItem selected={false} onSelect={copyLink}>
              <span className={css.menuFieldLabel}>{t('issueCopyLink')}</span>
            </PickerItem>
            <PickerItem selected={false} onSelect={() => { closeMenu(); setConfirmClose(true) }}>
              <span className={css.menuFieldLabel}>{t('issueClose')}</span>
            </PickerItem>
          </>
        )}
        {level === 'status' && (
          <>
            {backRow}
            {ISSUE_STATUS_OPTIONS.map(option => {
              const enabled = isHumanStatusTarget(option)
              return (
                <PickerItem
                  key={option}
                  selected={option === status}
                  disabled={!enabled}
                  describedBy={enabled ? undefined : STATUS_HINT_ID}
                  onSelect={() => { write(() => { if (option !== status) onStatus(option) }) }}
                >
                  <StatusIcon status={option} size={14} />
                  <span className={css.menuFieldLabel}>{t(STATUS_LABEL_KEY[option])}</span>
                </PickerItem>
              )
            })}
            <p id={STATUS_HINT_ID} className={`${look.multicaLook} ${css.menuHint}`}>{t('statusPickerLocked')}</p>
          </>
        )}
        {level === 'priority' && (
          <>
            {backRow}
            {PRIORITY_DISPLAY_ORDER.map(option => (
              <PickerItem
                key={option}
                selected={option === currentPriority}
                onSelect={() => { write(() => { if (option !== currentPriority) onPriority(option) }) }}
              >
                <PriorityIcon priority={option} size={12} inheritColor />
                <span className={css.menuFieldLabel}>{t(PRIORITY_LABEL_KEY[option])}</span>
              </PickerItem>
            ))}
          </>
        )}
        {level === 'assignee' && (
          <>
            {backRow}
            <PickerItem
              selected={currentMember === undefined && !orphan}
              onSelect={() => { write(() => { if (assignee != null) onAssignee(null) }) }}
            >
              <span className={css.menuUnassigned} aria-hidden="true">—</span>
              <span className={css.menuFieldLabel}>{t('assigneeUnassigned')}</span>
            </PickerItem>
            {members.map(member => (
              <PickerItem
                key={member.memberId}
                selected={member.memberId === assignee}
                onSelect={() => { write(() => { if (member.memberId !== assignee) onAssignee(member.memberId as AgentTeamMemberId) }) }}
              >
                <ActorAvatar name={member.handle} avatarUrl={member.avatarUrl} kind="agent" size="sm" />
                <span className={css.menuFieldLabel}>{member.handle}</span>
              </PickerItem>
            ))}
          </>
        )}
      </Menu>
      {confirmClose && (
        <Modal
          open
          onClose={() => { setConfirmClose(false) }}
          title={t('issueCloseConfirmTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <Button variant="outline" onClick={() => { setConfirmClose(false) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { setConfirmClose(false); if (!pending) onStatus('closed') }}>{t('issueClose')}</Button>
          </>}
        >
          <p className={css.menuConfirmBody}>{t('issueCloseConfirmBody')}</p>
        </Modal>
      )}
    </span>
  )
}
