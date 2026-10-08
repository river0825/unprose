---
description: Mock a screen as real-looking UI and discuss it on the canvas
argument-hint: <screen or page>
---
<!-- generated from packages/canvas/src/prompts.ts by `npm run gen:commands`; edit it there -->

Mock $ARGUMENTS (if that is empty: the screen we are discussing — ask me which one) as real-looking UI on the Unprose canvas (a UI mock frame, like a Figma frame).
Write design/<name>.ui.yaml (docs/diagrams.md §6c): screens at a device size (desktop, tablet or phone), each a tree of components — navbar, sidebar, section, card, row, grid, heading, text, button, input, select, table, list, stat, tabs, badge, alert, image … — with a stable `id` on every element we will talk about, real copy instead of lorem ipsum, a `note` that says what an item is for and why it is there, or what is still an open question (on the screen, an element, a list item or a table row — a design annotation, drawn as a numbered pin on that item and a card with the same number beside the screen, never on the product; never write TBD / sample / proposal into the product text, lint flags it), `sample: true` on made-up content, and `goto: <screen>` on buttons that lead to another screen. When a story map exists, trace each screen to the stories it shows (rel: shows). Check it with design_lint and draw it with design_draw.
When I edit words on the board they show as proposals with a diff; apply one only after we agree.
If the board should show two languages, keep the card text short — a bilingual title like "Order placed · 訂單已成立" (about 32 characters / 12 字 per language on a sticky, 50 / 20 on a kanban card) — and put the full text where the kind keeps longer text (kanban description, story acceptance, wireframe / UI note, domain-story note, EventStorming definitions or hotspots); never enlarge a sticky to fit text.
Give me the board link, call canvas_focus on the frame, then wait for my comments (canvas_wait) and answer each in its thread. Change the file only after I agree, then lint and redraw. Talk with me in the language I use.
