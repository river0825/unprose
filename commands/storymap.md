---
description: Turn an EventStorming into a story map with a first release
argument-hint: [es file or topic]
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Turn $ARGUMENTS (if that is empty: the EventStorming in design/ — ask me if there are several) into a user story map on the Unprose canvas.
1. Create design/<name>.story-map.yaml if it does not exist: activities from the pivotal events or phases, steps under them.
2. Run design_propose_stories from the EventStorming into the story map, on the same board, so the candidates show as proposals (person + command → story; the events and read models → acceptance criteria).
3. Explain the proposals and suggest a first release cut line. Write a story into the file only when I accept it, with traces back to its events.
If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
