// Sample content for `awd-canvas demo` — the Trello card pipeline from
// example/card-pipeline-coordinator, drawn five ways.
import type { DiagramKind } from './model.js'

export const demoBoards: Array<{ title: string; kind: DiagramKind; content: unknown; meta?: Record<string, unknown> }> = [
  {
    title: 'Card pipeline — Event Storming (process level)',
    kind: 'event-storming',
    meta: { source: 'example/card-pipeline-coordinator/SKILL.md', level: 'process' },
    content: {
      level: 'process',
      lanes: ['Planning', 'Build', 'Review & merge'],
      aggregates: ['Card'],
      events: [
        { text: 'Card moved to Agent Planning', lane: 'Planning', actor: 'Human', aggregate: 'Card' },
        { text: 'Spec written & published', lane: 'Planning', aggregate: 'Card' },
        { text: 'Card handed off to Agent Planned', lane: 'Planning', pivotal: true, aggregate: 'Card' },
        { text: 'Card confirmed into Ready', lane: 'Build', actor: 'Human', pivotal: true, aggregate: 'Card' },
        { text: 'Card qualified (size XS–L, RFA)', lane: 'Build', aggregate: 'Card' },
        { text: 'Build claimed', lane: 'Build', aggregate: 'Card' },
        { text: 'PR marked ready', lane: 'Build', aggregate: 'Card' },
        { text: 'Review findings resolved', lane: 'Review & merge', aggregate: 'Card' },
        { text: 'Card parked at Human Review', lane: 'Review & merge', pivotal: true, aggregate: 'Card' },
        { text: 'Human approved (Human Review Passed)', lane: 'Review & merge', actor: 'Human', aggregate: 'Card' },
        { text: 'PR merged & resources torn down', lane: 'Review & merge', aggregate: 'Card' },
      ],
      commands: [
        { text: 'Plan card', event: 'Spec written & published', actor: 'Planning worker (Opus)', aggregate: 'Card' },
        { text: 'Hand off plan', event: 'Card handed off to Agent Planned', aggregate: 'Card' },
        { text: 'Qualify card', event: 'Card qualified (size XS–L, RFA)', actor: 'Coordinator (Sonnet)', aggregate: 'Card' },
        { text: 'Claim build', event: 'Build claimed', aggregate: 'Card' },
        { text: 'Implement card', event: 'PR marked ready', actor: 'Build worker (Opus)', aggregate: 'Card' },
        { text: 'Resolve review findings', event: 'Review findings resolved', actor: 'Review worker' },
        { text: 'Merge & teardown', event: 'PR merged & resources torn down', actor: 'Merge worker' },
      ],
      policies: [
        { text: 'Whenever a card enters Agent Planning, plan it', when: 'Card moved to Agent Planning', then: 'Plan card' },
        { text: 'Whenever a card is confirmed Ready, qualify it', when: 'Card confirmed into Ready', then: 'Qualify card' },
        { text: 'Whenever qualified, claim before dispatch', when: 'Card qualified (size XS–L, RFA)', then: 'Claim build' },
        { text: 'Whenever a human approves, merge', when: 'Human approved (Human Review Passed)', then: 'Merge & teardown' },
      ],
      readModels: [
        { text: 'Board columns + labels (Trello)', for: 'Qualify card' },
        { text: 'Process ledger (claims, ports, PIDs)', for: 'Claim build' },
      ],
      externals: [
        { text: 'Trello', event: 'Card moved to Agent Planning' },
        { text: 'GitHub PR / CI', event: 'PR marked ready' },
      ],
      hotspots: [
        { text: 'Who verifies open questions were answered?', near: 'Card confirmed into Ready' },
        { text: 'Move vs spawn order — what if one fails?', near: 'Build claimed' },
        { text: 'Mock shipped as implementation', near: 'PR marked ready' },
      ],
      opportunities: [{ text: 'Golden test for the qualify gate', near: 'Qualify card' }],
    },
  },
  {
    title: 'Card pipeline — Event Storming (big picture)',
    kind: 'event-storming',
    meta: { level: 'big-picture' },
    content: {
      level: 'big-picture',
      events: [
        { text: 'Card put in Backlog', actor: 'Human' },
        { text: 'Card moved to Agent Planning', actor: 'Human' },
        { text: 'Plan done → Agent Planned', pivotal: true },
        { text: 'Card confirmed Ready', actor: 'Human', pivotal: true },
        { text: 'Card built, PR ready' },
        { text: 'AI review clean → Human Review', pivotal: true },
        { text: 'Human Review Passed', actor: 'Human' },
        { text: 'Merged, Ready for Staging' },
      ],
      hotspots: [
        { text: 'One card grew two branches', near: 'Card built, PR ready' },
        { text: 'Worktree left, ledger forgot it', near: 'Merged, Ready for Staging' },
      ],
    },
  },
  {
    title: 'Card pipeline — User story map',
    kind: 'user-story-map',
    content: {
      releases: ['v1 (replay + lint)', 'v2 (event-driven)', 'Later'],
      activities: [
        {
          text: 'Define the pipeline',
          steps: [
            { text: 'Write workflow.yaml', stories: [{ text: 'Triggers normalize Trello webhooks', release: 'v1 (replay + lint)' }, { text: 'Steps: script / ai / gate / human', release: 'v1 (replay + lint)' }] },
            { text: 'Lint it', stories: [{ text: 'Dead outcome references fail lint', release: 'v1 (replay + lint)' }, { text: 'Unreachable steps warn', release: 'v1 (replay + lint)' }] },
            { text: 'See it', stories: [{ text: 'Graph export to canvas', release: 'v2 (event-driven)' }, { text: 'Live run state on the diagram', release: 'Later' }] },
          ],
        },
        {
          text: 'Run it',
          steps: [
            { text: 'Receive events', stories: [{ text: 'Webhook trigger', release: 'v2 (event-driven)' }, { text: 'Cron reconcile', release: 'v2 (event-driven)' }, { text: 'CLI emit for manual testing', release: 'v1 (replay + lint)' }] },
            { text: 'Decide', stories: [{ text: 'Pure reducer (state, event) → commands', release: 'v1 (replay + lint)' }, { text: 'One active step per key', release: 'v1 (replay + lint)' }] },
            { text: 'Execute', stories: [{ text: 'Script executor parses last JSON line', release: 'v1 (replay + lint)' }, { text: 'Claude Code worker adapter', release: 'v2 (event-driven)' }, { text: 'Fake worker for tests', release: 'v1 (replay + lint)' }] },
          ],
        },
        {
          text: 'Trust it',
          steps: [
            { text: 'Replay', stories: [{ text: 'Golden tests without an LLM', release: 'v1 (replay + lint)' }] },
            { text: 'Reflect', stories: [{ text: 'Signal → pattern → decision', release: 'Later' }] },
          ],
        },
      ],
    },
  },
  {
    title: 'Human reviewer — journey through the pipeline',
    kind: 'user-journey',
    content: {
      persona: 'River, the human who owns the two entry gates and the merge decision',
      stages: [
        { text: 'Backlog triage', actions: ['Move card to Agent Planning'], touchpoints: ['Trello'], emotion: 1, pains: [], opportunities: ['Size hint at triage'] },
        { text: 'Waiting for plan', actions: ['Check Agent Planned column'], touchpoints: ['Trello', 'Design hub page'], emotion: 0, pains: ['Dwell here is invisible latency'], opportunities: ['Notify when plan lands'] },
        { text: 'Confirm & start', actions: ['Read spec', 'Answer open questions', 'Move to Ready'], touchpoints: ['Design hub', 'Quibble feedback bar'], emotion: -1, pains: ['Spec pages drift from openspec', 'Nobody verifies my answers were read'], opportunities: ['Spec as pure projection'] },
        { text: 'Watch the build', actions: ['Glance at dashboard'], touchpoints: ['Streamgauge dashboard'], emotion: 0, pains: ['Two PRs for one card', 'Mock shipped as done'], opportunities: ['Gate: real impl file changed'] },
        { text: 'Human review', actions: ['Test kept-alive preview', 'Move to Human Review Passed'], touchpoints: ['Preview tunnel', 'Trello'], emotion: -2, pains: ['12 review rounds with no oracle', 'Regression on nested mock pages'], opportunities: ['Golden fixtures from real paths'] },
        { text: 'Merged', actions: ['Nothing — worker merges & tears down'], touchpoints: ['GitHub'], emotion: 2, pains: ['Orphan worktrees eat 1 GB each'], opportunities: ['Teardown refuses when dirty'] },
      ],
    },
  },
  {
    title: 'Pipeline dashboard — wireframe',
    kind: 'wireframe',
    content: {
      screens: [
        {
          name: 'Pipeline dashboard',
          elements: [
            { role: 'nav', text: 'awd · card-pipeline · runs · events · settings', x: 0, y: 0, w: 12 },
            { role: 'heading', text: 'Runs by column', x: 0, y: 1, w: 8 },
            { role: 'button', text: 'Emit event', x: 9, y: 1, w: 3, note: 'Manual trigger for testing' },
            { role: 'box', text: 'Planning (3)', x: 0, y: 2, w: 3, h: 6 },
            { role: 'box', text: 'Ready → Build (2)', x: 3, y: 2, w: 3, h: 6 },
            { role: 'box', text: 'AI Review (1)', x: 6, y: 2, w: 3, h: 6 },
            { role: 'box', text: 'Human Review (4)', x: 9, y: 2, w: 3, h: 6, note: 'The only column the human must check' },
            { role: 'heading', text: 'Active steps (WIP cap 3)', x: 0, y: 8, w: 6 },
            { role: 'table', text: 'key · step · since · attempt', x: 0, y: 9, w: 12, h: 3 },
            { role: 'heading', text: 'Recent events', x: 0, y: 12, w: 6 },
            { role: 'list', text: 'card.moved · qualify.pick · plan.done · confirm.approved', x: 0, y: 13, w: 12, h: 3 },
          ],
        },
        {
          name: 'Run detail',
          w: 720,
          elements: [
            { role: 'heading', text: '#77 Upload contacts (S)', x: 0, y: 0, w: 8 },
            { role: 'label', text: 'status: waiting (confirm)', x: 8, y: 0, w: 4 },
            { role: 'image', text: 'workflow graph with current step highlighted', x: 0, y: 1, w: 12, h: 5 },
            { role: 'heading', text: 'Event stream', x: 0, y: 6, w: 6 },
            { role: 'list', text: 'trello · qualify.pick · plan.done · confirm (waiting)', x: 0, y: 7, w: 12, h: 3 },
            { role: 'button', text: 'Resume: approved', x: 0, y: 10, w: 3 },
            { role: 'button', text: 'Resume: rejected', x: 3, y: 10, w: 3 },
          ],
        },
      ],
    },
  },
  {
    title: 'Card pipeline — workflow graph',
    kind: 'workflow',
    content: {
      name: 'card-pipeline',
      nodes: [
        { id: 'trello', kind: 'trigger', label: 'trello (webhook)\n→ card.moved' },
        { id: 'reconcile', kind: 'trigger', label: 'reconcile (cron 30m)\n→ tick' },
        { id: 'qualify', kind: 'script', label: 'qualify\npython3 scripts/qualify.py' },
        { id: 'plan', kind: 'ai', label: 'plan\nrole: planner (opus)' },
        { id: 'confirm', kind: 'human', label: 'confirm\nwait for card.moved' },
        { id: 'size-ok', kind: 'gate', label: 'size-ok\nXS–L build · XL split' },
        { id: 'build', kind: 'script', label: 'build\nbash scripts/build.sh' },
        { id: 'split', kind: 'outcome', label: 'split (human)' },
      ],
      edges: [
        { from: 'trello', to: 'qualify', condition: "event.data.to == 'Ready'" },
        { from: 'qualify', to: 'plan', label: 'pick' },
        { from: 'plan', to: 'confirm', label: 'done' },
        { from: 'confirm', to: 'size-ok', label: 'approved' },
        { from: 'size-ok', to: 'build', label: 'build' },
        { from: 'size-ok', to: 'split', label: 'split' },
        { from: 'reconcile', to: 'qualify' },
      ],
    },
  },
  {
    title: 'Card pipeline — Kanban',
    kind: 'kanban',
    meta: { source: 'examples/card-pipeline/board.json', replaces: 'Trello board CNkHPiQs' },
    content: {
      columns: [
        { name: 'Backlog' },
        { name: 'Agent Planning', wip: 2 },
        { name: 'Agent Planned' },
        { name: 'Ready' },
        { name: 'In Progress', wip: 3 },
        { name: 'AI Agent Review' },
        { name: 'Human Review' },
        { name: 'Human Review Passed' },
        { name: 'Ready for Staging' },
      ],
      cards: [
        { id: 'c-backlog', title: 'Export contacts to CSV', column: 'Backlog', labels: ['T:Feature'] },
        { id: 'c-plan', title: 'Bulk tag editor', column: 'Agent Planning', labels: ['T:Feature'], assignee: '@planner' },
        { id: 'c-xl', title: 'Rewrite the sync engine', column: 'Agent Planned', size: 'XL', labels: ['ST:ReadyForHuman', 'Risk:High'] },
        { id: 'c-happy', title: 'Upload contacts CSV', column: 'Ready', size: 'M', labels: ['ST:ReadyForAgent', 'Risk:Low'] },
        { id: 'c-risky', title: 'Drop legacy_contacts table', column: 'Ready', size: 'S', labels: ['ST:ReadyForAgent', 'Risk:Highest'] },
        { id: 'c-flaky', title: 'Auto-sort disabled variants', column: 'In Progress', size: 'S', labels: ['ST:ReadyForAgent'], assignee: '@build' },
        { id: 'c-review', title: 'Contact search filters', column: 'AI Agent Review', size: 'L', labels: ['Risk:Medium'], assignee: '@reviewer' },
        { id: 'c-stuck', title: 'Flaky date parsing', column: 'Human Review', size: 'S', labels: ['Risk:Low'] },
        { id: 'c-norisk', title: 'Change sender address', column: 'Human Review Passed', size: 'S', labels: ['Risk:High'] },
      ],
    },
  },
]
