// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentTeamIssueDescription, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { zh } from '../src/client/locales.ts'
import { IssueDescription, type IssueDescriptionProps } from '../src/client/issue/IssueDescription.tsx'
import type { TeamConversationProps } from '../src/client/slots.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

const translate = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}) as unknown as TeamConversationProps['t']

const human = 'member:human' as AgentTeamMemberId

function description(overrides: Partial<AgentTeamIssueDescription> = {}): AgentTeamIssueDescription {
  return {
    body: 'The anchor body.',
    author: human,
    occurredAt: '2026-10-22T01:00:00.000Z',
    source: 'anchor',
    revision: 3,
    ...overrides,
  }
}

function renderDescription(overrides: Partial<IssueDescriptionProps> = {}) {
  const patchDescription = vi.fn(async () => undefined)
  const props: IssueDescriptionProps = {
    description: description(),
    authorName: 'ddvnguyen',
    patchDescription,
    pending: false,
    t: translate,
    ...overrides,
  }
  const view = render(<IssueDescription {...props} />)
  return { view, props }
}

describe('the issue description', () => {
  it('edits in place: Save commits the draft and the record moves only on the next read', async () => {
    const { view, props } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const draft = view.getByTestId('issue-description-input') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'The edited body.' } })
    fireEvent.click(view.getByTestId('issue-description-save'))

    await waitFor(() => { expect(props.patchDescription).toHaveBeenCalledWith('The edited body.', 3) })
    // The editor closes on the commit, and the body does NOT move here: the
    // write is not optimistic, the change-wake refetch settles it.
    await waitFor(() => { expect(view.queryByTestId('issue-description-input')).toBeNull() })
    expect(view.getByTestId('issue-description-body').textContent).toBe('The anchor body.')
  })

  it('saves against the revision the edit started from, so a moved record refuses the write', async () => {
    const patchDescription = vi.fn(async () => 'stale description revision')
    const { view, props } = renderDescription({ patchDescription })
    fireEvent.click(view.getByTestId('issue-description-edit'))
    fireEvent.change(view.getByTestId('issue-description-input'), { target: { value: 'my words' } })

    // Another writer's paragraph lands while this draft is open: the record is
    // at revision 4, this edit still speaks for revision 3.
    view.rerender(<IssueDescription {...props} description={description({ revision: 4, body: 'Their newer body.' })} />)

    fireEvent.click(view.getByTestId('issue-description-save'))
    // The fence travels with the call — the edit-start revision, never the one
    // the save happens to see, which is what would overwrite theirs.
    await waitFor(() => { expect(patchDescription).toHaveBeenCalledWith('my words', 3) })
    // The Host refused it, and the reader's words are untouched.
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('stale description revision') })
    expect(view.getByTestId('issue-description-current').textContent).toContain('Their newer body.')
    expect((view.getByTestId('issue-description-input') as HTMLTextAreaElement).value).toBe('my words')
  })

  it('keeps the draft and says why when the write is refused', async () => {
    const patchDescription = vi.fn(async () => 'stale revision')
    const { view } = renderDescription({ patchDescription })
    fireEvent.click(view.getByTestId('issue-description-edit'))
    fireEvent.change(view.getByTestId('issue-description-input'), { target: { value: 'words worth keeping' } })
    fireEvent.click(view.getByTestId('issue-description-save'))

    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('stale revision') })
    // The refusal never overwrites: the draft is still the reader's text.
    expect((view.getByTestId('issue-description-input') as HTMLTextAreaElement).value).toBe('words worth keeping')
  })

  it('Cancel closes the editor and leaves the record as it was', () => {
    const { view, props } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    fireEvent.change(view.getByTestId('issue-description-input'), { target: { value: 'abandoned' } })
    fireEvent.click(view.getByTestId('issue-description-cancel'))

    expect(view.queryByTestId('issue-description-input')).toBeNull()
    expect(props.patchDescription).not.toHaveBeenCalled()
    expect(view.getByTestId('issue-description-body').textContent).toBe('The anchor body.')
  })

  it('shows the current text beside the draft when the record moved, and takes it on request', () => {
    const patchDescription = vi.fn(async () => 'stale description revision')
    const { view, props } = renderDescription({ patchDescription })
    fireEvent.click(view.getByTestId('issue-description-edit'))
    fireEvent.change(view.getByTestId('issue-description-input'), { target: { value: 'my draft' } })
    fireEvent.click(view.getByTestId('issue-description-save'))

    // The read the change-wake refetched lands while the draft is open: the
    // newer text appears beside it, and nothing replaces the draft by itself.
    view.rerender(<IssueDescription {...props} description={description({ revision: 4, body: 'The newer body.' })} />)
    expect(view.getByTestId('issue-description-current').textContent).toContain('The newer body.')
    expect((view.getByTestId('issue-description-input') as HTMLTextAreaElement).value).toBe('my draft')

    fireEvent.click(screen.getByRole('button', { name: zh.issueDescriptionReload }))
    expect((view.getByTestId('issue-description-input') as HTMLTextAreaElement).value).toBe('The newer body.')
    expect(screen.queryByText(zh.issueDescriptionStale)).toBeNull()
  })

  it('cancels the edit on Escape', () => {
    const { view, props } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    fireEvent.keyDown(view.getByTestId('issue-description-input'), { key: 'Escape' })

    expect(view.queryByTestId('issue-description-input')).toBeNull()
    expect(props.patchDescription).not.toHaveBeenCalled()
  })

  it('wraps the selection in Markdown and leaves it selected', async () => {
    const { view, props } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const draft = view.getByTestId('issue-description-input') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'the anchor body' } })
    draft.setSelectionRange(4, 10)

    fireEvent.click(view.getByTestId('issue-description-format-bold'))

    // Plain source in, plain source out: the toolbar wraps the words it was
    // given and the same words stay selected for the next edit.
    expect(draft.value).toBe('the **anchor** body')
    expect([draft.selectionStart, draft.selectionEnd]).toEqual([6, 12])
    expect(draft.value.slice(draft.selectionStart, draft.selectionEnd)).toBe('anchor')

    // What commits is the Markdown source, unchanged in shape by the editor.
    fireEvent.click(view.getByTestId('issue-description-save'))
    await waitFor(() => { expect(props.patchDescription).toHaveBeenCalledWith('the **anchor** body', 3) })
  })

  it('prefixes every line the selection touches', () => {
    const { view } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const draft = view.getByTestId('issue-description-input') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'first\nsecond' } })
    draft.setSelectionRange(0, 'first\nsecond'.length)

    fireEvent.click(view.getByTestId('issue-description-format-taskList'))

    expect(draft.value).toBe('- [ ] first\n- [ ] second')
  })

  it('opens the markers and puts the caret between them when nothing is selected', () => {
    const { view } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const draft = view.getByTestId('issue-description-input') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'ab' } })
    draft.setSelectionRange(1, 1)

    fireEvent.click(view.getByTestId('issue-description-format-bold'))

    expect(draft.value).toBe('a****b')
    expect([draft.selectionStart, draft.selectionEnd]).toEqual([3, 3])
  })

  it('previews the draft on the Preview tab and keeps the source and the shortcut', async () => {
    const { view, props } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const source = '## Steps\n\n**bold** plan'
    fireEvent.change(view.getByTestId('issue-description-input'), { target: { value: source } })

    fireEvent.click(view.getByRole('tab', { name: zh.issueDescriptionTabPreview }))
    const preview = view.getByTestId('issue-description-preview')
    // The preview renders the draft as Markdown — the same MarkdownText the
    // record itself is read with — and the draft is not edited by the switch.
    expect(preview.querySelector('strong')?.textContent).toBe('bold')
    expect(preview.textContent).toContain('Steps')
    expect(view.getByTestId('issue-description-input').closest('[hidden]')).not.toBeNull()

    // ⌘/Ctrl+Enter still commits from the Preview tab, and it commits the source.
    fireEvent.keyDown(preview, { key: 'Enter', metaKey: true })
    await waitFor(() => { expect(props.patchDescription).toHaveBeenCalledWith(source, 3) })
  })

  it('returns to the Write tab with the draft untouched', () => {
    const { view } = renderDescription()
    fireEvent.click(view.getByTestId('issue-description-edit'))
    const draft = view.getByTestId('issue-description-input') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'kept across tabs' } })

    fireEvent.click(view.getByRole('tab', { name: zh.issueDescriptionTabPreview }))
    fireEvent.click(view.getByRole('tab', { name: zh.issueDescriptionTabWrite }))

    expect(draft.value).toBe('kept across tabs')
    expect(draft.closest('[hidden]')).toBeNull()
  })
})
