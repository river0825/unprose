import type { BoardRepository } from '../../ports/boardRepository.js'
import { FileBoardRepository } from './file.js'
import { MemoryBoardRepository } from './memory.js'

export { BoardRepositoryBase } from './base.js'
export { FileBoardRepository, MemoryBoardRepository }
export { defaultBoardsDir, isInsidePluginCache } from './location.js'

export type BoardStoreKind = 'file' | 'memory'

/** Pick the adapter by name (`AWD_CANVAS_STORE`), defaulting to the directory of files. */
export function createBoardRepository(kind: BoardStoreKind | string | undefined, dir?: string): BoardRepository {
  if (kind === 'memory') return new MemoryBoardRepository()
  return new FileBoardRepository(dir)
}
