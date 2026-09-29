# Unprose

**A shared visual canvas where people and AI agents talk designs through.**
A plugin for Claude Code, Codex and any MCP-capable agent.

Long prose is a poor medium for aligning with an agent: you cannot point at a sentence and say "this
part, but different", and you cannot see what the agent understood. Unprose puts the conversation on a
board — EventStorming, story maps, kanban, wireframes, agent workflows — where you comment on an item,
drag a wire, or edit a line, and the agent answers in the thread and changes the files behind it.

## The design chain

```
EventStorming ──(events, flow)──▶ User Story Map ──(stories grouped)──▶ Work tracker (kanban · text file · …)
  discuss how the system works       decide the scope (release lines)       track the work
                                              │
                                              └──▶ Wireframes: what a story looks like
Domain Storytelling (optional way in) · Workflows (agent pipelines as data)
```

Several diagrams share one board as **diagram frames**, linked by trace wires (derived from / groups /
shows), so "which event does this story come from?" is one click away.

## How it works

- **Files are the truth.** Every diagram is a file in your repo — `design/<name>.es.yaml`,
  `design/<name>.story-map.yaml`, a workflow yaml … The board is a projection; redraws keep your layout.
- **The AI is the editor, you direct.** Comment on anything (an item, a selection, lines of a file, the
  whole board); with Studio running, the comment reaches an agent session that answers in the thread.
- **Edits on the canvas are proposals.** A wire you drag, text you change in the source dialog, a story
  proposed from EventStorming — the agent reviews it with you, then applies it to the file.
- **Read receipts.** Every message shows Sent / Seen by agent / Agent is working / Needs you.
- **EventStorming per the book** (*Introducing EventStorming*): colours, the command → system → event →
  policy grammar, left → right in time, a grammar check with page references.

## Quick start

```bash
git clone https://github.com/<owner>/unprose && cd unprose
npm install && npm run build
npm start                         # canvas → http://localhost:4400
node packages/cli/bin/awd.js design draw design/studio.es.yaml --board "title:My first board"
node packages/cli/bin/awd.js design draw design/studio.story-map.yaml --board "title:My first board"
```

Open the printed URL, select an item, and ask something in the **Chat** tab.

Use it from your agent:

- **Claude Code plugin:** `/plugin marketplace add <owner>/unprose` then `/plugin install unprose@unprose`
  (skill + the `awd-canvas` MCP server). See [docs/agents-setup.md](docs/agents-setup.md).
- **Codex / other MCP clients:** register `node <unprose>/scripts/mcp.mjs` as an MCP server and point
  the agent at [AGENTS.md](AGENTS.md).
- **Studio** (optional: agent sessions per board, in herdr terminal panes):
  `node packages/cli/bin/awd.js studio --project <your repo>` — see [docs/studio.md](docs/studio.md).

## Screenshots

_To add:_ the Studio example board (EventStorming + story map + workflow frames) · the Inspector on a
workflow step · a chat with read receipts · a proposed wire change · the source dialog with line comments.

## What's inside

| Package | What |
|---|---|
| `packages/canvas` | the canvas server (HTTP + WebSocket), diagram templates, the MCP server, the web UI |
| `packages/core` | workflow schema, pure reducer, expressions, lint (IO-free) |
| `packages/runtime` | the event-driven workflow runtime, workers (Claude Code, herdr, Anthropic API), Studio |
| `packages/cli` | `awd` — lint · graph · run · test · design · studio · reflect |

Docs: [diagrams](docs/diagrams.md) · [studio](docs/studio.md) · [canvas API](docs/canvas.md) ·
[workflow format](docs/workflow.md) · [architecture](docs/ARCHITECTURE.md).

## Status

Early and moving fast. Working: diagram frames with files, EventStorming and story maps, workflows,
Studio (one agent session per board, forks for concurrent requests), proposals, read receipts.
Next: more diagram kinds (sequence, state, C4, ER), Trello / Jira / Linear adapters for the work
tracker, authentication for shared canvases, a hosted option.

> The canvas server has **no authentication** yet. Keep it on localhost or behind an access proxy.

## 繁體中文

Unprose 是協助人類與 AI 溝通的工具，給開發者，以及想利用 AI agent 做設計討論的人。把討論從一大段文字
搬到畫面上：EventStorming 討論流程、User Story Mapping 決定範圍、Kanban 管理進度、Wireframe 說明頁面。
每張圖背後都是 repo 裡的一個檔案；AI 負責修改，人下指導棋，畫面上的修改都先變成提案，討論後才改檔。

## License

[Apache-2.0](LICENSE)
