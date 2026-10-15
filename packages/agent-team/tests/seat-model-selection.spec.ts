import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { projectedNextModelSelection } from '../src/index.ts'

const selection = (provider: string, model: string) => ({ type: 'model/selection', data: { provider, model } }) as unknown as SessionEvent
const header = (provider: string, model: string) => ({ type: 'request/header', data: { header: { config: { provider, model } } } }) as unknown as SessionEvent

describe('projectedNextModelSelection (seat model authoritative)', () => {
  it('is null for a Session with no selection and no request', () => {
    expect(projectedNextModelSelection([])).toBeNull()
  })

  it('follows the last request header when nothing is pending', () => {
    expect(projectedNextModelSelection([header('go', 'deepseek')])).toEqual({ provider: 'go', model: 'deepseek' })
  })

  it('keeps a composer pick pending while the seat route runs a different model — the stale label case', () => {
    const events = [header('go', 'deepseek'), selection('go', 'longcat'), header('go', 'deepseek')]
    expect(projectedNextModelSelection(events)).toEqual({ provider: 'go', model: 'longcat' })
  })

  it('a re-asserted seat selection replaces the pick, and the next matching header consumes it', () => {
    const events = [header('go', 'deepseek'), selection('go', 'longcat'), selection('go', 'deepseek')]
    expect(projectedNextModelSelection(events)).toEqual({ provider: 'go', model: 'deepseek' })
    expect(projectedNextModelSelection([...events, header('go', 'deepseek')])).toEqual({ provider: 'go', model: 'deepseek' })
  })
})
