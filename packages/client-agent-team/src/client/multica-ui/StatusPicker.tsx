// Derived from multica-x packages/views/issues/components/pickers/status-picker.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: no workspace status catalog, no workflows and no
// duplicate action. The list is the ledger's five derived statuses; only the
// three human targets are enabled, because `in_progress` and `in_review` are
// set by Claims.

import type { TaskStatus } from '../multica/types.ts'
import { isHumanStatusTarget, STATUS_LABEL_KEY, STATUS_ORDER } from '../multica/status.ts'
import type { TeamSidebarProps } from '../slots.ts'
import look from '../multica-look.module.css'
import { PickerItem, PickerMenu } from './PickerMenu.tsx'
import { StatusIcon } from './StatusIcon.tsx'
import css from './status-picker.module.css'

/** Status picker: drag-free status change from a Task header or board card. */
export function StatusPicker({ status, onChange, t }: {
  readonly status: TaskStatus
  readonly onChange: (status: TaskStatus) => void
  readonly t: TeamSidebarProps['t']
}) {
  return (
    <PickerMenu
      triggerLabel={t('statusPickerLabel')}
      icon={<StatusIcon status={status} size={14} />}
      label={t(STATUS_LABEL_KEY[status])}
    >
      {close => (
        <>
          {STATUS_ORDER.map(option => {
            const enabled = isHumanStatusTarget(option)
            return (
              <PickerItem
                key={option}
                selected={option === status}
                disabled={!enabled}
                tooltip={enabled ? undefined : t('statusPickerLocked')}
                onSelect={() => {
                  close()
                  if (enabled && option !== status) onChange(option)
                }}
              >
                <StatusIcon status={option} size={14} />
                <span className={css.label}>{t(STATUS_LABEL_KEY[option])}</span>
              </PickerItem>
            )
          })}
          <p className={`${look.multicaLook} ${css.hint}`}>{t('statusPickerLocked')}</p>
        </>
      )}
    </PickerMenu>
  )
}
