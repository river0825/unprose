// Kanban alignment (with the layout lock) lives in the shared src/shown.ts: the server's snapshot, outline and layout
// check use it too, so they agree with the page on where a card is drawn. Re-exported here for the web.
export { alignKanban, kanbanOrigins, snapColumns, stackCards, KANBAN_GAP, KANBAN_HEADER, KANBAN_PAD, type Origins } from '../../../src/shown'
