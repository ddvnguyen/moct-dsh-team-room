import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script module, no declaration file
import { RECORDS } from '../../../scripts/migration/moct-team-room-records.mjs'
// @ts-expect-error plain .mjs script module, no declaration file
import { keyOf, problems } from '../../../scripts/migration/validate.mjs'

describe('MOCT Team Room memory migration records', () => {
  it('every curated record passes the backend bounds, and no two share a key', () => {
    const all = RECORDS as readonly unknown[]
    expect(all.length).toBeGreaterThan(0)
    for (const record of all) expect(problems(record), JSON.stringify((record as { title: string }).title)).toEqual([])
    const keys = all.map(record => keyOf(record))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('refuses what the backend would: wrong home, long body, missing attrs, a credential', () => {
    const base = { type: 'rule', home: { kind: 'team', ref: 'cf4817d4-c9d6-42b0-9a44-271db6d259ca' }, title: 't', body: 'b', attrs: { level: 'must' }, source: 's' }
    expect(problems(base)).toEqual([])
    expect(problems({ ...base, type: 'decision', attrs: {} })).toEqual(expect.arrayContaining(['decision cannot live in a team home']))
    expect(problems({ ...base, body: 'x'.repeat(2001) })[0]).toContain('body over 2000')
    expect(problems({ ...base, attrs: {} })).toContain('rule needs attrs.level must|should')
    expect(problems({ ...base, body: 'api_key = abcdef123456' })).toContain('looks like a credential')
  })

  it('carries only the MOCT Team Room Workspace and Channel', () => {
    for (const record of RECORDS as readonly { home: { kind: string; ref: string } }[]) {
      if (record.home.kind === 'team') expect(record.home.ref).toBe('cf4817d4-c9d6-42b0-9a44-271db6d259ca')
      if (record.home.kind === 'channel') expect(record.home.ref).toBe('channel:7ebe3ec3-32c0-45b4-bed6-86e198e14d93')
    }
  })
})
