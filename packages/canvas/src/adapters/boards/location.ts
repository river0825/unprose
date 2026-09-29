// Where boards live when nobody says: outside any checkout or plugin install, so reinstalling the
// plugin (which replaces its directory) never takes the boards with it (river0825/unprose#1).
import os from 'node:os'
import path from 'node:path'

/** `$AWD_BOARDS_DIR` (or the older `$AWD_CANVAS_DIR`), else `$XDG_DATA_HOME/awd/boards`, else `~/.awd/boards`. */
export function defaultBoardsDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const explicit = env.AWD_BOARDS_DIR || env.AWD_CANVAS_DIR
  if (explicit) return path.resolve(explicit)
  if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, 'awd', 'boards')
  return path.join(home, '.awd', 'boards')
}

/** True when `dir` sits inside an agent's plugin cache (e.g. `~/.claude/plugins/cache/…`), which is replaced on reinstall. */
export function isInsidePluginCache(dir: string): boolean {
  return /[\\/]plugins[\\/]cache[\\/]/.test(path.resolve(dir) + path.sep)
}
