# herdr-smoke — two different CLI agents, one workflow, no A2A

`ask` runs on **codex**, `check` runs on **opencode**; both live in herdr panes
and talk to awd through mailbox files (`.awd/mail/<command>.{in,out}.json`).

```bash
# herdr server running, codex + opencode installed
npx awd run examples/herdr-smoke/workflow.yaml --worker claude-code --store-dir /tmp/awd-herdr &
npx awd emit examples/herdr-smoke/workflow.yaml ping --data '{"q":"What is 6*7? Reply with just the number."}' --store-dir /tmp/awd-herdr
npx awd status examples/herdr-smoke/workflow.yaml --store-dir /tmp/awd-herdr
```

Measured 2026-09-22: `ask → done` in 11 s (codex pane reused), `check → ok` in
13 s (opencode started in a fresh pane). The panes stay open — look at them.
