import { describe, expect, it } from 'vitest'
import { renderTeamTabBody } from '../src/client/team-tab-body.tsx'

describe('Team tab body seat precedence', () => {
  it("keeps the Team's own `t` and actions when the host props carry its own, and takes the host's workspaces", () => {
    const teamT = () => 'team'
    const hostT = () => 'host'
    const selectChannel = () => undefined
    const useWorkspaces = () => []
    const element = renderTeamTabBody(
      { t: teamT, selectChannel } as never,
      { t: hostT, selectChannel: () => 'host', useWorkspaces } as never,
    ) as unknown as { props: Record<string, unknown> }
    expect(element.props.t).toBe(teamT)
    expect(element.props.selectChannel).toBe(selectChannel)
    expect(element.props.useWorkspaces).toBe(useWorkspaces)
    expect(element.props.wide).toBe(true)
    // The Team tab carries the Channel section and the Agents section, so the
    // browser is not narrowed to the Channels alone.
    expect(element.props.channelsOnly).toBeUndefined()
    expect(element.props).not.toHaveProperty('agentsInSettings')
  })
})
