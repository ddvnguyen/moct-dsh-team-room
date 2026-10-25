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
})
