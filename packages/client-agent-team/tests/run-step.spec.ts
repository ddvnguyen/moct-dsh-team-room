import { describe, expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { runStepLines, runStepPhrase, stepTarget } from '../src/client/issue/run-step.ts'

const translate = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}) as unknown as TeamConversationProps['t']

describe('the running card’s step wording', () => {
  it('names the family the tool belongs to, with the basename the Host kept', () => {
    // The Host sends the label only; the verb is the Client's localized words.
    expect(stepTarget({ tool: 'read', label: 'read issue-view.module.css' })).toBe('issue-view.module.css')
    expect(runStepPhrase({ tool: 'read', label: 'read issue-view.module.css' }, translate)).toBe('读取 issue-view.module.css')
    expect(runStepPhrase({ tool: 'grep', label: 'grep runCard' }, translate)).toBe('搜索 runCard')
    expect(runStepPhrase({ tool: 'apply_patch', label: 'apply_patch card.tsx' }, translate)).toBe('编辑 card.tsx')
    expect(runStepPhrase({ tool: 'todo_write', label: 'todo_write' }, translate)).toBe('整理计划')
    expect(runStepPhrase({ tool: 'npm_test', label: 'npm_test' }, translate)).toBe('运行检查')
  })

  it('reads a shell call as a command, because its label never carries an argument', () => {
    expect(stepTarget({ tool: 'bash', label: 'bash' })).toBe('')
    expect(runStepPhrase({ tool: 'bash', label: 'bash' }, translate)).toBe('执行命令')
  })

  it('keeps a tool no family knows, instead of guessing a verb for it', () => {
    expect(runStepPhrase({ tool: 'fetch_url', label: 'fetch_url' }, translate)).toBe('调用 fetch_url')
    expect(runStepPhrase({ tool: 'fetch_url', label: 'fetch_url page.html' }, translate)).toBe('处理 page.html')
  })

  it('reads the newest step as the present and the ones before it as plain steps', () => {
    const steps = [
      { tool: 'read', label: 'read a.ts' },
      { tool: 'grep', label: 'grep b.ts' },
      { tool: 'edit', label: 'edit c.ts' },
    ]
    expect(runStepLines(steps, translate)).toEqual(['现在编辑 c.ts', '搜索 b.ts', '读取 a.ts'])
    // A Turn that has called nothing yet says so rather than showing an empty card body.
    expect(runStepLines([], translate)).toEqual(['正在思考…'])
    expect(runStepLines(undefined, translate)).toEqual(['正在思考…'])
  })
})
