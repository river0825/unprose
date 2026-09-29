# AGENTS.md — working with Unprose

Instructions for any AI coding agent (Codex, Claude Code, Gemini CLI, opencode, …) in a project that uses
Unprose to discuss designs with a person on a shared canvas.

## Principles

- **Files are the truth.** Each diagram is a file: `design/<name>.<kind>.yaml` (kinds `es`, `story-map`,
  `kanban`, `wireframe`, `domain-story`, `journey`) or a workflow yaml. The canvas board is a projection.
- **You edit, the person directs.** Change files after they agree; say which files you changed.
- **Edits on the canvas are proposals** (a dragged wire, text edited in the source dialog, a proposed
  story). Discuss them in the comment thread first, then apply them to the file and redraw.

## Setup

```bash
node scripts/canvas.mjs       # canvas on http://localhost:4400 — runs as shipped (dist/), no build
# working on Unprose itself: npm install && npm run build; `npm start` also runs an example workflow
```

Register the MCP server `awd-canvas` in your agent (see `docs/agents-setup.md`): it runs
`node scripts/mcp.mjs` and talks to the canvas at `AWD_CANVAS_URL` (default `http://localhost:4400`).
For a canvas elsewhere (tunnel, another host) set `AWD_CANVAS_URL=https://canvas.example.com` — a pasted
board link works too. If it cannot be reached, the MCP server exits with
`awd-canvas MCP: cannot reach <url> (<reason>)` instead of a bare "Connection closed". The CLI takes
`--canvas <url>`.

## Commands

| Goal | Command |
|---|---|
| Draw / refresh a diagram frame | `node scripts/awd.mjs design draw design/<file>.yaml --board "title:<board>"` |
| Check a diagram (schema + EventStorming grammar) | `node scripts/awd.mjs design lint design/<file>.yaml` |
| Story candidates from EventStorming | `node scripts/awd.mjs design propose-stories design/x.es.yaml --into design/x.story-map.yaml --board …` |
| A workflow as a board | `node scripts/awd.mjs graph <workflow.yaml> --canvas` |
| Lint / golden-test a workflow | `node scripts/awd.mjs lint <wf>` · `… test <wf>` |

## The loop

1. Choose the diagram: EventStorming (flow in time), story map (scope), kanban (work), wireframe (page),
   workflow (agent pipeline). Link related elements across diagrams with `traces`.
2. Write the file, lint, draw; give the person the board URL.
3. Wait for comments (MCP `canvas_wait`), answer in the thread, record open questions as hotspots.
4. On agreement: edit the file, lint, redraw.

Details: `docs/diagrams.md` (diagram files, EventStorming per the book), `docs/studio.md` (the comment →
agent session loop), `docs/canvas.md` (the canvas API and MCP tools).
