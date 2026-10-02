---
description: Make a kanban of a release’s stories, traced to the story map
argument-hint: [release or topic]
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Make a kanban for $ARGUMENTS (if that is empty: the first release of the story map in design/) on the Unprose canvas.
Write design/<name>.kanban.yaml with the columns Backlog, Next, Doing, Review, Done (unless I want others) and one card per story, each with `stories: ['<story map key>/<story id>']` so it traces back, and a size where you can estimate one. Check it with design_lint and draw it with design_draw on the same board as the story map.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
