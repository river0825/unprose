// What the person changed in the source dialog (docs/studio.md §9), as the text the AI session reviews and
// applies. The diff itself lives in the shared src/patch.ts (the server checks agents' proposals with it).
import type { DiscussModel } from './detail'

/** What "Ask AI to apply" sends: `data.discuss.edit`. */
export interface EditRequest {
  file?: string
  doc?: 'prompt'
  /** sha-1 (hex) of the snapshot text the edit was made on; `fnv1a:<hex>` where crypto.subtle is missing */
  base: string
  diff: string
  /** who proposed it, when an agent did (stamped by the server, docs/canvas.md "Proposals") */
  by?: string
}

/** The optional last argument of `onAnchoredComment`: ask AI (with a model), optionally to apply an edit. */
export interface DiscussArg {
  model: DiscussModel
  edit?: EditRequest
}

export { diffStat, firstChange, unifiedDiff } from '../../../src/patch'

/** sha-1 hex of `text` (crypto.subtle needs a secure context: https or localhost). */
export async function sha1(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const buf = await subtle.digest('SHA-1', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return `fnv1a:${h.toString(16).padStart(8, '0')}`
}
