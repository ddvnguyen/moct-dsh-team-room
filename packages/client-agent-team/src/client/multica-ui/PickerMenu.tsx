// Derived from multica-x packages/views/issues/components/pickers/property-picker.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the Radix Popover becomes the dsh `Menu` primitive, which
// already owns outside-click, Escape and the post-selection focus return. The
// searchable variant and the deferred-mount optimisation are not ported: the
// Team pickers list at most a workspace roster, and the board mounts them only
// on interaction. The list is portaled so an `overflow` ancestor (a board
// column) cannot crop it; the trigger stops its click from reaching a
// clickable ancestor (a board card), which must not be a button or link
// itself.

import { useState, type ReactNode } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import look from '../multica-look.module.css'
import css from './picker-menu.module.css'

/**
 * The shared picker shell: one trigger, one menu, one selected row. The
 * trigger keeps its own content so a board card and a Task header can show the
 * same field at different densities.
 */
export function PickerMenu({ label, icon, triggerLabel, valueLabel, children }: {
  readonly label: ReactNode
  readonly icon?: ReactNode | undefined
  /** Accessible name for the trigger, which may render only an icon. */
  readonly triggerLabel: string
  /** The field's current value as text; the trigger's name becomes `triggerLabel: valueLabel` so it is not lost. */
  readonly valueLabel?: string | undefined
  readonly children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`${look.multicaLook} ${css.root}`}>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        autoFocus
        portal
        align="start"
        className={css.anchor}
        listClassName={`${look.multicaLook} ${css.list}`}
        anchor={(
          <button
            type="button"
            className={css.trigger}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={valueLabel === undefined ? triggerLabel : `${triggerLabel}: ${valueLabel}`}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(value => !value)
            }}
          >
            {icon}
            <span className={css.triggerLabel}>{label}</span>
            <IconChevronDownOutlineRegular size={12} className={css.chevron} />
          </button>
        )}
      >
        {children(() => setOpen(false))}
      </Menu>
    </span>
  )
}

/**
 * One selectable row. A disabled row still renders (the field explains why it
 * cannot move, through the hint `describedBy` points at) and the Menu's
 * keyboard walk skips disabled buttons, so arrows cannot choose it either.
 */
export function PickerItem({ selected, disabled = false, describedBy, onSelect, children }: {
  readonly selected: boolean
  readonly disabled?: boolean
  /** Id of the visible hint that explains why a row is disabled. */
  readonly describedBy?: string | undefined
  readonly onSelect: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={css.item}
      data-selected={selected || undefined}
      aria-current={selected || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={css.itemBody}>{children}</span>
      <span className={css.check} aria-hidden="true">
        {selected && <IconCheckOutlineRegular size={12} />}
      </span>
    </button>
  )
}
