// The shared Multica-look components. Every export is pure presentation: data
// arrives as props and a change leaves through a callback, so a page owns the
// Remote and a spec owns the fixture.
//
// Derived from multica-x packages/views @ 18fa9f728a9e25f2465df2789631edb2a75442ad.
// Copyright Index Labs. Multica License.

export { StatusIcon } from './StatusIcon.tsx'
export { StatusHeading } from './StatusHeading.tsx'
export { PriorityIcon } from './PriorityIcon.tsx'
export { ProgressRing } from './ProgressRing.tsx'
export { ActorAvatar, type ActorAvatarProps } from './ActorAvatar.tsx'
export { AgentAvatarStack, type AvatarStackMember } from './AgentAvatarStack.tsx'
export { AgentPresenceDot } from './AgentPresenceDot.tsx'
export { AgentActivityIndicator, type AgentActivityIndicatorProps } from './AgentActivityIndicator.tsx'
export { PickerMenu, PickerItem } from './PickerMenu.tsx'
export { StatusPicker } from './StatusPicker.tsx'
export { PriorityPicker } from './PriorityPicker.tsx'
export { AssigneePicker, type AssigneeOption } from './AssigneePicker.tsx'
export { AVATAR_SIZE_PX, DEFAULT_AVATAR_SIZE, type AvatarSize } from './avatar-size.ts'
