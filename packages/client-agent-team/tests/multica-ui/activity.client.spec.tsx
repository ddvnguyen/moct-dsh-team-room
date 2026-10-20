// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ActivitySource } from '../../src/client/multica/types.ts'
import { AgentActivityIndicator } from '../../src/client/multica-ui/AgentActivityIndicator.tsx'

afterEach(() => { cleanup() })

const t = ((key: string, args?: Record<string, string>) => args === undefined
  ? key
  : Object.entries(args).reduce((text, [name, value]) => text.replace(`{${name}}`, value), key)) as never

const activity = (over: Partial<ActivitySource> = {}): ActivitySource => ({
  memberId: 'member:a',
  handle: '@builder',
  turnStartedAt: '2026-10-18T09:00:00.000Z',
  stepCount: 7,
  toolCount: 3,
  current: { tool: 'team_claim', label: 'team_claim' },
  updatedAt: '2026-10-18T09:01:00.000Z',
  ...over,
})

const members = [{ memberId: 'member:a', handle: '@builder' }]

describe('Agent activity indicator', () => {
  it('shows the current tool and step count from the snapshot', () => {
    const calls: Array<[string, Record<string, string> | undefined]> = []
    const spy = ((key: string, args?: Record<string, string>) => { calls.push([key, args]); return key }) as never
    const { container } = render(<AgentActivityIndicator activities={[activity()]} members={members} t={spy} />)
    expect(container.textContent).toContain('activityWorkingShort')
    expect(container.textContent).toContain('team_claim')
    expect(calls).toContainEqual(['activityStepCount', { count: '7' }])
  })

  it('renders nothing when no Turn is running', () => {
    const { container } = render(<AgentActivityIndicator activities={[]} members={members} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('collapses duplicate heads but keeps every running Turn', () => {
    const { container } = render(
      <AgentActivityIndicator activities={[activity(), activity({ slot: 1 })]} members={members} t={t} />,
    )
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1)
  })

  it('falls back to the activity handle when the roster has no entry', () => {
    const { container } = render(<AgentActivityIndicator activities={[activity({ memberId: 'member:gone', handle: '@gone' })]} members={members} t={t} />)
    expect(container.textContent).toContain('activityWorkingShort')
  })

  it('lets the most recently started Turn speak for the badge and says how many are running', () => {
    const calls: Array<[string, Record<string, string> | undefined]> = []
    const spy = ((key: string, args?: Record<string, string>) => { calls.push([key, args]); return key }) as never
    const older = activity({ memberId: 'member:a', turnStartedAt: '2026-10-18T09:00:00.000Z', stepCount: 3, current: { tool: 'read', label: 'older_tool' } })
    const newer = activity({ memberId: 'member:b', handle: '@other', turnStartedAt: '2026-10-18T09:30:00.000Z', stepCount: 9, current: { tool: 'edit', label: 'newer_tool' } })
    const { container } = render(<AgentActivityIndicator activities={[older, newer]} members={members} hoverCard={false} t={spy} />)
    expect(container.textContent).toContain('newer_tool')
    expect(container.textContent).not.toContain('older_tool')
    expect(calls).toContainEqual(['activityStepCount', { count: '9' }])
    expect(calls).toContainEqual(['activityHoverHeader', { count: '2' }])
  })

  it('opens the per-Turn details when the anchor takes keyboard focus', async () => {
    const { container } = render(<AgentActivityIndicator activities={[activity(), activity({ memberId: 'member:b', handle: '@other', slot: 1 })]} members={members} t={t} />)
    const anchor = container.querySelector<HTMLElement>('[role="group"][tabindex="0"]')
    expect(anchor).not.toBeNull()
    expect(document.body.textContent).not.toContain('activityToolCount')
    act(() => { anchor!.focus() })
    await waitFor(() => expect(document.body.textContent).toContain('activityToolCount'))
  })

  it('carries an accessible name on the badge anchor', () => {
    const { container } = render(<AgentActivityIndicator activities={[activity()]} members={members} t={t} />)
    expect(container.querySelector('[aria-label="activityWorkingShort"]')).not.toBeNull()
  })
})
