/**
 * The Team Detail entry's glyph in the sidebar's panel list: the shipped
 * settings mark, so the row reads as configuration beside the shipped Plugins
 * and scheduled-task entries. The sidebar owns the button, the label, and the
 * selected state around it.
 */

import type { ReactNode } from 'react'
import { IconSettingsOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the settings mark at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the icon element.
 */
export function TeamSettingsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconSettingsOutlineRegular size={size} />
}
