// Derived from multica-x packages/views/i18n/use-time-ago.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Logic only: Multica's hook binds i18next, the Team Room binds `locales.ts`.
// The caller passes the four translated templates.

export interface TimeAgoTemplates {
  readonly justNow: string
  readonly minutesAgo: string
  readonly hoursAgo: string
  readonly daysAgo: string
}

export type TimeAgoFn = (value: string, now?: number) => string

/** Build a relative-time formatter; `{count}` is substituted in each template. */
export function makeTimeAgo(templates: TimeAgoTemplates): TimeAgoFn {
  return (value, now = Date.now()) => {
    const diff = now - new Date(value).getTime()
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return templates.justNow
    if (minutes < 60) return templates.minutesAgo.replace('{count}', String(minutes))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return templates.hoursAgo.replace('{count}', String(hours))
    return templates.daysAgo.replace('{count}', String(Math.floor(hours / 24)))
  }
}
