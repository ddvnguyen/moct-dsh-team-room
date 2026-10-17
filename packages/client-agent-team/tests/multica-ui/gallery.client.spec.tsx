// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { AgentPresenceDetail } from '../../src/client/multica/types.ts'
import {
  ActorAvatar,
  AgentActivityIndicator,
  AgentAvatarStack,
  AgentPresenceDot,
  AssigneePicker,
  PriorityIcon,
  PriorityPicker,
  ProgressRing,
  StatusHeading,
  StatusIcon,
  StatusPicker,
} from '../../src/client/multica-ui/index.ts'

afterEach(() => { cleanup() })

const t = ((key: string) => key) as never
const presence: AgentPresenceDetail = { availability: 'online', workload: 'working', runningCount: 1, queuedCount: 0, capacity: 2 }
const members = [{ memberId: 'member:a', handle: '@ada' }, { memberId: 'member:b', handle: '@builder' }]

function Gallery() {
  return (
    <div>
      <StatusIcon status="todo" />
      <StatusIcon status="in_progress" />
      <StatusIcon status="in_review" />
      <StatusIcon status="done" />
      <StatusIcon status="closed" />
      <StatusHeading status="done" count={4} t={t} />
      <PriorityIcon priority="urgent" />
      <PriorityIcon priority="high" />
      <PriorityIcon priority="medium" />
      <PriorityIcon priority="low" />
      <PriorityIcon priority="none" />
      <ProgressRing done={2} total={5} />
      <ActorAvatar name="@ada" kind="human" />
      <ActorAvatar name="@builder" kind="agent" />
      <AgentAvatarStack members={members} t={t} />
      <AgentPresenceDot detail={presence} t={t} />
      <AgentActivityIndicator
        activities={[{ memberId: 'member:a', handle: '@ada', turnStartedAt: '2026-10-18T09:00:00.000Z', stepCount: 2, toolCount: 1, updatedAt: '2026-10-18T09:00:10.000Z' }]}
        members={members}
        t={t}
      />
      <StatusPicker status="todo" onChange={() => {}} t={t} />
      <PriorityPicker priority="none" onChange={() => {}} t={t} />
      <AssigneePicker assignee={null} members={members} onChange={() => {}} t={t} />
    </div>
  )
}

describe('Multica component gallery', () => {
  it('renders every component in both host themes', () => {
    for (const theme of ['light', 'dark']) {
      const { container, unmount } = render(
        <div data-theme={theme} data-theme-mode={theme}>
          <Gallery />
        </div>,
      )
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(10)
      expect(container.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(3)
      unmount()
    }
  })
})
