---
description: Tell a process as a domain story (who does what with what)
argument-hint: <process>
---
<!-- generated from packages/cli/src/prompts.ts by `npm run gen:commands`; edit it there -->

Tell $ARGUMENTS (if that is empty: a process in this project — ask me which one) as a Domain Storytelling story (domainstorytelling.org) on the Unprose canvas.
Write design/<name>.domain-story.yaml: the scope (granularity, as-is or to-be), every actor once, one work object per activity, and numbered sentences "actor — verb — work object — to actor". Check it with design_lint, draw it with design_draw, then read the story back to me sentence by sentence and ask what is missing or wrong. (design_egon imports from or exports to Egon.io.)
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
