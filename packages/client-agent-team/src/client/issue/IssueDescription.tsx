// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's description block with the editor the M-39 cut
// left out — an in-place editor on the existing record, not a new surface. The
// pattern is the doc section editor's: a textarea that grows with its text, a
// `MarkdownText` preview of the draft, Save/Cancel, ⌘/Ctrl+Enter to save and
// Esc to cancel.
//
// The write is not optimistic and it is fenced by the description's own
// revision, not the Thread's: the Host commits, the change-wake refetches, and
// only then does the record move. A refusal keeps the draft on screen; when the
// record has moved on, the current text appears beside the draft with a way to
// load it — the editor never overwrites the reader's words by itself.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentTeamIssueDescription } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, IconEditOutlineRegular, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueDescriptionProps {
  /** The Host-resolved description record: body, author, instant, provenance. */
  readonly description: AgentTeamIssueDescription
  /** The display name of the Member who wrote the body. */
  readonly authorName: string
  /** Commits the draft; resolves with the failure message, or undefined when the Host took it. */
  readonly patchDescription: (body: string) => Promise<string | undefined>
  /** A write is in flight; the editor waits for it. */
  readonly pending: boolean
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's description: what the Task is, in the words that are already
 * durable, and the Human's editor for those words. The body's provenance is
 * shown, so a reader can tell an anchor body from a plan's approved one and a
 * direct edit from either.
 */
export function IssueDescription({ description, authorName, patchDescription, pending, t }: IssueDescriptionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  // The fence the edit started from: while the record's own revision is still
  // this, the draft is editing that text; when it moves, the reader is told.
  const [baseRevision, setBaseRevision] = useState<number>()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // Enter and blur paths can both commit; the busy ref keeps a second submit
  // from racing the first.
  const busy = useRef(false)
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') },
    footnotes: t('markdownFootnotes'),
  }), [t])

  useEffect(() => { bodyRef.current?.focus({ preventScroll: true }) }, [editing])
  useEffect(() => {
    const input = bodyRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 320)}px`
  }, [draft, editing])

  const startEdit = (): void => {
    setDraft(description.body)
    setBaseRevision(description.revision)
    setError(undefined)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setDraft('')
    setError(undefined)
    setBaseRevision(undefined)
  }

  const loadLatest = (): void => {
    setDraft(description.body)
    setBaseRevision(description.revision)
    setError(undefined)
  }

  const save = (): void => {
    if (busy.current || pending || !editing) return
    busy.current = true
    setError(undefined)
    void (async () => {
      try {
        const failure = await patchDescription(draft)
        // Committed: the editor closes and the record moves when the change-wake
        // refetches — nothing here moves the text itself. A refusal keeps the
        // draft exactly as it was.
        if (failure === undefined) cancelEdit(); else setError(failure)
      } finally {
        busy.current = false
      }
    })()
  }

  const onKey = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() }
    if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
  }

  const body = description.body.trim()
  // The record moved while the draft was open: the current text is shown
  // beside it, and loading it is the reader's call — never automatic.
  const moved = editing && baseRevision !== undefined && description.revision !== baseRevision

  if (editing) {
    return (
      <section className={css.region} aria-label={t('issueDescriptionLabel')} data-testid="issue-description">
        <h2 className={css.regionHeading}>{t('issueDescriptionLabel')}</h2>
        <form className={css.descriptionEditor} onKeyDown={onKey} onSubmit={event => { event.preventDefault(); save() }}>
          {moved && (
            <div className={css.descriptionNotice} role="status">
              <p className={css.descriptionNoticeText}>{t('issueDescriptionStale')}</p>
              <div className={css.descriptionNoticeBody} data-testid="issue-description-current">
                <MarkdownText text={description.body} labels={labels} />
              </div>
              <Button size="sm" variant="ghost" onClick={loadLatest}>{t('issueDescriptionReload')}</Button>
            </div>
          )}
          <textarea
            ref={bodyRef}
            className={css.descriptionInput}
            data-testid="issue-description-input"
            aria-label={t('issueDescriptionEdit')}
            rows={4}
            value={draft}
            disabled={pending}
            onChange={event => { setDraft(event.currentTarget.value) }}
          />
          {draft.trim() !== '' && (
            <div className={css.descriptionPreview} data-testid="issue-description-preview">
              <MarkdownText text={draft} labels={labels} />
            </div>
          )}
          {error !== undefined && <p className={css.descriptionError} role="alert">{error}</p>}
          <div className={css.descriptionActions}>
            <span className={css.descriptionHint}>{t('docEditShortcut')}</span>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={pending} data-testid="issue-description-cancel">{t('issueDescriptionCancel')}</Button>
            <Button size="sm" variant="primary" type="submit" disabled={pending} data-testid="issue-description-save">{t('issueDescriptionSave')}</Button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className={css.region} aria-label={t('issueDescriptionLabel')} data-testid="issue-description">
      <div className={css.regionHead}>
        <h2 className={css.regionHeading}>{t('issueDescriptionLabel')}</h2>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconEditOutlineRegular size={14} />}
          aria-label={t('issueDescriptionEdit')}
          title={t('issueDescriptionEdit')}
          disabled={pending}
          onClick={startEdit}
          data-testid="issue-description-edit"
        />
      </div>
      {body === ''
        ? <p className={css.empty}>{t('issueDescriptionEmpty')}</p>
        : <p className={css.description} data-testid="issue-description-body">{body}</p>}
      <p className={css.descriptionMeta}>
        {authorName}
        {description.editedAt !== undefined ? ` · ${t('issueDescriptionEdited')}` : ''}
        {description.source === 'approvedPlan' ? ` · ${t('issueDescriptionFromPlan')}` : ''}
      </p>
    </section>
  )
}
