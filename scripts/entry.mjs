// Which build to run: the bundled plugin runtime in dist/ (published plugin, no install needed —
// river0825/unprose#4), else the workspace build of a dev checkout. Used by the launchers in scripts/.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CANDIDATES = {
  canvas: ['dist/canvas.mjs', 'packages/canvas/dist/cli.js'],
  awd: ['dist/awd.mjs', 'packages/cli/bin/awd.js'],
}

/** Absolute path of the `canvas` or `awd` entry, or exit with the command that makes one. */
export function entry(name) {
  for (const rel of CANDIDATES[name]) {
    const p = path.join(root, rel)
    if (fs.existsSync(p)) return p
  }
  process.stderr.write(
    `unprose: no ${name} build found in ${root} (looked for ${CANDIDATES[name].join(', ')}).\n` +
      `  In a checkout: (cd "${root}" && npm install && npm run build)\n` +
      `  The published plugin ships dist/ — reinstall it if dist/ is missing.\n`,
  )
  process.exit(1)
}
