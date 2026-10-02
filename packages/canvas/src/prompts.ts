// The ways to start a design conversation, written once: the MCP servers offer them as prompts (Codex and
// other MCP clients, the canvas's remote /mcp endpoint) and `npm run gen:commands` (packages/cli) writes them as the plugin's slash commands (commands/*.md,
// /unprose:<name> in Claude Code). Tool names are the MCP tools; a plugin session can also use the CLI.

export interface StartPrompt {
  name: string
  title: string
  /** One line, shown in the slash-command menu and the prompt list. */
  description: string
  /** The free-text argument (the topic), when the prompt takes one. */
  arg?: { name: string; hint: string; description: string }
  /** The instructions; `{arg}` is the argument, or `fallback` when it is empty. */
  body: string
  fallback?: string
}

/** Bilingual boards (docs/diagrams.md "Bilingual boards"): a short title on the card, the full text where the kind keeps it. */
const BILINGUAL = `If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.`

const CLOSE = `${BILINGUAL}
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.`

export const START_PROMPTS: StartPrompt[] = [
  {
    name: 'help',
    title: 'What Unprose can do',
    description: 'What Unprose can do and how to start',
    body: `Call unprose_help and tell me briefly, in my language, what Unprose can do: the diagrams, how we talk on the canvas, and the commands to start with. Then suggest the one command that fits what I seem to be working on in this project.`,
  },
  {
    name: 'eventstorm',
    title: 'EventStorming',
    description: 'Run an EventStorming of a process on the canvas',
    arg: { name: 'topic', hint: '<process or domain>', description: 'The process to explore, e.g. "our refund process"' },
    fallback: 'a process in this project — ask me which one',
    body: `Run an EventStorming with me on the Unprose canvas about: {arg}.
1. If the scope is unclear, ask me at most three short questions (where the flow starts and ends, who is involved).
2. Write design/<name>.es.yaml the way Introducing EventStorming describes it: domain events in the past tense on a left → right timeline, commands issued by people, the system between a command and its event, policies between an event and the next command, read models, and hotspots for every open question or disagreement.
3. Check it with design_lint, then draw it with design_draw on a board titled after the topic.
${CLOSE}`,
  },
  {
    name: 'storymap',
    title: 'Story map',
    description: 'Turn an EventStorming into a story map with a first release',
    arg: { name: 'source', hint: '[es file or topic]', description: 'Which EventStorming (or domain story) to start from' },
    fallback: 'the EventStorming in design/ — ask me if there are several',
    body: `Turn {arg} into a user story map on the Unprose canvas.
1. Create design/<name>.story-map.yaml if it does not exist: activities from the pivotal events or phases, steps under them.
2. Run design_propose_stories from the EventStorming into the story map, on the same board, so the candidates show as proposals (person + command → story; the events and read models → acceptance criteria).
3. Explain the proposals and suggest a first release cut line. Write a story into the file only when I accept it, with traces back to its events.
${CLOSE}`,
  },
  {
    name: 'kanban',
    title: 'Kanban',
    description: 'Make a kanban of a release’s stories, traced to the story map',
    arg: { name: 'scope', hint: '[release or topic]', description: 'Which stories to put on the board' },
    fallback: 'the first release of the story map in design/',
    body: `Make a kanban for {arg} on the Unprose canvas.
Write design/<name>.kanban.yaml with the columns Backlog, Next, Doing, Review, Done (unless I want others) and one card per story, each with \`stories: ['<story map key>/<story id>']\` so it traces back, and a size where you can estimate one. Check it with design_lint and draw it with design_draw on the same board as the story map.
${CLOSE}`,
  },
  {
    name: 'wireframe',
    title: 'Wireframe',
    description: 'Sketch a wireframe of a page or screen',
    arg: { name: 'page', hint: '<page or screen>', description: 'The page to sketch, e.g. "the checkout page"' },
    fallback: 'the page we are discussing — ask me which one',
    body: `Sketch a wireframe of {arg} on the Unprose canvas.
Write design/<name>.wireframe.yaml on the 12-column grid (headings, inputs, buttons, lists, tables) with a note on every element that is still an open question. When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
${CLOSE}`,
  },
  {
    name: 'mockup',
    title: 'UI mock',
    description: 'Mock a screen as real-looking UI and discuss it on the canvas',
    arg: { name: 'screen', hint: '<screen or page>', description: 'The screen to mock, e.g. "the board list page"' },
    fallback: 'the screen we are discussing — ask me which one',
    body: `Mock {arg} as real-looking UI on the Unprose canvas (a UI mock frame, like a Figma frame).
Write design/<name>.ui.yaml (docs/diagrams.md §6c): screens at a device size (desktop, tablet or phone), each a tree of components — navbar, sidebar, section, card, row, grid, heading, text, button, input, select, table, list, stat, tabs, badge, alert, image … — with a stable \`id\` on every element we will talk about, real copy instead of lorem ipsum, a \`note\` on whatever is still an open question, and \`goto: <screen>\` on buttons that lead to another screen. When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
When I edit words on the board they show as proposals with a diff; apply one only after we agree.
${CLOSE}`,
  },
  {
    name: 'domain-story',
    title: 'Domain Storytelling',
    description: 'Tell a process as a domain story (who does what with what)',
    arg: { name: 'topic', hint: '<process>', description: 'The story to tell, e.g. "an order from cart to delivery"' },
    fallback: 'a process in this project — ask me which one',
    body: `Tell {arg} as a Domain Storytelling story (domainstorytelling.org) on the Unprose canvas.
Write design/<name>.domain-story.yaml: the scope (granularity, as-is or to-be), every actor once, one work object per activity, and numbered sentences "actor — verb — work object — to actor". Check it with design_lint, draw it with design_draw, then read the story back to me sentence by sentence and ask what is missing or wrong. (design_egon imports from or exports to Egon.io.)
${CLOSE}`,
  },
  {
    name: 'review',
    title: 'Review comments',
    description: 'Answer every open comment on a board',
    arg: { name: 'board', hint: '[board]', description: 'The board to review (title or id)' },
    fallback: 'the board we are working on — find it with canvas_list_boards and ask me if there are several',
    body: `Review the open comments on {arg} on the Unprose canvas.
Read the board (canvas_read_board) and find every comment thread that has no answer from you yet and is for you (not a thread routed or @mentioned to another agent — leave those to it). Answer each one in its thread (canvas_add_items, a comment with target). For a proposal — a dragged wire, edited text, a proposed story — say whether you agree and which file change would follow. Apply only what I have already agreed to in the thread, and only to files you hold (edit the file, design_lint, design_draw with applied: <thread id>) — another agent's "agree" is not mine; then tell me which files you changed, one line each. Then wait for more comments (canvas_wait). Talk with me in the language I use.`,
  },
]

/** The prompt text for an argument (empty → the fallback). */
export function promptText(p: StartPrompt, arg?: string): string {
  return p.body.replaceAll('{arg}', arg?.trim() || p.fallback || '')
}
