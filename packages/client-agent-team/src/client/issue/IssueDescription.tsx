// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's description block with the editor the M-39 cut
// left out — an in-place editor on the existing record, not a new surface. The
// pattern is the doc section editor's: a textarea that grows with its text,
// Save/Cancel, ⌘/Ctrl+Enter to save and Esc to cancel.
//
// The editor carries the two affordances GitHub's issue editor has: Write and
// Preview tabs over the same draft, and a Markdown toolbar that wraps or
// prefixes the current selection on the Write tab. Both are plain-text edits of
// the body — the toolbar inserts Markdown source, the Preview tab renders that
// same source with `MarkdownText`, and the `description` patch stays Markdown.
//
// The write is not optimistic and it is fenced by the description's own
// revision, not the Thread's: the Host commits, the change-wake refetches, and
// only then does the record move. A refusal keeps the draft on screen; when the
// record has moved on, the current text appears beside the draft with a way to
// load it — the editor never overwrites the reader's words by itself.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentTeamIssueDescription } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, IconEditOutlineRegular, MarkdownText, SegmentedTabs, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

/** The draft's two modes: the Markdown source, and the same source rendered. */
type EditorTab = 'write' | 'preview'

/** One Markdown-formatting edit the toolbar can make. */
type MarkdownAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'bulletList' | 'numberList' | 'taskList'

/** A textarea's value and selection after one formatting edit. */
interface MarkdownEdit {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

/** The delimiters a wrap action puts on either side of the selection. */
const WRAPS: Partial<Record<MarkdownAction, readonly [string, string]>> = {
  bold: ['**', '**'],
  italic: ['_', '_'],
  code: ['`', '`'],
}

/** The prefix a line action puts in front of every line the selection touches. */
const LINE_PREFIXES: Partial<Record<MarkdownAction, string>> = {
  heading: '## ',
  quote: '> ',
  bulletList: '- ',
  numberList: '1. ',
  taskList: '- [ ] ',
}

/**
 * Apply one formatting action to a textarea's value and selection. Pure text:
 * the result is the new source and where the selection lands in it, so the
 * caller can restore focus and selection once React has painted the value.
 * Wrap actions keep the selected text selected (inside the markers); a link
 * selects its `url` placeholder, the way GitHub's does, so typing replaces it.
 */
function applyMarkdown(value: string, selectionStart: number, selectionEnd: number, action: MarkdownAction): MarkdownEdit {
  const selected = value.slice(selectionStart, selectionEnd)
  if (action === 'link') {
    const urlStart = selectionStart + selected.length + 3
    return {
      value: `${value.slice(0, selectionStart)}[${selected}](url)${value.slice(selectionEnd)}`,
      selectionStart: urlStart,
      selectionEnd: urlStart + 3,
    }
  }
  const wrap = WRAPS[action]
  if (wrap !== undefined) {
    const [open, close] = wrap
    return {
      value: `${value.slice(0, selectionStart)}${open}${selected}${close}${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + open.length,
      selectionEnd: selectionEnd + open.length,
    }
  }
  const prefix = LINE_PREFIXES[action] ?? ''
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const lineBreak = value.indexOf('\n', selectionEnd)
  const lineEnd = lineBreak === -1 ? value.length : lineBreak
  const prefixed = value.slice(lineStart, lineEnd).split('\n').map(line => `${prefix}${line}`).join('\n')
  return {
    value: `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + prefixed.length,
  }
}

/** The toolbar's buttons, in GitHub's order, as source text the reader can read. */
const TOOLBAR: readonly {
  action: MarkdownAction
  glyph: string
  label: Parameters<TeamConversationProps['t']>[0]
  className?: string | undefined
}[] = [
  { action: 'heading', glyph: 'H', label: 'issueDescriptionFormatHeading' },
  { action: 'bold', glyph: 'B', label: 'issueDescriptionFormatBold', className: css.toolGlyphBold },
  { action: 'italic', glyph: 'I', label: 'issueDescriptionFormatItalic', className: css.toolGlyphItalic },
  { action: 'quote', glyph: '>', label: 'issueDescriptionFormatQuote' },
  { action: 'code', glyph: '`', label: 'issueDescriptionFormatCode', className: css.toolGlyphCode },
  { action: 'link', glyph: 'A', label: 'issueDescriptionFormatLink', className: css.toolGlyphLink },
  { action: 'bulletList', glyph: '\u2022', label: 'issueDescriptionFormatBulletList' },
  { action: 'numberList', glyph: '1.', label: 'issueDescriptionFormatNumberList' },
  { action: 'taskList', glyph: '[ ]', label: 'issueDescriptionFormatTaskList' },
]

export interface IssueDescriptionProps {
  /** The Host-resolved description record: body, author, instant, provenance. */
  readonly description: AgentTeamIssueDescription
  /** The display name of the Member who wrote the body. */
  readonly authorName: string
  /**
   * Commits the draft against the revision the edit started from; resolves
   * with the failure message, or undefined when the Host took it. The fence
   * travels with the call — a record that moved while the editor was open is
   * refused, never overwritten.
   */
  readonly patchDescription: (body: string, baseDescriptionRevision: number) => Promise<string | undefined>
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
  const [tab, setTab] = useState<EditorTab>('write')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  // The fence the edit started from: while the record's own revision is still
  // this, the draft is editing that text; when it moves, the reader is told.
  const [baseRevision, setBaseRevision] = useState<number>()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // A toolbar edit sets the selection the textarea should carry once React has
  // painted the new value; typing leaves it unset, so the browser's own caret
  // is never overridden.
  const pendingSelection = useRef<readonly [number, number]>()
  // Enter and blur paths can both commit; the busy ref keeps a second submit
  // from racing the first.
  const busy = useRef(false)
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') },
    footnotes: t('markdownFootnotes'),
  }), [t])

  useEffect(() => {
    if (tab !== 'write') return
    bodyRef.current?.focus({ preventScroll: true })
  }, [editing, tab])
  useEffect(() => {
    const input = bodyRef.current
    // A hidden textarea reports no scrollHeight; sizing waits for the Write tab.
    if (input === null || tab !== 'write') return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 320)}px`
  }, [draft, editing, tab])
  useEffect(() => {
    const selection = pendingSelection.current
    if (selection === undefined) return
    pendingSelection.current = undefined
    const input = bodyRef.current
    if (input === null) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(selection[0], selection[1])
  }, [draft])

  const startEdit = (): void => {
    setDraft(description.body)
    setBaseRevision(description.revision)
    setError(undefined)
    setTab('write')
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setTab('write')
    setDraft('')
    setError(undefined)
    setBaseRevision(undefined)
  }

  // One toolbar press: the edit is computed against the textarea's own
  // selection, and the selection it should carry afterwards is handed to the
  // effect above, which restores focus and selection once the value paints.
  const format = (action: MarkdownAction): void => {
    const input = bodyRef.current
    if (input === null || pending) return
    const edit = applyMarkdown(draft, input.selectionStart, input.selectionEnd, action)
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd]
    setDraft(edit.value)
  }

  const loadLatest = (): void => {
    setDraft(description.body)
    setBaseRevision(description.revision)
    setError(undefined)
  }

  const save = (): void => {
    // The fence is the revision this edit started from: while editing it is
    // always set, and it is what makes a record that moved meanwhile a refusal
    // instead of an overwrite.
    if (busy.current || pending || !editing || baseRevision === undefined) return
    const baseDescriptionRevision = baseRevision
    busy.current = true
    setError(undefined)
    void (async () => {
      try {
        const failure = await patchDescription(draft, baseDescriptionRevision)
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
          <SegmentedTabs
            className={css.descriptionTabs}
            label={t('issueDescriptionTabsLabel')}
            value={tab}
            onChange={setTab}
            items={[
              { value: 'write', label: t('issueDescriptionTabWrite'), id: 'issue-description-write-tab', panelId: 'issue-description-write-panel' },
              { value: 'preview', label: t('issueDescriptionTabPreview'), id: 'issue-description-preview-tab', panelId: 'issue-description-preview-panel' },
            ]}
          />
          <div
            id="issue-description-write-panel"
            role="tabpanel"
            aria-labelledby="issue-description-write-tab"
            className={css.descriptionWrite}
            hidden={tab !== 'write'}
          >
            {/* The press must not take focus from the textarea: the selection
                the button formats is the one that is still there. */}
            <div
              className={css.descriptionToolbar}
              role="toolbar"
              aria-label={t('issueDescriptionToolbar')}
              onMouseDown={event => { event.preventDefault() }}
            >
              {TOOLBAR.map(item => (
                <button
                  key={item.action}
                  type="button"
                  className={item.className === undefined ? css.toolButton : `${css.toolButton} ${item.className}`}
                  aria-label={t(item.label)}
                  title={t(item.label)}
                  disabled={pending}
                  onClick={() => { format(item.action) }}
                  data-testid={`issue-description-format-${item.action}`}
                >{item.glyph}</button>
              ))}
            </div>
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
          </div>
          <div
            id="issue-description-preview-panel"
            role="tabpanel"
            aria-labelledby="issue-description-preview-tab"
            className={css.descriptionPreview}
            data-testid="issue-description-preview"
            hidden={tab !== 'preview'}
          >
            {draft.trim() === ''
              ? <p className={css.empty}>{t('issueDescriptionPreviewEmpty')}</p>
              : <MarkdownText text={draft} labels={labels} />}
          </div>
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
