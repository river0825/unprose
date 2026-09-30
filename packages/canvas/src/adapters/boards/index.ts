import type { BoardRepository } from '../../ports/boardRepository.js'
import { FileBoardRepository } from './file.js'
import { MemoryBoardRepository } from './memory.js'
import { ProjectsBoardRepository } from './projects.js'

export { BoardRepositoryBase } from './base.js'
export { FileBoardRepository, MemoryBoardRepository, ProjectsBoardRepository }
export { projectSlug, PROJECT_GITIGNORE, REGISTRY_FILE } from './projects.js'
export { defaultBoardsDir, isInsidePluginCache } from './location.js'

export type BoardStoreKind = 'file' | 'memory'

/**
 * Pick the adapter by name (`AWD_CANVAS_STORE`), defaulting to files: the personal boards in `dir`, and
 * each registered project's boards in `<project>/.unprose/boards/` (docs/canvas.md "Projects").
 */
export function createBoardRepository(kind: BoardStoreKind | string | undefined, dir?: string): BoardRepository {
  if (kind === 'memory') return new MemoryBoardRepository()
  return new ProjectsBoardRepository(dir)
}
