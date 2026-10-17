// Derived from multica-x packages/views/issues/components/pickers/assignee-picker.tsx and
// packages/views/issues/components/pickers/property-picker.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: members only (no squads, no humans, no frequency
// ranking), no deferred popup, and the roster arrives as props. "Unassigned"
// is pinned first and writes `null`; assignment never claims the Task.

import type { TeamSidebarProps } from '../slots.ts'
import { PickerItem, PickerMenu } from './PickerMenu.tsx'
import { ActorAvatar } from './ActorAvatar.tsx'
import type { AvatarStackMember } from './AgentAvatarStack.tsx'
import css from './assignee-picker.module.css'

/** The roster slice the assignee picker offers. */
export type AssigneeOption = AvatarStackMember

/**
 * Assignee picker over the workspace's Agent Members. Choosing a member sets
 * the Task's `assignee`; choosing "Unassigned" clears it. Neither action
 * claims the Task or wakes the member — the Host does that on commit.
 */
export function AssigneePicker({ assignee, members, onChange, t }: {
  readonly assignee: string | null | undefined
  readonly members: readonly AssigneeOption[]
  readonly onChange: (memberId: string | null) => void
  readonly t: TeamSidebarProps['t']
}) {
  const current = members.find(member => member.memberId === assignee)
  return (
    <PickerMenu
      triggerLabel={t('assigneePickerLabel')}
      icon={current === undefined ? undefined : <ActorAvatar name={current.handle} avatarUrl={current.avatarUrl} kind="agent" size="xs" />}
      label={current === undefined ? <span className={css.unassigned}>{t('assigneeUnassigned')}</span> : current.handle}
    >
      {close => (
        <>
          <PickerItem
            selected={current === undefined}
            onSelect={() => {
              close()
              if (assignee != null) onChange(null)
            }}
          >
            <span className={css.unassignedIcon} aria-hidden="true">—</span>
            <span className={css.unassigned}>{t('assigneeUnassigned')}</span>
          </PickerItem>
          {members.map(member => (
            <PickerItem
              key={member.memberId}
              selected={member.memberId === assignee}
              onSelect={() => {
                close()
                if (member.memberId !== assignee) onChange(member.memberId)
              }}
            >
              <ActorAvatar name={member.handle} avatarUrl={member.avatarUrl} kind="agent" size="sm" />
              <span className={css.handle}>{member.handle}</span>
            </PickerItem>
          ))}
        </>
      )}
    </PickerMenu>
  )
}
