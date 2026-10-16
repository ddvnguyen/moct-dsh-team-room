import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentTeamDocSectionView } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import css from './conversation.module.css'
import docCss from './doc.module.css'

interface TeamDocSectionEditorProps {
  /** The section as it is now; it may move on while the editor is open. */
  readonly section: AgentTeamDocSectionView
  /** The section text the edit started from; a different current text means someone wrote it meanwhile. */
  readonly baseMarkdown: string
  readonly saving: boolean
  readonly save: (heading: string, markdown: string) => void
  readonly cancel: () => void
  readonly markdownLabels: MarkdownLabels
  readonly t: TeamConversationProps['t']
}

/**
 * The Human's editor for one section: its heading and its whole Markdown body.
 * Saving is fenced by the Doc revision on the page. When the section changed
 * after the edit began, the newer text is shown above the draft, so a second
 * save overwrites it knowingly.
 */
export function TeamDocSectionEditor({ section, baseMarkdown, saving, save, cancel, markdownLabels, t }: TeamDocSectionEditorProps) {
  const [heading, setHeading] = useState(section.heading)
  const [markdown, setMarkdown] = useState(baseMarkdown)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { bodyRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    const input = bodyRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 480)}px`
  }, [markdown])
  const moved = section.markdown !== baseMarkdown
  const canSave = !saving && heading.trim() !== ''
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (canSave) save(heading, markdown) }
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
  }
  return <form className={docCss.editor} data-doc-editor={section.sectionId} onKeyDown={onKey}
    onSubmit={event => { event.preventDefault(); if (canSave) save(heading, markdown) }}>
    {moved && <div className={docCss.editorNewer} role="status">
      <p className={docCss.notice}>{t('docEditStale')}</p>
      {section.markdown === ''
        ? <p className={docCss.emptySection}>{t('docEmptySection')}</p>
        : <div className={`${css.messageMarkdown} ${docCss.markdown}`}><MarkdownText key={section.markdown} text={section.markdown} labels={markdownLabels} /></div>}
    </div>}
    <input className={docCss.editorHeading} aria-label={t('docEditHeading')} value={heading} disabled={saving}
      onChange={event => { setHeading(event.target.value) }} />
    <textarea ref={bodyRef} className={docCss.editorBody} aria-label={t('docEditBody')} value={markdown} disabled={saving} rows={4}
      onChange={event => { setMarkdown(event.target.value) }} />
    <div className={docCss.editorActions}>
      <span className={docCss.chatHint}>{t('docEditShortcut')}</span>
      <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>{t('docCancelEdit')}</Button>
      <Button size="sm" variant="primary" type="submit" disabled={!canSave}>{saving ? t('docSavingSection') : t('docSaveSection')}</Button>
    </div>
  </form>
}
