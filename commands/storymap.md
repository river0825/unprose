---
description: Turn an EventStorming into a story map with a first release
argument-hint: [es file or topic]
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Turn $ARGUMENTS (if that is empty: the EventStorming in design/ — ask me if there are several) into a user story map on the Unprose canvas.
1. Create design/<name>.story-map.yaml if it does not exist: activities from the pivotal events or phases, steps under them.
2. Run design_propose_stories from the EventStorming into the story map, on the same board, so the candidates show as proposals (person + command → story; the events and read models → acceptance criteria).
3. Explain the proposals and suggest a first release cut line. Write a story into the file only when I accept it, with traces back to its events.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
