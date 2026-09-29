// WorkTracker adapters (docs/diagrams.md §6). Trello / Jira / Linear go here later, behind the same port.
export { CanvasKanbanTracker, type CanvasKanbanOptions } from './canvasKanban.js'
export { TextFileTracker, parseTasks, renderTasks, DEFAULT_COLUMNS, type TextFileTrackerOptions, type TasksDoc } from './textFile.js'
export { FakeWorkTracker } from './fake.js'
