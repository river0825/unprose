// "What you can ask your agent": the capabilities shown on the board list and on an empty board.
// One list, so it stays in sync with the Claude Code slash commands (commands/*.md) and the skill.
// A <placeholder> in a prompt is the part the person replaces; the copied text keeps it as written.

export interface AskHint {
  id: string
  title: string
  /** one line: what this diagram or action is for */
  what: string
  /** a sentence to paste into the agent */
  prompt: string
  /** the Claude Code slash command that does the same */
  command: string
}

export const ASK_HINTS: AskHint[] = [
  {
    id: 'eventstorm',
    title: 'EventStorming',
    what: 'The flow of a process in time.',
    prompt: 'Run an EventStorming of <our refund process> on the canvas',
    command: '/unprose:eventstorm',
  },
  {
    id: 'storymap',
    title: 'Story map',
    what: 'Scope and releases, from the EventStorming.',
    prompt: 'Turn the EventStorming into a story map with a first release',
    command: '/unprose:storymap',
  },
  {
    id: 'kanban',
    title: 'Kanban',
    what: 'The work, traced to stories.',
    prompt: "Make a kanban of the first release's stories",
    command: '/unprose:kanban',
  },
  {
    id: 'wireframe',
    title: 'Wireframe',
    what: 'One page or screen.',
    prompt: 'Sketch a wireframe of the <checkout page>',
    command: '/unprose:wireframe',
  },
  {
    id: 'domain-story',
    title: 'Domain Storytelling',
    what: 'Who does what with what.',
    prompt: 'Tell the <order> story as a domain story',
    command: '/unprose:domain-story',
  },
  {
    id: 'review',
    title: 'Review',
    what: 'Answer every open comment on a board.',
    prompt: 'Read my comments on this board and answer them',
    command: '/unprose:review',
  },
]

export const HELP_HINT: AskHint = {
  id: 'help',
  title: 'Help',
  what: 'Everything Unprose can do.',
  prompt: 'What can Unprose do?',
  command: '/unprose:help',
}

/** A prompt split into plain text and <placeholder> parts, for rendering the placeholders apart. */
export function promptParts(prompt: string): { text: string; slot: boolean }[] {
  return prompt
    .split(/(<[^>]+>)/)
    .filter(Boolean)
    .map((text) => ({ text, slot: /^<[^>]+>$/.test(text) }))
}
