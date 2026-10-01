---
description: Sketch a wireframe of a page or screen
argument-hint: <page or screen>
---
<!-- generated from packages/cli/src/prompts.ts by `npm run gen:commands`; edit it there -->

Sketch a wireframe of $ARGUMENTS (if that is empty: the page we are discussing — ask me which one) on the Unprose canvas.
Write design/<name>.wireframe.yaml on the 12-column grid (headings, inputs, buttons, lists, tables) with a note on every element that is still an open question. When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
