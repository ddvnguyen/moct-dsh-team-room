import { describe, expect, it } from 'vitest'
import { AGENT_TEAM_DEFAULT_INSTANCES, assertInstances, memberInstances } from '../src/member-instances.ts'

describe('member instances (multi-instance contract v2)', () => {
  it('a Member without the field runs the default count', () => {
    expect(memberInstances({})).toBe(AGENT_TEAM_DEFAULT_INSTANCES)
    expect(AGENT_TEAM_DEFAULT_INSTANCES).toBe(2)
  })

  it('a stored count is used as is', () => {
    expect(memberInstances({ instances: 1 })).toBe(1)
    expect(memberInstances({ instances: 5 })).toBe(5)
  })

  it('accepts absent, null and integers 1..5; refuses everything else', () => {
    for (const ok of [undefined, null, 1, 2, 5]) expect(() => { assertInstances(ok) }).not.toThrow()
    for (const bad of [0, 6, -1, 2.5, Number.NaN]) expect(() => { assertInstances(bad) }).toThrow(/integer from 1 to 5/)
  })
})
