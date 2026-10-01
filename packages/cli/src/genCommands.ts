// `npm run gen:commands` — write the plugin's slash commands (commands/<name>.md → /unprose:<name>) from
// the start prompts in prompts.ts. A test fails when the files and the prompts disagree.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { START_PROMPTS, commandFile } from './prompts.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../commands')
fs.mkdirSync(dir, { recursive: true })
for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) fs.rmSync(path.join(dir, f))
for (const p of START_PROMPTS) fs.writeFileSync(path.join(dir, `${p.name}.md`), commandFile(p))
console.log(`wrote ${START_PROMPTS.length} commands to ${path.relative(process.cwd(), dir)}/`)
