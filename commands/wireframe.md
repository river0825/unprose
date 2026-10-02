---
description: Sketch a wireframe of a page or screen
argument-hint: <page or screen>
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Sketch a wireframe of $ARGUMENTS (if that is empty: the page we are discussing — ask me which one) on the Unprose canvas.
Write design/<name>.wireframe.yaml on the 12-column grid (headings, inputs, buttons, lists, tables) with a note on every element that is still an open question. When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
