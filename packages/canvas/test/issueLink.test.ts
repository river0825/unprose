// Problems and ideas as GitHub issues the person files (docs/canvas.md "Feedback about Unprose"): the prefilled
// "new issue" link (src/issueLink.ts), the issue forms it fills (.github/ISSUE_TEMPLATE), and unprose_feedback's
// kind / title and the link in its answer. Nothing here talks to GitHub.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_ISSUES_REPO, feedbackDraft, ISSUE_FORMS, ISSUE_WHERE, issuesRepo, issueUrl, MAX_ISSUE_URL, repoName, titleFrom } from '../src/issueLink.js'
import { startServer, type RunningServer } from '../src/server.js'
import { AccessService } from '../src/access.js'
import { MemoryAccessStore } from '../src/adapters/access/index.js'
import { MemoryFeedbackStore } from '../src/adapters/feedback/index.js'
import { createBoardRepository } from '../src/adapters/boards/index.js'
import { VERSION } from '../src/version.js'

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.github/ISSUE_TEMPLATE')
const q = (url: string) => new URL(url).searchParams

// ── the link ───────────────────────────────────────────────────────────────────

test('a problem: the bug form, its title and fields by id, the version and where', () => {
  const url = issueUrl({ kind: 'bug', title: 'canvas_wait returns at once', text: 'It came back after 1 s.', where: 'Local MCP', version: '0.28.0', repo: 'acme/tools' })
  assert.ok(url.startsWith('https://github.com/acme/tools/issues/new?template=bug_report.yml&title='), url)
  const p = q(url)
  assert.equal(p.get('template'), 'bug_report.yml')
  assert.equal(p.get('title'), 'canvas_wait returns at once')
  assert.equal(p.get('what-happened'), 'It came back after 1 s.')
  assert.equal(p.get('where'), 'Local MCP')
  assert.equal(p.get('version'), '0.28.0')
  assert.ok(!url.includes('+'), 'spaces are %20, never "+"')
})

test('an idea: the feature form; the text goes to "The problem"; no "Where" (the form has none)', () => {
  const p = q(issueUrl({ kind: 'idea', text: 'Hard to find a frame on a big board.', fields: { idea: 'A frame list in ⌘K', steps: 'not on this form' }, where: 'Canvas page', version: '0.28.0' }))
  assert.equal(p.get('template'), 'feature_request.yml')
  assert.equal(p.get('problem'), 'Hard to find a frame on a big board.')
  assert.equal(p.get('idea'), 'A frame list in ⌘K')
  assert.equal(p.get('where'), null)
  assert.equal(p.get('steps'), null, 'a field the form does not have is left out')
  assert.equal(p.get('title'), 'Hard to find a frame on a big board', 'the title comes from the text when none is given')
})

test('CJK, emoji and newlines are encoded as UTF-8; \\r\\n becomes \\n; a lone surrogate does not throw', () => {
  const text = '看板上找不到框架。\r\n第二行 🙂\n\tend'
  const url = issueUrl({ kind: 'bug', title: '找不到框架', text })
  assert.match(url, /title=%E6%89%BE%E4%B8%8D%E5%88%B0%E6%A1%86%E6%9E%B6/)
  assert.match(url, /%0A%E7%AC%AC%E4%BA%8C%E8%A1%8C%20%F0%9F%99%82%0A%09end/)
  assert.ok(!url.includes('%0D'))
  assert.equal(q(url).get('what-happened'), '看板上找不到框架。\n第二行 🙂\n\tend')
  assert.doesNotThrow(() => issueUrl({ kind: 'bug', text: `half ${'🙂'.slice(0, 1)} an emoji` }))
})

test('a long text is cut, with a visible "… (cut)", so the whole URL stays under the limit; short fields stay whole', () => {
  const long = 'The board froze while drawing. '.repeat(400)
  const url = issueUrl({ kind: 'bug', title: 'Freeze', text: long, fields: { expected: 'It draws.', steps: 'Open a board.' }, version: '0.28.0' })
  assert.ok(url.length <= MAX_ISSUE_URL, `${url.length}`)
  assert.ok(url.length > MAX_ISSUE_URL - 40, 'it cuts only what it has to')
  const p = q(url)
  assert.ok(p.get('what-happened')!.endsWith('… (cut)'))
  assert.ok(long.startsWith(p.get('what-happened')!.replace('… (cut)', '')))
  assert.equal(p.get('expected'), 'It draws.')
  assert.equal(p.get('version'), '0.28.0')
  // CJK takes nine characters per character once encoded: still within the limit, never half a character
  const cjk = issueUrl({ kind: 'idea', text: '框架太多時很難找到要的那一個。'.repeat(300), fields: { idea: '在 ⌘K 列出所有框架。'.repeat(200) }, max: 3000 })
  assert.ok(cjk.length <= 3000, `${cjk.length}`)
  assert.ok(q(cjk).get('problem')!.endsWith('… (cut)'))
  assert.ok(q(cjk).get('idea')!.endsWith('… (cut)'), 'the next longest is cut too when one is not enough')
})

test('titles: the first sentence, at most 80 characters; a given title is kept (up to 200)', () => {
  assert.equal(titleFrom('canvas_files should say who holds the file. Today it does not.'), 'canvas_files should say who holds the file')
  assert.equal(titleFrom('v0.28.0 breaks the rail\nmore'), 'v0.28.0 breaks the rail')
  assert.equal(titleFrom('找不到框架。下一句'), '找不到框架')
  assert.equal([...titleFrom('x'.repeat(300))].length, 80)
  assert.equal(titleFrom('canvas_files should say which agent holds each file, so I know whom to ask before proposing an edit'), 'canvas_files should say which agent holds each file, so I know whom to ask…', 'cut at a word')
  assert.equal(q(issueUrl({ kind: 'bug', title: `  ${'t'.repeat(250)}  `, text: 'x' })).get('title')!.length, 200)
})

test('the repository: UNPROSE_ISSUES_REPO, else UNPROSE_UPDATE_REPO, else river0825/unprose; nothing else gets in', () => {
  assert.equal(issuesRepo({}), DEFAULT_ISSUES_REPO)
  assert.equal(DEFAULT_ISSUES_REPO, 'river0825/unprose')
  assert.equal(issuesRepo({ UNPROSE_UPDATE_REPO: 'fork/unprose' }), 'fork/unprose')
  assert.equal(issuesRepo({ UNPROSE_UPDATE_REPO: 'fork/unprose', UNPROSE_ISSUES_REPO: 'team/feedback' }), 'team/feedback')
  assert.equal(issuesRepo({ UNPROSE_ISSUES_REPO: 'https://github.com/team/feedback.git' }), 'team/feedback')
  assert.equal(issuesRepo({ UNPROSE_ISSUES_REPO: 'evil.com/x?y=1' }), DEFAULT_ISSUES_REPO)
  assert.equal(repoName('a/b/c'), undefined)
  assert.ok(issueUrl({ kind: 'bug', text: 'x', repo: '../../elsewhere' }).startsWith(`https://github.com/${DEFAULT_ISSUES_REPO}/issues/new?`))
})

test('an agent\'s feedback as a draft: an idea unless it says bug, its tools — never item ids from the board', () => {
  assert.deepEqual(feedbackDraft({ text: 'canvas_files should name the holder. It would save a round trip.', about: ['canvas_files', 'shop-es.event.order', 'canvas_wait'] }), {
    kind: 'idea',
    title: 'canvas_files should name the holder',
    text: 'canvas_files should name the holder. It would save a round trip.\n\nTools: canvas_files, canvas_wait',
  })
  assert.deepEqual(feedbackDraft({ kind: 'bug', title: 'Wait drops', text: 'x', about: ['w1'] }), { kind: 'bug', title: 'Wait drops', text: 'x' })
})

// ── the issue forms ────────────────────────────────────────────────────────────

interface FormElement {
  type: string
  id?: string
  attributes?: { label?: string; value?: string; options?: string[] }
  validations?: { required?: boolean }
}

test('the issue forms are valid issue-form YAML and have every field id the link fills', () => {
  const ID = /^[A-Za-z0-9_-]+$/
  const TYPES = ['markdown', 'textarea', 'input', 'dropdown', 'checkboxes']
  for (const [kind, form] of Object.entries(ISSUE_FORMS)) {
    const doc = parse(fs.readFileSync(path.join(TEMPLATES, form.template), 'utf8')) as { name?: string; description?: string; labels?: string[]; body?: FormElement[] }
    for (const k of Object.keys(doc)) assert.ok(['name', 'description', 'body', 'assignees', 'labels', 'title', 'type', 'projects'].includes(k), `${form.template}: unknown key ${k}`)
    assert.ok(doc.name && doc.description && Array.isArray(doc.body) && doc.body.length, `${form.template}: name, description and body are required`)
    assert.deepEqual(doc.labels, [kind === 'bug' ? 'bug' : 'enhancement'])
    const ids = doc.body!.filter((e) => e.id).map((e) => e.id!)
    assert.equal(new Set(ids).size, ids.length, `${form.template}: ids are unique`)
    for (const e of doc.body!) {
      assert.ok(TYPES.includes(e.type), `${form.template}: type ${e.type}`)
      for (const k of Object.keys(e)) assert.ok(['type', 'id', 'attributes', 'validations'].includes(k), `${form.template}: element key ${k}`)
      if (e.type === 'markdown') {
        assert.equal(e.id, undefined, 'a markdown element has no id')
        assert.ok(e.attributes?.value)
        continue
      }
      assert.ok(e.id && ID.test(e.id), `${form.template}: every field has an id (the link fills fields by id)`)
      assert.ok(e.attributes?.label, `${form.template}: ${e.id} has a label`)
    }
    for (const id of form.fields) assert.ok(ids.includes(id), `${form.template} has no field "${id}"`)
    const main = doc.body!.find((e) => e.id === form.text)!
    assert.equal(main.type, 'textarea')
    assert.equal(main.validations?.required, true, 'the field the dialog fills is the required one')
    assert.match(doc.body![0].attributes?.value ?? '', /public/, 'the form says the issue is public')
  }
  const where = (parse(fs.readFileSync(path.join(TEMPLATES, ISSUE_FORMS.bug.template), 'utf8')) as { body: FormElement[] }).body.find((e) => e.id === 'where')!
  assert.equal(where.type, 'dropdown')
  assert.deepEqual(where.attributes?.options, [...ISSUE_WHERE])
  const config = parse(fs.readFileSync(path.join(TEMPLATES, 'config.yml'), 'utf8')) as { blank_issues_enabled: unknown; contact_links?: Array<{ name: string; url: string; about: string }> }
  assert.equal(typeof config.blank_issues_enabled, 'boolean')
  for (const l of config.contact_links ?? []) assert.ok(l.name && /^https:\/\//.test(l.url) && l.about)
})

// ── the server and the tools ───────────────────────────────────────────────────

const REMOTE = { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }
let srv: RunningServer
let base: string
let access: AccessService
const feedback = new MemoryFeedbackStore()

before(async () => {
  access = new AccessService({ store: new MemoryAccessStore() })
  srv = await startServer({ port: 0, store: createBoardRepository('memory'), webDist: '/nonexistent', access, feedback, issuesRepo: 'acme/tools' })
  base = `http://127.0.0.1:${srv.port}`
})
after(() => srv.close())

const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('GET /api/version says where issues go', async () => {
  const v = (await (await fetch(`${base}/api/version`)).json()) as { issuesRepo: string }
  assert.equal(v.issuesRepo, 'acme/tools')
})

test('POST /api/feedback keeps kind and title and answers with the prefilled issue — never the board', async () => {
  const b = (await (await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Secret plan', kind: 'freeform' }) })).json()) as { board: { id: string } }
  const r = await post({ text: 'canvas_wait came back at once.\nTwice.', kind: 'bug', title: 'canvas_wait returns early', board: b.board.id, about: ['canvas_wait', 'sticky-1'] })
  assert.equal(r.status, 201)
  const j = (await r.json()) as { id: string; issue: string }
  const rec = feedback.list().find((f) => f.id === j.id)!
  assert.equal(rec.kind, 'bug')
  assert.equal(rec.title, 'canvas_wait returns early')
  assert.ok(j.issue.startsWith('https://github.com/acme/tools/issues/new?template=bug_report.yml'))
  const p = q(j.issue)
  assert.equal(p.get('title'), 'canvas_wait returns early')
  assert.equal(p.get('what-happened'), 'canvas_wait came back at once.\nTwice.\n\nTools: canvas_wait')
  assert.equal(p.get('version'), VERSION)
  assert.ok(!j.issue.includes(b.board.id) && !j.issue.includes('sticky-1'), 'no board id, no item id')
  // without a kind: an idea, titled by its first sentence
  const idea = q(((await (await post({ text: 'A frame list would help. Big boards are hard.' })).json()) as { issue: string }).issue)
  assert.equal(idea.get('template'), 'feature_request.yml')
  assert.equal(idea.get('title'), 'A frame list would help')
  assert.equal((await post({ text: 'x', kind: 'question' })).status, 400)
  assert.equal((await post({ text: 'x', title: 't'.repeat(201) })).status, 400)
})

test('unprose_feedback takes kind and title and passes the link on — the agent does not file it', async () => {
  const tok = access.createToken({ name: 'codex-issue', scope: 'read' }, 't').token
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { ...REMOTE, authorization: `Bearer ${tok}` } } }))
  try {
    const tools = (await client.listTools()).tools
    const fb = tools.find((t) => t.name === 'unprose_feedback')!
    assert.ok(['kind', 'title'].every((k) => k in ((fb.inputSchema as { properties: object }).properties ?? {})))
    assert.match(fb.description ?? '', /Never file an issue yourself unless the person asks/)
    const sent = (await client.callTool({ name: 'unprose_feedback', arguments: { text: '找不到框架。', kind: 'idea', title: '框架清單' } })) as { content: Array<{ text: string }> }
    const out = sent.content[0].text
    assert.match(out, /recorded as fb_/)
    assert.match(out, /prefilled issue.*public.*https:\/\/github\.com\/acme\/tools\/issues\/new\?template=feature_request\.yml/)
    assert.match(out, /Do not file it yourself unless they ask you to/)
    assert.equal(q(out.match(/https:\/\/\S+/)![0]).get('title'), '框架清單')
    assert.equal(feedback.list().at(-1)!.by, 'codex-issue')
  } finally {
    await client.close()
  }
})
