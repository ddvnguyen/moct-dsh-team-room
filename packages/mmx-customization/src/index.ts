/** MMX customization: the one dsh customization the MMX lanes mount.
 *
 *  Host half: the public listener that lets a browser reach the loopback dsh
 *  without a token or a cookie in the browser (see `./proxy.ts`). The stock
 *  `webServer` keeps serving on a loopback port; this row owns the public one.
 *
 *  Client half: the MOCT sidebar (see `./client/index.ts`).
 *
 *  Why a plugin and not a fork patch: the seams this half uses are stock public
 *  API — `webServer.getOrigin()`, `connection.authenticatedUrl()`,
 *  `connection.authorizeIndex()` and `connection.requestRejection()` — so an
 *  upstream tag needs no `git am`. The fence stays the core's: the browser's
 *  `Host` survives the hop and `trustedHosts` still decides admission.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ConnectionIndexResponse, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { createPublicListener, type PublicListener } from './proxy.ts'

/** Stable Cordis plugin name. */
export const name = 'mmx-customization'

/** Services required before the public listener can be built. */
export const inject = ['webServer', 'connection']

/** Plugin config, as the composition row spells it. */
export interface Config {
  /** Port the browser reaches. The stock listener keeps its own loopback port. */
  publicPort: number
  /**
   * Public bind address. Omitted listens on every interface, which is what a
   * tunnel or edge in front of the lane expects.
   */
  publicHost?: string
  /**
   * Optional narrowing of the authorities this listener serves. The Connection
   * fence always decides as well; a list here can only refuse more, never admit
   * an authority the fence rejects.
   */
  trustedHosts?: string[]
}

/** True when `authority` is one of the listed hosts, with or without its port. */
export function admittedAuthority(authority: string | undefined, trustedHosts: readonly string[] | undefined): boolean {
  if (authority === undefined) return false
  const host = authority.trim().toLowerCase()
  const bare = host.replace(/:\d+$/u, '')
  return (trustedHosts ?? []).some((entry) => {
    const wanted = entry.trim().toLowerCase()
    return wanted.length > 0 && (wanted === host || wanted === bare)
  })
}

/** Reject a composition row the listener cannot honour, before it binds. */
function validate(config: Config): void {
  if (!Number.isInteger(config.publicPort) || config.publicPort < 0 || config.publicPort > 65535) {
    throw new Error(`mmx-customization: publicPort must be an integer port, received ${String(config.publicPort)}`)
  }
  if (config.publicHost !== undefined && config.publicHost.trim().length === 0) {
    throw new Error('mmx-customization: publicHost must name an interface when it is present')
  }
  for (const entry of config.trustedHosts ?? []) {
    if (entry.trim().length === 0) throw new Error('mmx-customization: trustedHosts entries must not be empty')
  }
}

/**
 * Mint one browser-session cookie for a request authority.
 *
 * `authenticatedUrl()` is the only place the process launch token surfaces, so
 * the token is handed to `authorizeIndex()` in-process and never leaves it: the
 * exchange's `303` and `set-cookie` are captured from a response that is thrown
 * away, and only the cookie value is kept. The audience of that cookie is the
 * authority this call was made for, which is why it is minted per request.
 * @param connection - the Host Connection service.
 * @param authority - the request `Host` the cookie is bound to.
 * @returns the cookie as a `Cookie` header value, or undefined when the exchange failed.
 */
export function mintCookie(connection: HostConnectionHandle, authority: string): string | undefined {
  let cookie: string | undefined
  const response: ConnectionIndexResponse = {
    writeHead(_status, headers) {
      const value = headers?.['set-cookie']
      if (cookie === undefined && typeof value === 'string') cookie = value.split(';', 1)[0]
      return undefined
    },
    end() { /* the exchange's body is never used */ },
  }
  const url = new URL(connection.authenticatedUrl(`http://${authority}/`))
  connection.authorizeIndex({
    method: 'GET',
    url: `${url.pathname}${url.search}`,
    headers: { host: authority },
  }, response)
  return cookie
}

/**
 * Mount the public listener and keep it for this plugin's lifetime.
 * @param ctx - plugin context; `webServer` and `connection` are already active.
 * @param config - the composition row's config.
 */
export function apply(ctx: Context, config: Config): void {
  validate(config)
  const web = ctx.get('webServer')
  const connection = ctx.get('connection')
  // `inject` above is the contract; failing loudly beats a silent no-listener boot.
  if (web === undefined || connection === undefined) {
    throw new Error('mmx-customization: webServer and connection must be active before this row mounts')
  }
  const listener: PublicListener = createPublicListener({
    upstream: web.getOrigin(),
    host: config.publicHost,
    mintCookie: authority => mintCookie(connection, authority),
    refusal: (request) => {
      // A narrowed authority list refuses before the fence is asked; the fence
      // then answers 403 for an untrusted Host and 401 for "no cookie yet",
      // which is exactly the state this proxy exists to resolve.
      const authority = request.headers.host
      if ((config.trustedHosts?.length ?? 0) > 0 && !admittedAuthority(authority, config.trustedHosts)) return 403
      const rejection = connection.requestRejection({ headers: request.headers })
      return rejection === 403 ? 403 : undefined
    },
  })

  ctx.effect(() => {
    listener.listen(config.publicPort).catch((error: unknown) => {
      console.error(`mmx-customization: public listener failed to bind port ${String(config.publicPort)}`, error)
    })
    return () => { void listener.close() }
  }, 'mmx-customization: public listener')
}
