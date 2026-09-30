// Which build to run, without downloading anything: the plugin's dist/ (the published bundle), this
// version's runtime in the plugin data dir (fetched by scripts/ensure.mjs), else a dev checkout's
// workspace build. For the async version that also downloads or builds, see ensureRuntime in runtime.mjs.
import { findRuntime, fixHint, pluginRoot } from './runtime.mjs'

export const root = pluginRoot

/** Absolute path of the `canvas` or `awd` entry, or exit with the command that makes one. */
export function entry(name) {
  const rt = findRuntime()
  if (rt) return rt[name]
  process.stderr.write(`unprose: no ${name} build found for ${root}.\n  Fix: ${fixHint(root)}\n  (or run: node "${root}/scripts/ensure.mjs")\n`)
  process.exit(1)
}
