// The start prompts are written once in @awd/canvas (packages/canvas/src/prompts.ts) — the canvas server offers
// them over remote MCP too; `npm run gen:commands` writes them as the plugin's slash commands from here.
import type { StartPrompt } from '@awd/canvas'
export { START_PROMPTS, promptText, type StartPrompt } from '@awd/canvas'

/** The plugin slash command file for a prompt (commands/<name>.md). */
export function commandFile(p: StartPrompt): string {
  const front = ['---', `description: ${p.description}`, ...(p.arg ? [`argument-hint: ${p.arg.hint}`] : []), '---', '']
  const body = p.body.replaceAll('{arg}', p.arg ? `${'$'}ARGUMENTS (if that is empty: ${p.fallback})` : '')
  return `${front.join('\n')}<!-- generated from packages/canvas/src/prompts.ts by \`npm run gen:commands\`; edit it there -->\n\n${body}\n`
}
