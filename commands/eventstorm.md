---
description: Run an EventStorming of a process on the canvas
argument-hint: <process or domain>
---
<!-- generated from packages/cli/src/prompts.ts by `npm run gen:commands`; edit it there -->

Run an EventStorming with me on the Unprose canvas about: $ARGUMENTS (if that is empty: a process in this project — ask me which one).
1. If the scope is unclear, ask me at most three short questions (where the flow starts and ends, who is involved).
2. Write design/<name>.es.yaml the way Introducing EventStorming describes it: domain events in the past tense on a left → right timeline, commands issued by people, the system between a command and its event, policies between an event and the next command, read models, and hotspots for every open question or disagreement.
3. Check it with design_lint, then draw it with design_draw on a board titled after the topic.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
