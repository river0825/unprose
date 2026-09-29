# Unprose

**Talk designs through with your AI agent on a shared board, not in walls of text.**

[繁體中文](README.zh-TW.md) · Works with Claude Code, Codex and any MCP agent · Apache-2.0

![Ask about an item on the board; the agent answers in the thread and updates the diagram](docs/images/demo.gif)

## Why

- Long text is hard to align on. You can't point at a sentence and say "this part".
- On a board you can. Select a box, a line or a whole diagram, and ask.
- The agent edits the design files in your repo. You decide what changes.

## Try it in 5 minutes

You need **Node.js 20+**, **git**, and **Claude Code** (other agents: see below).

```bash
git clone https://github.com/river0825/unprose && cd unprose
npm install && npm run build
npm start                     # the board opens at http://localhost:4400
```

Keep that running. In a second terminal, connect Claude Code to the board:

```bash
claude mcp add awd-canvas -e AWD_CANVAS_URL=http://localhost:4400 -- node "$PWD/scripts/mcp.mjs"
```

That's it. Open Claude Code in any project and follow **Your first session** below.

<details>
<summary><b>Other ways to connect</b> (Claude Code plugin, Codex, other MCP clients)</summary>

- **Claude Code plugin** (adds the Unprose skill too):
  ```
  /plugin marketplace add river0825/unprose
  /plugin install unprose@unprose
  ```
  Then run `npm install && npm run build` once inside the installed plugin folder.
- **Codex:** add to `~/.codex/config.toml`, and copy [AGENTS.md](AGENTS.md) into your project:
  ```toml
  [mcp_servers.awd-canvas]
  command = "node"
  args = ["/path/to/unprose/scripts/mcp.mjs"]
  env = { AWD_CANVAS_URL = "http://localhost:4400" }
  ```
- **Any MCP client:** a stdio server, command `node`, argument `/path/to/unprose/scripts/mcp.mjs`,
  environment `AWD_CANVAS_URL=http://localhost:4400`.

Details and caveats: [docs/agents-setup.md](docs/agents-setup.md).
</details>

## Your first session

**1. Ask your agent for a diagram.**

> Draw an EventStorming of our signup flow in Unprose.

The agent writes `design/signup.es.yaml` in your repo and draws it on the board.

**2. Open the board.** Go to <http://localhost:4400> and pick the board the agent created.
Events, commands, systems and policies read left to right in time.

![The signup flow as an EventStorming board](docs/images/step2-board.png)

**3. Ask about one item.** Click a box, open the **Chat** tab, type your question, press **Ask AI**.

![Selecting "Send verification email" and asking a question in the Chat tab](docs/images/step3-comment.png)

**4. The agent replies and edits the file.** The answer appears in the same thread. When the change
is agreed, the agent updates `design/signup.es.yaml` and the board redraws. Here it added
**Resend email**.

![The agent's reply in the thread, and the new "Resend email" command on the board](docs/images/step4-reply.png)

Every message shows where it is: **Sent**, **Seen by agent**, **Agent is working…**, or
**Needs you**.

![A question with "Agent is working…" under it](docs/images/receipts.png)

## Diagrams

Each diagram is one file in `design/`. Several can share one board and link to each other.

| Diagram | Use it to | File | Preview |
|---|---|---|---|
| EventStorming | discuss how the system behaves, step by step | `design/<name>.es.yaml` | <img src="docs/images/thumb-es.png" width="260" alt="EventStorming"> |
| Story map | decide what to build first (release lines) | `design/<name>.story-map.yaml` | <img src="docs/images/thumb-story-map.png" width="150" alt="Story map"> |
| Kanban | track the work | `design/<name>.kanban.yaml` | <img src="docs/images/thumb-kanban.png" width="260" alt="Kanban"> |
| Wireframe | sketch a screen | `design/<name>.wireframe.yaml` | <img src="docs/images/thumb-wireframe.png" width="260" alt="Wireframe"> |
| Workflow | describe an agent pipeline you can run | `<name>.workflow.yaml` | <img src="docs/images/thumb-workflow.png" width="260" alt="Workflow"> |

More views of the same ideas:

| | |
|---|---|
| ![Inspector](docs/images/inspector.png) | ![Proposed wire change](docs/images/wire-proposal.png) |
| **Inspector:** everything about one step: who runs it, its prompt, its outcomes. | **Proposals:** drag a wire; the agent reviews the change with you before editing the file. |

![Source dialog with syntax highlighting and a comment on lines 13–15](docs/images/source-dialog.png)
**Comment on any lines** of a file or prompt, in a large view with syntax highlighting.

## How it works

```
  design/*.yaml  ──draw──▶  board  ──you comment──▶  agent
        ▲                                              │
        └──────────────── edits the file ◀─────────────┘
```

1. **Files are the truth.** The board is drawn from files in your repo. Every change is a normal git diff.
2. **The agent edits, you direct.** You ask and decide; the agent does the typing.
3. **Changes on the board are proposals.** A dragged wire or an edited line waits for your OK.
4. **Your layout stays.** Redrawing keeps where you put things.

## Glossary

| Word | Meaning |
|---|---|
| **Board** | A page on the canvas. It can hold several diagrams. |
| **Diagram frame** | One diagram on a board, drawn from one file. |
| **Trace** | A dotted link between diagrams, e.g. "this story comes from that command". |
| **Proposal** | A change you made on the board that is not in the file yet. |
| **Studio** | Optional. Gives each board its own agent session, so plain comments get answers. See [docs/studio.md](docs/studio.md). |
| **herdr** | The terminal workspace Studio uses to run agent sessions in panes. [herdr.dev](https://herdr.dev) |
| **awd** | The command-line tool: `node packages/cli/bin/awd.js design draw …`, `lint`, `run`, `studio`. |

## Status

Early and moving fast. Working today: EventStorming, story maps, kanban, wireframes and workflows as
files; chat on any item, selection, line or board; proposals; read receipts; Studio.
Next: more diagram kinds, Trello / Jira / Linear sync, sign-in for shared boards, a hosted option.

More reading: [diagrams](docs/diagrams.md) · [studio](docs/studio.md) · [canvas API](docs/canvas.md) ·
[workflow format](docs/workflow.md) · [architecture](docs/ARCHITECTURE.md).

## Safety

The board has **no sign-in yet**. Anyone who can reach it can read and edit it. Keep it on
`localhost`, or put an access proxy in front of it before sharing.

## License

[Apache-2.0](LICENSE)
