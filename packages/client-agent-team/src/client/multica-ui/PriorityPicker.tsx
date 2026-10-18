// Derived from multica-x packages/views/issues/components/pickers/priority-picker.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: no deferred popup and no workflow awareness. The row is a
// Multica priority chip (badge fill + glyph) built from the scoped look layer.

import type { TaskPriority } from '../multica/types.ts'
import { normalizePriority, PRIORITY_DISPLAY_ORDER, PRIORITY_LABEL_KEY } from '../multica/priority.ts'
import type { TeamSidebarProps } from '../slots.ts'
import { PickerItem, PickerMenu } from './PickerMenu.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'
import css from './priority-picker.module.css'

/** Priority picker: "No priority" leads, then severity descending. */
export function PriorityPicker({ priority, onChange, t }: {
  readonly priority: TaskPriority | undefined
  readonly onChange: (priority: TaskPriority) => void
  readonly t: TeamSidebarProps['t']
}) {
  const current = normalizePriority(priority)
  return (
    <PickerMenu
      triggerLabel={t('priorityPickerLabel')}
      valueLabel={t(PRIORITY_LABEL_KEY[current])}
      icon={<PriorityIcon priority={current} size={14} />}
      label={t(PRIORITY_LABEL_KEY[current])}
    >
      {close => PRIORITY_DISPLAY_ORDER.map(option => (
        <PickerItem
          key={option}
          selected={option === current}
          onSelect={() => {
            close()
            if (option !== current) onChange(option)
          }}
        >
          <span className={css.chip} data-priority={option}>
            <PriorityIcon priority={option} size={12} inheritColor />
            {t(PRIORITY_LABEL_KEY[option])}
          </span>
        </PickerItem>
      ))}
    </PickerMenu>
  )
}
