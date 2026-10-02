---
description: Make a kanban of a release’s stories, traced to the story map
argument-hint: [release or topic]
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Make a kanban for $ARGUMENTS (if that is empty: the first release of the story map in design/) on the Unprose canvas.
Write design/<name>.kanban.yaml with the columns Backlog, Next, Doing, Review, Done (unless I want others) and one card per story, each with `stories: ['<story map key>/<story id>']` so it traces back, and a size where you can estimate one. Check it with design_lint and draw it with design_draw on the same board as the story map.
If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
