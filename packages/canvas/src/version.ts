// Unprose's version and the User-Agent every Unprose client sends (docs/agents-setup.md "Behind Cloudflare").
// Pure: no imports. scripts/version.mjs writes VERSION together with package.json (scripts/release-files.mjs).

export const VERSION = '0.10.0'

/**
 * `unprose/<version> (<component>)` — what every request Unprose makes carries. Cloudflare (in front of most
 * tunnels) answers requests with no User-Agent, or with a script's default one (Python's `Python-urllib/3.x`), with
 * a 403 before they reach the canvas.
 */
export function userAgent(component: string): string {
  return `unprose/${VERSION} (${component.replace(/[^\w .:/-]+/g, ' ').trim() || 'client'})`
}
