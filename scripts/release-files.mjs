// The places that carry Unprose's version, read and written in one spot (river0825/unprose#3).
// Used by scripts/version.mjs (bump) and scripts/check-version.mjs (verify). Workspace packages
// (@awd/*) are internal and keep their own version.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = (p) => path.join(root, p)
const readJson = (p) => JSON.parse(fs.readFileSync(file(p), 'utf8'))
const writeJson = (p, v) => fs.writeFileSync(file(p), JSON.stringify(v, null, 2) + '\n')
const MCP = 'packages/canvas/src/mcp.ts'
const MCP_RE = /(\{ name: 'unprose', version: ')([^']+)(')/

/** Every version the release carries, by where it lives. */
export function versions() {
  const lock = fs.existsSync(file('package-lock.json')) ? readJson('package-lock.json') : undefined
  const market = readJson('.claude-plugin/marketplace.json')
  return {
    'package.json': readJson('package.json').version,
    ...(lock ? { 'package-lock.json': lock.version, 'package-lock.json (root package)': lock.packages?.['']?.version } : {}),
    '.claude-plugin/plugin.json': readJson('.claude-plugin/plugin.json').version,
    '.claude-plugin/marketplace.json': market.plugins?.find((p) => p.name === 'unprose')?.version,
    [MCP]: fs.readFileSync(file(MCP), 'utf8').match(MCP_RE)?.[2],
  }
}

/** Write `v` everywhere `versions()` reads. */
export function setVersion(v) {
  const pkg = readJson('package.json'); pkg.version = v; writeJson('package.json', pkg)
  if (fs.existsSync(file('package-lock.json'))) {
    const lock = readJson('package-lock.json'); lock.version = v
    if (lock.packages?.['']) lock.packages[''].version = v
    writeJson('package-lock.json', lock)
  }
  const plugin = readJson('.claude-plugin/plugin.json'); plugin.version = v; writeJson('.claude-plugin/plugin.json', plugin)
  const market = readJson('.claude-plugin/marketplace.json')
  for (const p of market.plugins ?? []) if (p.name === 'unprose') p.version = v
  writeJson('.claude-plugin/marketplace.json', market)
  const src = fs.readFileSync(file(MCP), 'utf8')
  if (!MCP_RE.test(src)) throw new Error(`${MCP}: McpServer version literal not found`)
  fs.writeFileSync(file(MCP), src.replace(MCP_RE, `$1${v}$3`))
}

export const CHANGELOG = file('CHANGELOG.md')
export const REPO_URL = 'https://github.com/river0825/unprose'
