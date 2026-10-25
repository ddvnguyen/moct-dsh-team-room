// The issue view's public surface: the seven regions, their props interfaces,
// the shared tree and the page presentation.
//
// Every export here is props-only: data in through props, changes out through
// callbacks, never a context. M-38's slice chrome builds the same tree over
// these props, so a region exists once.

export { IssueHeader, type IssueHeaderProps } from './IssueHeader.tsx'
export { IssueDescription, type IssueDescriptionProps } from './IssueDescription.tsx'
export { IssueProperties, type IssuePropertiesProps } from './IssueProperties.tsx'
export { IssueTimeline, type IssueTimelineProps, type IssueCommentWrite } from './IssueTimeline.tsx'
export { IssueActivityGroup, type IssueActivityGroupProps } from './IssueActivityGroup.tsx'
export { IssueRunRow, type IssueRunRowProps } from './IssueRunRow.tsx'
export { IssueDecisions, type IssueDecisionsProps } from './IssueDecisions.tsx'
export { IssueExecutionLog, type IssueExecutionLogProps } from './IssueExecutionLog.tsx'
export { IssueView, type IssueViewProps } from './IssueView.tsx'
export { IssuePage, type IssuePageProps } from './IssuePage.tsx'
