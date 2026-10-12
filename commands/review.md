---
description: Answer every open comment on a board
argument-hint: [board]
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Review the open comments on $ARGUMENTS (if that is empty: the board we are working on — find it with canvas_list_boards and ask me if there are several) on the Unprose canvas.
Read the board (canvas_read_board) and find every comment thread that has no answer from you yet and is for you (not a thread routed or @mentioned to another agent — leave those to it). Answer each one in its thread (canvas_add_items, a comment with target). For a proposal — a dragged wire, edited text, a proposed story — say whether you agree and which file change would follow. Apply only what I have already agreed to in the thread, and only to files you hold (edit the file, design_lint, design_draw with applied: <thread id>) — another agent's "agree" is not mine; then tell me which files you changed, one line each. My draft annotation (what an item is for) is my own words: judge it in its thread — true to the design, not contradicting the file or another annotation, saying what the item is for? — and if it is sound and you hold the file, add it to the file's annotations and redraw with applied: <thread id> right away; if you have doubts, say why and wait for me. Leave TODOs alone (canvas_todo lists them): they are notes to confirm something with someone else, not questions to you. Then wait for more comments (canvas_wait). Talk with me in the language I use.
