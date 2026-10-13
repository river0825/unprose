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
Write design/<name>.ui.yaml (docs/diagrams.md §6c): screens at a device size (desktop, tablet or phone), each a tree of components — navbar, sidebar, section, card, row, grid, heading, text, button, input, select, table, list, stat, tabs, badge, alert, image … — with a stable \`id\` on every element we will talk about, real copy instead of lorem ipsum, a \`note\` that says what an item is for and why it is there, or what is still an open question (on the screen, an element, a list item or a table row — a design annotation, drawn as a numbered pin on that item and a card with the same number beside the screen, never on the product; never write TBD / sample / proposal into the product text, lint flags it), \`sample: true\` on made-up content, and \`goto: <screen>\` on every element that leads to another screen (that is where a click goes — never a "Click → …" note: the navigate arrows, Play and the Clickable view read goto, lint flags such notes). When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
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
If a \`domain-storytelling\` skill is available to you, load it first — it carries the method with the book's pages. First settle the scope with me, because every sentence is judged by it: the granularity — coarse-grained (the whole process at a glance: what happens, not how), medium-grained, or fine-grained (one part in detail, how exactly it is done) — as-is or to-be, and pure (no software) or digitalized (software systems are actors). Keep every sentence at that one level (mixing levels is a bad smell; "clicks button" is too fine for any story); detail that belongs to another level is another story. If the domain has not been told without software yet, say that the usual way is a pure as-is story first, and ask whether to start there.
Write design/<name>.domain-story.yaml: the scope, every actor once, one work object per activity, and numbered sentences "actor — verb — work object — to actor". While you write, hold each sentence against these:
- One concrete case, no "if" or "or": tell the usual case, put a variation in a note, give an alternative that matters its own story.
- What does not happen is not a sentence. Say which case this story tells in a note on the whole story (an \`annotations\` entry on its first work object: "assumption: Casey matches for the first time"); say where a sentence would not happen in a note on that sentence ("variation: already sent → ③ does not happen"); wrap a stretch that is sometimes skipped in a \`groups\` outline ("optional: …"); keep the rule itself ("only once per contact") in an EventStorming policy or the story map's acceptance and link to it; a rejected alternative goes to the decisions kanban. One sentence per note — the detail goes into the sentence's \`note\`.
- An actor plays an active part (a person, a group, a software system) and is named by its role; what is only carried along or acted on is a work object.
- Model intent, not screens: no user-asks / system-answers pairs and no arrows from a system back to itself. Each activity should push the story forward — what is the person after, and how does the system help?
- A work object is something an actor creates, works with or hands over, named in the words the people use and never hidden inside a verb ("searches for a seat in" hides the seat). When the same thing comes back, it is drawn again under the same name (it may say its state: "signed contract"); an outcome on its own ("check passed") is not a thing.
- Give each kind of work object an icon that says what it is: a built-in kind (document, thing, digital, folder, call, email, conversation, info), or draw your own — \`icons: { <name>: '<svg viewBox="0 0 24 24">…</svg>' }\`, a line drawing of plain shapes — and use its name as the kind. Fit the icon set to the domain, and keep it small: one icon for everything tells the reader nothing, too many water the language down.
When pictograms collide, change the layout (layout.spacing, a split into scenarios) — never the story: no actor or sentence is dropped to make the picture fit. Check it with design_lint (its hints are questions for us, not errors), draw it with design_draw, then tell the story back to me from the beginning, sentence by sentence, and ask what is missing or wrong. (design_egon imports from or exports to Egon.io.)
${CLOSE}`,
  },
  {
    name: 'critique',
    title: 'Critique a domain story',
    description: 'Read a domain story as a Domain Storytelling reviewer and say what to improve',
    arg: { name: 'story', hint: '[board link, frame or file]', description: 'The domain story to read: a board link or frame, or a design/*.domain-story.yaml file' },
    fallback: 'the domain story we are working on — find it with canvas_list_boards and ask me if there are several',
    body: `Read {arg} as a Domain Storytelling reviewer (load the \`domain-storytelling\` skill if you have it; docs/domain-story-review.md has the sources) and tell me what you see and what to improve. You advise; you change nothing.
Look first: canvas_read_board with the frame for the sentences, notes and comments, canvas_snapshot to see the picture as I see it, and design_lint on the file when you can read it (canvas_files, or the file itself). Then tell the story back to yourself from the beginning, one sentence at a time, and hold it against the method:
1. Scope — is it stated (coarse-, medium- or fine-grained; as-is or to-be; pure or digitalized), and does every sentence keep to it? A coarse-grained story says what happens across the whole process, end to end; steps that explain how one actor does one thing are fine-grained and belong in a story of their own; mixing the levels is a bad smell, and "clicks button" is too fine for any story. A story with software systems is digitalized. The usual journey is coarse-grained pure as-is, then fine-grained pure as-is, then fine-grained digitalized to-be — not a rule, but ask what came before this story.
2. One concrete case — no "if", "or", "sometimes"; variations in notes, important alternatives as separate stories. Are the notes where the method puts them: the case told as an assumption on the whole story, a variation on the sentence it changes, a skipped stretch as a group, the rule itself in an EventStorming policy or the story map — and never a story made of what does not happen?
3. Sentences — each reads aloud as actor — verb — work object (— to actor), in the words the people of the domain use; the same thing has the same name everywhere, on this board and in the diagrams it traces to.
4. Actors — a person, a group or a software system that plays an active part, named by its role, each drawn once. Ask of each: does it decide to do this, or is it carried along? (The same concept can be an actor in one story and a work object in another.)
5. Work objects — things an actor creates, works with or hands over. Follow the main one through the story: it should come back under the same name (its state may change: "signed contract"); an outcome on its own is not a thing, and a work object hidden inside a verb or inside another work object should stand on its own. Does each icon say what the thing is — a small set that fits the domain — or is everything the same pictogram?
6. Intent, not screens — if the sentences are a user asking and a system answering, or a system sending things back to itself, the story shows an interface, which a mock-up does better. Ask what the person is after, who else is involved, and whether each activity pushes the story forward.
7. The story as a whole — where does it start and what triggers it, and what has whom at the end? (Adding a sentence before the beginning and after the end often shows what is missing.) The purpose and the assumptions belong in notes.
Answer in this order: what the story says, in two or three sentences; what is well done; then the findings, most important first — each with the sentence number, the question to ask the people who know the domain, and a rewritten sentence. Say for each finding whether the method states it (items 1–6 rest on the authors' book and quick-start guide) or it is your own judgment (most of item 7, and anything about taste), and never present a guess about the domain as a fact — ask. Close with the three changes you would make first.
Call canvas_focus on the sentence you are talking about. Put a finding on the board (a comment on its item, one finding per comment) only when I ask for it, and leave the file to whoever holds it: propose, do not edit. Talk with me in the language I use.`,
  },
  {
    name: 'review',
    title: 'Review comments',
    description: 'Answer every open comment on a board',
    arg: { name: 'board', hint: '[board]', description: 'The board to review (title or id)' },
    fallback: 'the board we are working on — find it with canvas_list_boards and ask me if there are several',
    body: `Review the open comments on {arg} on the Unprose canvas.
Read the board (canvas_read_board) and find every comment thread that has no answer from you yet and is for you (not a thread routed or @mentioned to another agent — leave those to it). Answer each one in its thread (canvas_add_items, a comment with target). For a proposal — a dragged wire, edited text, a proposed story — say whether you agree and which file change would follow. Apply only what I have already agreed to in the thread, and only to files you hold (edit the file, design_lint, design_draw with applied: <thread id>) — another agent's "agree" is not mine; then tell me which files you changed, one line each. My draft annotation (what an item is for) is my own words: judge it in its thread — true to the design, not contradicting the file or another annotation, saying what the item is for? — and if it is sound and you hold the file, add it to the file's annotations and redraw with applied: <thread id> right away; if you have doubts, say why and wait for me. Leave TODOs alone (canvas_todo lists them): they are notes to confirm something with someone else, not questions to you. Then wait for more comments (canvas_wait). Talk with me in the language I use.`,
  },
]

/** The prompt text for an argument (empty → the fallback). */
export function promptText(p: StartPrompt, arg?: string): string {
  return p.body.replaceAll('{arg}', arg?.trim() || p.fallback || '')
}
