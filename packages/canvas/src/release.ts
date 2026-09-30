// Which Unprose release is running, and its release notes, for GET /api/version.
// The version lives in the root package.json (scripts/version.mjs keeps every manifest in step with it)
// and the notes in CHANGELOG.md next to it. Both are found by walking up from the running code: a dev
// checkout (packages/canvas/dist → repo root) or the published bundle (dist/canvas.mjs → repo root, and
// dist/CHANGELOG.md, which scripts/bundle.mjs copies there).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface Release {
  version: string | null
  changelog: string | null
}

const readJson = (p: string): { version?: unknown } | undefined => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: unknown }
  } catch {
    return undefined
  }
}

/** The nearest CHANGELOG.md at or above `from`, with the version of the package.json beside it (or above it). */
export function findRelease(from = __dirname): Release {
  let changelog: string | null = null
  let version: string | null = null
  let dir = from
  for (let i = 0; i < 6; i++) {
    if (changelog === null && fs.existsSync(path.join(dir, 'CHANGELOG.md'))) changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')
    // the root package.json is the one next to a CHANGELOG (workspace packages keep their own versions)
    if (version === null && changelog !== null) {
      const v = readJson(path.join(dir, 'package.json'))?.version
      if (typeof v === 'string') version = v
    }
    if (changelog !== null && version !== null) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { version, changelog }
}
