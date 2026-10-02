// One credential for every Unprose client of a canvas (docs/canvas.md "Remote agents"): the MCP server's tools, the
// design tools it runs in-process, the `awd` CLI and anything it starts all use the same token for the same canvas —
//   1. UNPROSE_TOKEN (a token made on Connected agents, or the one this process got by pairing, see adoptToken);
//   2. else the token a pairing code got for that canvas address earlier (`~/.awd/tokens.json`, UNPROSE_TOKENS_FILE);
//   3. else none: a canvas on this machine needs none (UNPROSE_AGENT_NAME then names the local agent).
// Every request also says who is calling (User-Agent `unprose/<version> (<component>)`): Cloudflare in front of a
// tunnel refuses requests without one (or with a script's default one) with a 403.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { userAgent } from './version.js'

/** The key a canvas address is saved under: its origin (a board link or a trailing slash name the same canvas). */
export function tokenKey(base: string): string {
  try {
    const u = new URL(base.trim())
    const cut = u.pathname.search(/\/(b|api|docs|mcp)(\/|$)/)
    const prefix = (cut >= 0 ? u.pathname.slice(0, cut) : u.pathname).replace(/\/+$/, '')
    return `${u.origin}${prefix}`
  } catch {
    return base.trim().replace(/\/+$/, '')
  }
}

/** Where pairing tokens are kept (0600). */
export function tokenFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.UNPROSE_TOKENS_FILE || path.join(env.HOME || os.homedir(), '.awd', 'tokens.json')
}

function readTokens(env: NodeJS.ProcessEnv): Record<string, unknown> {
  try {
    const j = JSON.parse(fs.readFileSync(tokenFile(env), 'utf8')) as unknown
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The token a pairing code got for this canvas earlier, if any. */
export function savedToken(base: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const j = readTokens(env)
  const t = j[tokenKey(base)] ?? j[base.replace(/\/+$/, '')]
  return typeof t === 'string' && t ? t : undefined
}

/** Keep (or, with no token, forget) the token for this canvas. Throws when the file cannot be written. */
export function saveToken(base: string, token: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  const f = tokenFile(env)
  const j = readTokens(env)
  if (token) j[tokenKey(base)] = token
  else delete j[tokenKey(base)]
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 })
}

/** The token every client of this canvas uses (see the top of this file); undefined = none. */
export function canvasToken(base: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.UNPROSE_TOKEN || savedToken(base, env)
}

/**
 * This process got a token (pairing, or the saved one): make it the one every tool and every subprocess uses —
 * the design tools run in-process and read the environment, and `awd …` started from here inherits it.
 */
export function adoptToken(token: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (token) env.UNPROSE_TOKEN = token
  else delete env.UNPROSE_TOKEN
}

/** The headers every request to this canvas carries: the token (or the local agent's name) and the User-Agent. */
export function canvasHeaders(base: string, component: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = canvasToken(base, env)
  return {
    'user-agent': userAgent(component),
    ...(token ? { authorization: `Bearer ${token}` } : env.UNPROSE_AGENT_NAME ? { 'x-unprose-agent': env.UNPROSE_AGENT_NAME } : {}),
  }
}
