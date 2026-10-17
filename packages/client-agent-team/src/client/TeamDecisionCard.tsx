import { useEffect, useRef, useState } from 'react'
import type { AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import { formatMessageTime } from './team-formatters.ts'
import css from './decision.module.css'

interface TeamDecisionCardProps {
  readonly decision: AgentTeamDecisionView
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  /** Commits the answer; resolves with an error message when the Host refused it. */
  readonly answer: (answers: readonly AgentTeamDecisionAnswer[]) => Promise<string | undefined>
  readonly t: TeamConversationProps['t']
}

interface Draft {
  readonly selected: readonly number[]
  readonly text: string
}

function answered(draft: Draft): boolean {
  return draft.selected.length > 0 || draft.text.trim() !== ''
}

/**
 * One decision card inside the ask's Thread reply. An open card is a form the
 * Human answers once; the answer is not shown as given until the Host commits
 * it and the Thread re-reads the card. Answered and withdrawn cards are
 * read-only records.
 */
export function TeamDecisionCard({ decision, nameOf, answer, t }: TeamDecisionCardProps) {
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => decision.questions.map(() => ({ selected: [], text: '' })))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const open = decision.status === 'open'
  const ready = drafts.every(answered)
  const fieldName = (index: number): string => `${decision.decisionRef}:${index}`

  const pick = (index: number, option: number, multiple: boolean, checked: boolean): void => {
    setDrafts(current => current.map((draft, at) => {
      if (at !== index) return draft
      if (!multiple) return { ...draft, selected: [option] }
      const selected = checked ? [...draft.selected, option] : draft.selected.filter(entry => entry !== option)
      return { ...draft, selected: [...new Set(selected)].sort((left, right) => left - right) }
    }))
  }

  const write = (index: number, text: string): void => {
    setDrafts(current => current.map((draft, at) => at === index ? { ...draft, text } : draft))
  }

  const send = async (): Promise<void> => {
    if (!ready || pending) return
    setPending(true)
    setError(undefined)
    const failure = await answer(drafts.map(draft => ({ selected: draft.selected, ...(draft.text.trim() === '' ? {} : { text: draft.text.trim() }) })))
    if (!mounted.current) return
    setPending(false)
    if (failure !== undefined) setError(failure)
  }

  const closedLine = decision.status === 'answered'
    ? t('decisionAnsweredBy', { name: nameOf(decision.closedBy!), time: formatMessageTime(decision.closedAt!) })
    : decision.status === 'withdrawn' ? t('decisionWithdrawn') : undefined

  return <section className={css.card} data-team-decision={decision.decisionRef} data-status={decision.status} aria-label={t('decisionLabel')}>
    {decision.context !== undefined && <p className={css.context}>{decision.context}</p>}
    {decision.questions.map((question, index) => {
      const answerOf = decision.answers?.[index]
      return <fieldset key={index} className={css.question} disabled={!open || pending} data-team-decision-question={index}>
        <legend className={css.prompt}>
          {decision.questions.length > 1 && <span className={css.number}>{index + 1}.</span>}
          {question.prompt}
        </legend>
        {open && <span className={css.hint}>{question.multiple ? t('decisionPickAny') : t('decisionPickOne')}</span>}
        <div className={css.options}>
          {question.options.map((option, optionIndex) => {
            const chosen = open ? drafts[index]!.selected.includes(optionIndex) : answerOf?.selected.includes(optionIndex) === true
            return <label key={optionIndex} className={css.option} data-chosen={chosen ? '' : undefined}>
              <input type={question.multiple ? 'checkbox' : 'radio'} name={fieldName(index)} checked={chosen}
                readOnly={!open} onChange={event => { if (open) pick(index, optionIndex, question.multiple, event.currentTarget.checked) }} />
              <span className={css.optionText}>
                <span className={css.optionLabel}>
                  {option.label}
                  {question.recommended.includes(optionIndex) && <span className={css.recommended}>{t('decisionRecommended')}</span>}
                </span>
                {option.description !== undefined && <span className={css.optionDescription}>{option.description}</span>}
              </span>
            </label>
          })}
        </div>
        {open
          ? <input type="text" className={css.other} value={drafts[index]!.text} maxLength={2000} placeholder={t('decisionOtherPlaceholder')}
            aria-label={t('decisionOtherLabel', { number: index + 1 })} onChange={event => { write(index, event.currentTarget.value) }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
          : answerOf?.text !== undefined && <p className={css.written}>{answerOf.text}</p>}
      </fieldset>
    })}
    <footer className={css.footer}>
      {error !== undefined && <span className={css.error} role="alert">{error}</span>}
      {open
        ? <>
          <span className={css.hint}>{ready ? t('decisionReady') : t('decisionAnswerEach')}</span>
          <Button size="sm" variant="primary" disabled={!ready || pending} onClick={() => { void send() }}>{pending ? t('decisionSending') : t('decisionSend')}</Button>
        </>
        : <span className={css.hint}>{closedLine}</span>}
    </footer>
  </section>
}
