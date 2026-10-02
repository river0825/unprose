---
description: Tell a process as a domain story (who does what with what)
argument-hint: <process>
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Tell $ARGUMENTS (if that is empty: a process in this project — ask me which one) as a Domain Storytelling story (domainstorytelling.org) on the Unprose canvas.
Write design/<name>.domain-story.yaml: the scope (granularity, as-is or to-be), every actor once, one work object per activity, and numbered sentences "actor — verb — work object — to actor". Check it with design_lint, draw it with design_draw, then read the story back to me sentence by sentence and ask what is missing or wrong. (design_egon imports from or exports to Egon.io.)
If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
