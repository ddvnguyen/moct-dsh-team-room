// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createAgentsTabState } from '../src/client/agents-tab-state.ts'
import { TeamSettingsPage, type TeamSettingsPageProps } from '../src/client/TeamSettingsPage.tsx'

afterEach(cleanup)

describe('Team settings page workspace subscription', () => {
  it('preserves the host workspace-list receiver when subscribing', () => {
    const snapshot = { items: [] as const }
    const store = {
      listeners: new Set<() => void>(),
      getSnapshot() { return snapshot },
      subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
    const props = {
      workspaceList: store,
      initialWorkspaceId: () => undefined,
      agentsTab: createAgentsTabState(),
      t: (key: string) => key,
    } as unknown as TeamSettingsPageProps

    const view = render(<TeamSettingsPage {...props} />)

    expect(screen.getByText('empty')).not.toBeNull()
    expect(store.listeners.size).toBe(1)
    view.unmount()
    expect(store.listeners.size).toBe(0)
  })
})
