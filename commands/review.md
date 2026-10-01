---
description: Answer every open comment on a board
argument-hint: [board]
---
<!-- generated from packages/cli/src/prompts.ts by `npm run gen:commands`; edit it there -->

Review the open comments on $ARGUMENTS (if that is empty: the board we are working on — find it with canvas_list_boards and ask me if there are several) on the Unprose canvas.
Read the board (canvas_read_board) and find every comment thread that has no answer from you yet. Answer each one in its thread (canvas_add_items, a comment with target). For a proposal — a dragged wire, edited text, a proposed story — say whether you agree and which file change would follow. Apply only what I have already agreed to (edit the file, design_lint, design_draw), then tell me which files you changed, one line each. Then wait for more comments (canvas_wait). Talk with me in the language I use.
