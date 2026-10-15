import { Component, Fragment, createElement, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import css from './slot-boundary.module.css'

type Translate = (key: 'slotErrorTitle' | 'slotRetry') => string

interface BoundaryProps {
  /** The registration this boundary guards; named in the report and on the fallback. */
  readonly slot: string
  /** The Team dictionary, when the slot has one; the fallback degrades to English without it. */
  readonly t?: Translate | undefined
  /** Icons sit in a fixed rail cell: a crash empties the cell instead of adding a notice to it. */
  readonly quiet?: boolean | undefined
  readonly children?: ReactNode
}

interface BoundaryState {
  readonly failed: boolean
  /** Bumped by Retry so the children remount from nothing instead of resuming the broken tree. */
  readonly attempt: number
}

const FALLBACK = { slotErrorTitle: 'This part could not be shown.', slotRetry: 'Retry' } as const

/**
 * Contains a crash in one Team slot so it shows a notice with Retry instead of
 * reaching the host. The host's own boundary (`data-slot-error`) shows nothing
 * and, for a single-winner slot, retires the entry; this one keeps the entry
 * mounted and lets the Human try again, while sibling slots never notice.
 */
export class TeamSlotBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[agent-team] Team slot "${this.props.slot}" crashed and was contained`, error, info.componentStack)
  }

  private readonly retry = (): void => {
    this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    if (!this.state.failed) return createElement(Fragment, { key: this.state.attempt }, this.props.children)
    if (this.props.quiet === true) return null
    const t = this.props.t ?? ((key: keyof typeof FALLBACK) => FALLBACK[key])
    return (
      <div className={css.alert} role="alert" data-team-slot-error={this.props.slot}>
        <p className={css.message}>{t('slotErrorTitle')}</p>
        <button type="button" className={css.retry} onClick={this.retry}>{t('slotRetry')}</button>
      </div>
    )
  }
}

/**
 * Wrap a slot component in a TeamSlotBoundary. The slot's own `t` prop, when it
 * carries one, supplies the fallback's words.
 */
export function withSlotBoundary<P extends object>(slot: string, Inner: ComponentType<P>, options?: { readonly quiet?: boolean }): ComponentType<P> {
  const Guarded = (props: P): ReactNode => (
    <TeamSlotBoundary slot={slot} t={(props as { t?: Translate }).t} quiet={options?.quiet}>
      <Inner {...props} />
    </TeamSlotBoundary>
  )
  Guarded.displayName = `TeamSlotBoundary(${Inner.displayName ?? Inner.name})`
  return Guarded
}
