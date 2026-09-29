// Compatibility entry. The port is ports/boardRepository.ts; the adapters are
// adapters/boards/{file,memory}.ts. `BoardStore` is the file adapter's old name.
export { FileBoardRepository as BoardStore, FileBoardRepository, MemoryBoardRepository, BoardRepositoryBase, createBoardRepository } from './adapters/boards/index.js'
export type { BoardStoreKind } from './adapters/boards/index.js'
export { HANDOFF_NOTE, NotFound } from './ports/boardRepository.js'
export type { BoardRepository, CreateBoardInput, ChangesQuery, ChangeListener, PresenceListener } from './ports/boardRepository.js'
