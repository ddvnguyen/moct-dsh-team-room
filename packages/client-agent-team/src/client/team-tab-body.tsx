/**
 * A10/T6 — the Team tab's body inside the host's native tab strip.
 *
 * The body is the Channel view: the Inbox, the Workspace selector and the
 * Channels list the Team rail seat also shows. The Agents config is not here:
 * it lives on the rail's Team Settings page. Picking a Channel goes through the same
 * navigation actions as the rail, so the conversation opens in the main column
 * and the tab never mounts `TeamConversation` itself.
 *
 * The host calls a tab's `render` with its own render props (the official-tree
 * entry's props plus `openSession`/`open`/`useSessions`/`useWorkspaces`/
 * `renderSlot`, and `wide: true`) inside the host's React tree rather than the
 * slot framework's. This module turns those props into the seat the Team's
 * registered `sidebar.workspaces` slot receives and hands them to
 * `TeamWorkspaceBrowser`, so the tab body and the rail body are one
 * implementation with one behaviour instead of two that drift apart.
 *
 * The seat's `t` is bound by the client entry: the strip is not a locale-scoped
 * slot, so the Team's own dictionary cannot be inherited from a registration.
 */

import { createElement } from 'react'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceBrowser } from './TeamWorkspaceBrowser.tsx'

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
 * the browser needs the same share the slot framework would have injected.
 *
 * The seat share is built by the client entry, which owns navigation, drafts and
 * the remotes; it is passed in rather than imported, so this module depends on
 * the seat's props type only and never on the entry's internals.
 */
export function renderTeamTabBody(
  seat: TeamSidebarProps,
  props: NativeTabRenderProps,
): ReturnType<typeof createElement> {
  // The host props ride along untouched where the seat has no opinion: the
  // seat carries no `useWorkspaces`/`openSession`/`useSessions`/`renderSlot`, so
  // the host's own wrappings (session/workspace projections narrowed to the
  // current automation run) are what make the tab show the same channels the rail
  // shows. The seat goes last: the strip wraps the workspace entry's props, which
  // include that entry's own `t` (the workspace dictionary) and navigation
  // actions, and neither may replace the Team's.
  return createElement(TeamWorkspaceBrowser, { ...props, ...seat, wide: true } as unknown as Parameters<typeof TeamWorkspaceBrowser>[0])
}
