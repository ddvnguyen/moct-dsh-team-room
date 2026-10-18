// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { AgentPresenceDetail, TaskPriority, TaskStatus } from '../../src/client/multica/types.ts'
import { StatusIcon } from '../../src/client/multica-ui/StatusIcon.tsx'
import { StatusHeading } from '../../src/client/multica-ui/StatusHeading.tsx'
import { PriorityIcon } from '../../src/client/multica-ui/PriorityIcon.tsx'
import { ProgressRing } from '../../src/client/multica-ui/ProgressRing.tsx'
import { ActorAvatar } from '../../src/client/multica-ui/ActorAvatar.tsx'
import { AgentAvatarStack } from '../../src/client/multica-ui/AgentAvatarStack.tsx'
import { AgentPresenceDot } from '../../src/client/multica-ui/AgentPresenceDot.tsx'

afterEach(() => { cleanup() })

const t = ((key: string, args?: Record<string, string>) => args === undefined
  ? key
  : Object.entries(args).reduce((text, [name, value]) => text.replace(`{${name}}`, value), key)) as never

const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']
const PRIORITIES: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

describe('Multica status and priority glyphs', () => {
  it('renders one glyph for every status', () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(<StatusIcon status={status} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('data-status')).toBe(status)
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      unmount()
    }
  })

  it('names the glyph when the caller supplies a title', () => {
    const { container } = render(<StatusIcon status="in_review" title="In review" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-label')).toBe('In review')
  })

  it('renders a column heading with its localized label and count', () => {
    const { container } = render(<StatusHeading status="todo" count={3} t={t} />)
    expect(container.textContent).toContain('statusTodo')
    expect(container.textContent).toContain('3')
    expect(container.querySelector('[data-status="todo"]')).not.toBeNull()
  })

  it('renders one glyph for every priority, including the empty dash', () => {
    for (const priority of PRIORITIES) {
      const { container, unmount } = render(<PriorityIcon priority={priority} />)
      expect(container.querySelector('svg')?.getAttribute('data-priority')).toBe(priority)
      unmount()
    }
  })

  it('draws the progress ring open before the total and closed at it', () => {
    const { container, rerender } = render(<ProgressRing done={1} total={3} />)
    const open = container.querySelector('svg')
    expect(open?.getAttribute('aria-hidden')).toBe('true')
    expect(open?.querySelectorAll('circle')).toHaveLength(2)
    rerender(<ProgressRing done={3} total={3} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('Priority icon color', () => {
  it('uses the tone class by default and the inherit class inside a chip', () => {
    const { container, rerender } = render(<PriorityIcon priority="high" />)
    const svg = () => container.querySelector('svg')!
    expect(svg().getAttribute('class')).toMatch(/high/)
    expect(svg().getAttribute('class')).not.toMatch(/inherit/)
    rerender(<PriorityIcon priority="high" inheritColor />)
    expect(svg().getAttribute('class')).toMatch(/inherit/)
    expect(svg().getAttribute('class')).not.toMatch(/high/)
  })
})

describe('Multica actor and agent presence', () => {
  it('renders a human initial and an agent glyph', () => {
    const { container, rerender } = render(<ActorAvatar name="@Ada" kind="human" />)
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('@Ada')
    expect(container.textContent).toBe('A')
    rerender(<ActorAvatar name="@builder" kind="agent" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('prefers a supplied image over the fallback glyph', () => {
    const { container } = render(<ActorAvatar name="@Ada" kind="human" avatarUrl="https://example.test/ada.png" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/ada.png')
  })

  it('stacks heads and collapses the tail into a +N chip', () => {
    const members = [
      { memberId: 'member:a', handle: '@a' },
      { memberId: 'member:b', handle: '@b' },
      { memberId: 'member:c', handle: '@c' },
      { memberId: 'member:d', handle: '@d' },
    ]
    const { container } = render(<AgentAvatarStack members={members} max={3} t={t} />)
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(3)
    expect(container.textContent).toContain('+1')
  })

  it('renders nothing for an empty stack', () => {
    const { container } = render(<AgentAvatarStack members={[]} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('maps availability and workload onto their labels and tone classes', () => {
    const detail: AgentPresenceDetail = { availability: 'unstable', workload: 'working', runningCount: 2, queuedCount: 0, capacity: 3 }
    const { container } = render(<AgentPresenceDot detail={detail} t={t} />)
    expect(container.textContent).toContain('presenceUnstable')
    expect(container.textContent).toContain('workloadWorking')
    expect(container.textContent).toContain('2 / 3')
    expect(container.querySelector('[data-availability="unstable"]')).not.toBeNull()
  })

  it('shows an unstable seat on the dot, not green', () => {
    const detail: AgentPresenceDetail = { availability: 'unstable', workload: 'idle', runningCount: 0, queuedCount: 0, capacity: 1 }
    const { container } = render(<AgentPresenceDot detail={detail} compact t={t} />)
    expect(container.querySelector('[data-availability]')).toBeNull()
    expect(container.querySelector('span[class*="dot"]')?.getAttribute('class')).toMatch(/Warning/i)
  })

  it('shows a neutral dot while presence is still loading', () => {
    const { container } = render(<AgentPresenceDot detail={undefined} t={t} />)
    expect(container.querySelector('[data-loading="true"]')).not.toBeNull()
  })

  it('collapses to a dot in compact mode', () => {
    const detail: AgentPresenceDetail = { availability: 'online', workload: 'idle', runningCount: 0, queuedCount: 0, capacity: 1 }
    const { container } = render(<AgentPresenceDot detail={detail} compact t={t} />)
    expect(container.textContent).toBe('presenceOnline')
    expect(container.querySelector('[data-availability]')).toBeNull()
  })
})
