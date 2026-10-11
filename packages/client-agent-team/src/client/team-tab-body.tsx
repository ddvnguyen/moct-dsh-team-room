/**
 * A10 — the Team tab's body inside the host's native tab strip.
 *
 * The host calls a tab's `render` with its own render props (the official-tree
 * entry's props plus `openSession`/`open`/`useSessions`/`useWorkspaces`/
 * `renderSlot`, and `wide: true`) inside the host's React tree rather than the
 * slot framework's. This component turns those props into the same seat the
 * Team's registered `main` slot receives and hands them to `TeamConversation`,
 * so the tab body and the rail body are one implementation with one behaviour
 * instead of two that drift apart.
 *
 * The seat's `t` is bound by the client entry: the strip is not a locale-scoped
 * slot, so the Team's own dictionary cannot be inherited from a registration.
 */

import { createElement } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { TeamConversation } from './TeamConversation.tsx'

/** The host render props this module reads. Structural: extra fields pass through. */
export interface NativeTabRenderProps {
  readonly openSession?: unknown
  readonly open?: unknown
  readonly useSessions?: unknown
  readonly useWorkspaces?: unknown
  readonly renderSlot?: unknown
  readonly wide?: boolean
}

/**
 * Build the tab body as a React element rather than a component, because the
 * seat's props are only known at render time: the host owns those props, and
 * `TeamConversation` needs the same share the slot framework would have
 * injected.
 *
 * The seat share is built by the client entry, which owns navigation, drafts and
 * the remotes; it is passed in rather than imported, so this module depends on
 * the seat's props type only and never on the entry's internals.
 */
export function renderTeamTabBody(
  seat: TeamConversationProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // The host props ride along untouched: the seat's `useWorkspaces`/`openSession`
  // are the same shape the framework hands the rail seat, and the host's own
  // wrappings (session/workspace projections narrowed to the current automation
  // run) are what make the tab show the same channels the rail shows.
  return createElement(TeamConversation, { ...seat, ...props } as TeamConversationProps)
}

