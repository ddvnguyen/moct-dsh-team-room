// Derived from multica-x packages/views/modals/create-issue-dialog.tsx @
// 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// One dialog for both directions: the board's "+ Add list" and a column's
// "Rename list" open this same editor, so the two surfaces cannot drift apart.
// The contract is the Multica board's list editor — a name and a lifecycle
// category, nothing else — and the shell is the dsh `Modal`, like the other
// Team dialogs: it owns Escape, focus containment and the mask.

import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from '../slots.ts'
import { STATUS_CATEGORY_LABEL_KEY, STATUS_CATEGORY_ORDER } from '../multica/status.ts'
import type { StatusCategory } from '../multica/types.ts'
import look from '../multica-look.module.css'
import css from './board.module.css'

export interface StatusDraft {
  readonly label: string
  readonly category: StatusCategory
}

export interface StatusEditorDialogProps {
  /** `add` opens empty behind "+ Add list"; `rename` opens on the list being edited. */
  readonly mode: 'add' | 'rename'
  readonly initial?: StatusDraft | undefined
  readonly onSave: (draft: StatusDraft) => Promise<void>
  readonly onClose: () => void
  readonly t: TeamSidebarProps['t']
}

/** Add or rename one Board list: a name and a category, nothing else. */
export function StatusEditorDialog({ mode, initial, onSave, onClose, t }: StatusEditorDialogProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [category, setCategory] = useState<StatusCategory>(initial?.category ?? 'unstarted')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const canSubmit = !saving && label.trim() !== ''

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSaving(true)
    setError(undefined)
    try {
      await onSave({ label: label.trim(), category })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(mode === 'add' ? 'boardAddListTitle' : 'boardRenameListTitle')}
      closeLabel={t('close')}
      footer={(
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} data-testid="board-list-submit" onClick={() => { void submit() }}>
            {t('boardListSave')}
          </Button>
        </>
      )}
    >
      <div className={`${look.multicaLook} ${css.dialogForm}`} data-testid="board-list-dialog">
        <label className={css.fieldLabel}>
          {t('boardListName')}
          <input
            className={css.fieldInput}
            value={label}
            data-testid="board-list-name"
            data-modal-autofocus=""
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }}
          />
        </label>
        <label className={css.fieldLabel}>
          {t('boardListCategory')}
          <select
            className={css.fieldSelect}
            value={category}
            data-testid="board-list-category"
            onChange={event => setCategory(event.target.value as StatusCategory)}
          >
            {STATUS_CATEGORY_ORDER.map(option => (
              <option key={option} value={option}>{t(STATUS_CATEGORY_LABEL_KEY[option])}</option>
            ))}
          </select>
        </label>
        {error !== undefined && <p className={css.dialogError} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
