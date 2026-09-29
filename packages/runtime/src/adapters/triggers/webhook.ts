// One HTTP server for every `webhook` trigger in a workflow, plus a few
// read-only endpoints so a dashboard (or the canvas) can watch the runs.

import http from 'node:http'
import { URL } from 'node:url'
import { evalCondition, templateDeep, toGraph, type WorkflowDefinition, type TriggerDef } from '@awd/core'
import type { EventStore } from '../../ports/eventStore.js'
import { keyFor } from '../../application/keys.js'
import type { Engine } from '../../application/engine.js'

export interface WebhookServerOptions {
  def: WorkflowDefinition
  store: EventStore
  engine?: Engine
  env?: Record<string, string>
  port?: number
  host?: string
  log?: (line: string) => void
}

export interface TriggerResult { accepted: boolean; event?: { id: string; type: string; key: string }; reason?: string }

/** Turn a raw webhook payload into a domain event (or drop it). Pure except for the append. */
export function fireWebhook(t: TriggerDef, def: WorkflowDefinition, store: EventStore, raw: { body: unknown; query: Record<string, string>; headers: Record<string, string> }, env: Record<string, string> = {}): TriggerResult {
  const now = new Date().toISOString()
  const scope = { ...raw, env, now }
  if (!evalCondition(t.if, scope)) return { accepted: false, reason: `trigger "${t.id}" condition did not match` }
  const data = t.data === undefined ? raw.body : templateDeep(t.data, scope)
  const draft = { id: '', type: t.emit, data, ts: now }
  let key: string
  try { key = keyFor(def, { ...draft, id: 'pending' }, env) } catch (e) { return { accepted: false, reason: (e as Error).message } }
  const ev = store.append({ type: t.emit, key, data, meta: { trigger: t.id } })
  return { accepted: true, event: { id: ev.id, type: ev.type, key: ev.key } }
}

export function createWebhookServer(opts: WebhookServerOptions): http.Server {
  const { def, store } = opts
  const byPath = new Map<string, TriggerDef>()
  for (const t of def.triggers) if (t.on === 'webhook' && t.path) byPath.set(t.path, t)

  const streams = new Set<http.ServerResponse>()
  const sse = (res: http.ServerResponse, event: string, data: unknown) => {
    if (res.writableEnded) return streams.delete(res)
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  // Every appended event goes to every open /api/stream, followed by the run's
  // fresh state. The engine subscribed to the store before this server started,
  // and its reduce is synchronous, so the state is already current here.
  const unsub = store.subscribe((ev) => {
    if (!streams.size) return
    const state = opts.engine?.states.get(ev.key)
    for (const r of streams) {
      sse(r, 'event', ev)
      if (state) sse(r, 'state', { key: ev.key, state })
    }
  })
  const keepalive = setInterval(() => { for (const r of streams) sse(r, 'ping', { at: Date.now() }) }, 15_000)
  keepalive.unref?.()

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json', ...cors })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    try {
      const t = byPath.get(url.pathname)
      if (t) {
        const body = await readBody(req)
        const query = Object.fromEntries(url.searchParams.entries())
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')]))
        const r = fireWebhook(t, def, store, { body, query, headers }, opts.env)
        opts.log?.(r.accepted ? `webhook ${t.id} → ${r.event!.type} [${r.event!.key}]` : `webhook ${t.id} dropped: ${r.reason}`)
        return send(r.accepted ? 202 : 200, r)
      }
      if (url.pathname === '/api/status') {
        const runs = opts.engine ? [...opts.engine.states.values()] : []
        return send(200, { workflow: def.name, runs, timers: opts.engine?.timer.list() ?? [], events: store.size() })
      }
      if (url.pathname === '/api/events') {
        const since = Number(url.searchParams.get('since') ?? 0)
        return send(200, store.read({ since, key: url.searchParams.get('key') ?? undefined }))
      }
      if (url.pathname === '/api/graph') return send(200, toGraph(def))
      if (url.pathname === '/api/stream') {
        // Server-Sent Events: snapshot first, then every event + the run state it produced.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...cors })
        res.write(': awd stream\n\n')
        streams.add(res)
        const all = store.all()
        sse(res, 'snapshot', { workflow: def.name, runs: opts.engine ? [...opts.engine.states.values()] : [], events: all.slice(-200), total: all.length })
        req.on('close', () => streams.delete(res))
        return
      }
      const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname)
      if (runMatch) {
        const key = decodeURIComponent(runMatch[1])
        const state = opts.engine?.states.get(key)
        if (!state) return send(404, { error: `no run ${key}` })
        return send(200, { key, state, events: store.read({ key }) })
      }
      if (url.pathname === '/' || url.pathname === '/api') {
        return send(200, { workflow: def.name, webhooks: [...byPath.keys()], endpoints: ['/api/status', '/api/events?since=0', '/api/graph', '/api/stream', '/api/runs/:key'] })
      }
      send(404, { error: 'not found' })
    } catch (e) {
      send(500, { error: (e as Error).message })
    }
  })
  server.on('close', () => {
    unsub()
    clearInterval(keepalive)
    for (const r of streams) r.end()
    streams.clear()
  })
  return server
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  const ct = String(req.headers['content-type'] ?? '')
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text).entries())
  try { return JSON.parse(text) } catch { return { raw: text } }
}
