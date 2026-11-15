// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import type { AgentTeamIssueProperties, AgentTeamTaskRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { IssueProperties, type ParentTaskOption } from '../src/client/issue/IssueProperties.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

afterEach(cleanup)

const workspaceId = 'workspace:alpha' as WorkspaceId
const taskRef = 'task:one' as AgentTeamTaskRef
const parentRef = 'task:parent' as AgentTeamTaskRef
const childRef = 'task:child' as AgentTeamTaskRef

const tasks: readonly ParentTaskOption[] = [
  { taskRef, taskNumber: 12, title: 'This task', status: 'todo' },
  { taskRef: parentRef, taskNumber: 3, title: 'The parent', status: 'todo' },
]

function properties(overrides: Partial<AgentTeamIssueProperties> = {}): AgentTeamIssueProperties {
  return {
    status: 'todo',
    resolution: 'open',
    priority: 'none',
    position: 0,
    channelRef: 'channel:room' as never,
    channelName: 'Room',
    taskNumber: 12,
    claimOwners: [],
    planningPhase: true,
    subIssues: [],
    pullRequests: [],
    labels: [],
    createdAt: '2026-10-22T01:00:00.000Z',
    updatedAt: '2026-10-22T02:00:00.000Z',
    ...overrides,
  }
}

interface Handlers {
  readonly onParent?: (taskRef: AgentTeamTaskRef | null) => void
  readonly onDueDate?: (dueDate: string | null) => void
  readonly onPullRequests?: (links: readonly { readonly url: string; readonly title?: string | undefined }[]) => void
  readonly onLabels?: (labels: readonly string[]) => void
  readonly openIssue?: (taskRef: AgentTeamTaskRef, options?: { readonly workspaceId?: WorkspaceId }) => void
}

function renderProperties(overrides: Partial<AgentTeamIssueProperties> = {}, handlers: Handlers = {}): RenderResult {
  return render(
    <IssueProperties
      properties={properties(overrides)}
      workspaceId={workspaceId}
      members={[]}
      taskRef={taskRef}
      tasks={tasks}
      onStatus={() => {}}
      onPriority={() => {}}
      onAssignee={() => {}}
      onParent={handlers.onParent ?? (() => {})}
      onDueDate={handlers.onDueDate ?? (() => {})}
      onPullRequests={handlers.onPullRequests ?? (() => {})}
      onLabels={handlers.onLabels ?? (() => {})}
      openIssue={handlers.openIssue}
      pending={false}
      docsCount={0}
      decisionsCount={0}
      t={t}
    />,
  )
}

/** The parent-picker trigger: its accessible name carries the current value, so it is read from the element. */
function pickerTrigger(view: RenderResult): HTMLElement {
  const row = view.getByTestId('issue-prop-parent')
  const trigger = row.querySelector<HTMLElement>('button[aria-haspopup="menu"]')
  if (trigger === null) throw new Error('the parent picker trigger is not mounted')
  return trigger
}

/** Opens the Related group, which the sidebar starts collapsed. */
function openRelated(view: RenderResult): void {
  const heading = view.getAllByRole('button', { name: zh.propRelated })[0]
  if (heading === undefined) throw new Error('the Related group is not mounted')
  if (heading.getAttribute('aria-expanded') !== 'true') fireEvent.click(heading)
}

describe('IssueProperties M-92 sections', () => {
  it('shows the parent row empty and opens the picker over the workspace tasks, excluding the task itself', () => {
    const view = renderProperties()
    expect(view.getByTestId('issue-prop-parent').textContent).toContain(zh.parentNone)

    fireEvent.click(pickerTrigger(view))
    // The workspace tasks are the options; the Task itself is disabled.
    expect(screen.getByTestId('parent-option-3').closest('button')?.textContent).toBe('#3 The parent')
    expect(screen.getByTestId('parent-option-12').closest('button')?.disabled).toBe(true)
  })

  it('chooses a parent through the picker and clears it with None', () => {
    const onParent = vi.fn()
    const view = renderProperties({}, { onParent })
    fireEvent.click(pickerTrigger(view))
    expect(screen.getByTestId('parent-option-3').closest('button')?.disabled).toBe(false)
    fireEvent.click(screen.getByTestId('parent-option-3'))
    expect(onParent).toHaveBeenCalledWith(parentRef)
  })

  it('clears the parent with the None row', () => {
    const onParent = vi.fn()
    const view = renderProperties({ parent: { taskRef: parentRef, taskNumber: 3, title: 'The parent', status: 'in_progress' } }, { onParent })
    expect(view.getByTestId('issue-prop-parent-value').textContent).toBe('#3 The parent')
    fireEvent.click(pickerTrigger(view))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.parentNone }))
    expect(onParent).toHaveBeenCalledWith(null)
  })

  it('renders the due date and tints it only while it is past due and open', () => {
    const view = renderProperties({ dueDate: '2026-01-01' })
    expect((view.getByTestId('issue-prop-date') as HTMLInputElement).value).toBe('2026-01-01')
    // Past due and still todo: the tint is on.
    expect(view.getByTestId('issue-prop-date').hasAttribute('data-overdue')).toBe(true)
    view.unmount()
    // Done means done: no tint even though the date is past.
    const done = renderProperties({ dueDate: '2026-01-01', status: 'done' })
    expect(done.getByTestId('issue-prop-date').hasAttribute('data-overdue')).toBe(false)
  })

  it('writes the due date from the input, clearing at empty', () => {
    const onDueDate = vi.fn()
    const view = renderProperties({ dueDate: '2026-12-24' }, { onDueDate })
    fireEvent.change(view.getByTestId('issue-prop-date'), { target: { value: '2026-12-25' } })
    expect(onDueDate).toHaveBeenCalledWith('2026-12-25')
    fireEvent.change(view.getByTestId('issue-prop-date'), { target: { value: '' } })
    expect(onDueDate).toHaveBeenCalledWith(null)
  })

  it('renders labels as chips and removes and adds them through the list seam', () => {
    const onLabels = vi.fn()
    const view = renderProperties({ labels: ['ui', 'api'] }, { onLabels })
    expect(view.getByTestId('issue-prop-labels').textContent).toContain('ui')
    expect(view.getByTestId('issue-prop-labels').textContent).toContain('api')

    fireEvent.click(view.getByRole('button', { name: t('labelRemove', { label: 'ui' }) }))
    expect(onLabels).toHaveBeenCalledWith(['api'])

    const row = view.getByTestId('issue-prop-labels')
    const add = row.querySelector<HTMLElement>('.propLabelAdd') || view.getByLabelText(t('labelsAdd'))
    fireEvent.change(add, { target: { value: 'infra' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(onLabels).toHaveBeenCalledWith(['ui', 'api', 'infra'])
  })

  it('ignores a duplicate label whatever its case', () => {
    const onLabels = vi.fn()
    const view = renderProperties({ labels: ['UI'] }, { onLabels })
    const add = view.getByLabelText(t('labelsAdd'))
    fireEvent.change(add, { target: { value: 'ui' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(onLabels).not.toHaveBeenCalled()
  })

  it('renders PR links, removes them, and adds one from the add row', () => {
    const onPullRequests = vi.fn()
    const view = renderProperties({ pullRequests: [{ url: 'https://github.com/a/b/pull/1', title: 'The sections' }] }, { onPullRequests })
    openRelated(view)
    expect(view.getByTestId('issue-prop-prs').textContent).toContain('The sections')
    expect(view.getByRole('link').getAttribute('href')).toBe('https://github.com/a/b/pull/1')
    fireEvent.click(view.getByRole('button', { name: t('prRemove', { title: 'The sections' }) }))
    expect(onPullRequests).toHaveBeenCalledWith([])
    view.unmount()

    // The stored list is the Host's: adding is asserted on its own render, so
    // the write is the list the component was handed plus the new link.
    const add = renderProperties({}, { onPullRequests })
    openRelated(add)
    const input = add.getByLabelText(t('prAdd'))
    fireEvent.change(input, { target: { value: 'https://github.com/a/b/pull/2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPullRequests).toHaveBeenLastCalledWith([{ url: 'https://github.com/a/b/pull/2' }])
  })

  it('lists the sub-issues and opens one through the issue seam', () => {
    const openIssue = vi.fn()
    const view = renderProperties({ subIssues: [{ taskRef: childRef, taskNumber: 4, title: 'A child task', status: 'todo' }] }, { openIssue })
    openRelated(view)
    fireEvent.click(view.getByRole('button', { name: '#4 A child task' }))
    expect(openIssue).toHaveBeenCalledWith(childRef, expect.objectContaining({ workspaceId }))
  })

  it('serves the empty sub-issue row for an issue with no children', () => {
    const view = renderProperties()
    openRelated(view)
    expect(view.getByTestId('issue-prop-subissues').textContent).toContain(zh.propSubIssuesNone)
  })
})
