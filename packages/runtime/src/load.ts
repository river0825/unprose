// Compatibility entry — reading lives in adapters/fs/workflowLoader.ts, the pure merge in application/agents.ts.
export { loadWorkflow, resolveAgents, readAgentFiles, type LoadedWorkflow } from './adapters/fs/workflowLoader.js'
export { splitFrontmatter, mergeAgents, parseAgentFile } from './application/agents.js'
export { keyFor } from './application/keys.js'
