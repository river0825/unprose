// StudioStore adapters: files under <dir> (default <repo>/.awd/studio) and RAM for tests.
// state.json and status.json are per project; briefs go under <dir>/<board-scope>/.

import fs from 'node:fs'
import path from 'node:path'
import type { StudioState, StudioStatus, StudioStore } from '../../ports/studioStore.js'

const safe = (s: string) => s.replace(/^@/, 'agent-').replace(/[^A-Za-z0-9_.-]+/g, '-')
const fileName = (key: string) => `${safe(key)}.md`

export class FileStudioStore implements StudioStore {
  constructor(private dir: string) {}
  loadState(): StudioState | undefined {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8')) as StudioState } catch { return undefined }
  }
  saveState(state: StudioState) {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(path.join(this.dir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
  }
  writeBrief(scope: string, key: string, markdown: string) {
    const dir = path.join(this.dir, safe(scope))
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, fileName(key))
    fs.writeFileSync(file, markdown)
    return file
  }
  writeStatus(status: StudioStatus) {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(path.join(this.dir, 'status.json'), JSON.stringify(status, null, 2) + '\n')
  }
}

export class MemoryStudioStore implements StudioStore {
  state: StudioState | undefined
  status: StudioStatus | undefined
  /** Briefs by `<scope>/<key>`. */
  readonly briefs = new Map<string, string>()
  loadState() { return this.state && structuredClone(this.state) }
  saveState(state: StudioState) { this.state = structuredClone(state) }
  writeStatus(status: StudioStatus) { this.status = { ...status } }
  writeBrief(scope: string, key: string, markdown: string) {
    this.briefs.set(`${scope}/${key}`, markdown)
    return `.awd/studio/${safe(scope)}/${fileName(key)}`
  }
}
