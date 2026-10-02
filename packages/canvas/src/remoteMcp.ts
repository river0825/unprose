// The canvas's own MCP endpoint, `/mcp` (Streamable HTTP, docs/canvas.md "Remote agents"): what cloud agents
// (claude.ai connectors, ChatGPT, cloud Codex / Claude Code) and agents on other machines connect to. Each
// request gets a fresh MCP server (stateless mode — nothing to lose on a restart) over the same tools as the
// stdio server, with a client that calls this server's API *as the caller*: the caller's grant travels as a
// short-lived internal secret, so scopes, attribution and presence apply exactly as for the HTTP API.
import type http from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AccessService } from './access.js'
import type { Grant } from './accessPolicy.js'
import { CanvasClient } from './client.js'
import { registerContentDesignTools } from './designTools.js'
import { createMcpServer } from './mcp.js'

export interface RemoteMcpContext {
  access: AccessService
  /** This server's own address on loopback (the in-process client calls it). */
  loopback: string
  /** The address people open (board links). */
  publicUrl: string
  /**
   * Requests in flight, by caller × JSON-RPC id: a stateless server cannot route `notifications/cancelled` (it comes
   * in its own POST), so the endpoint looks the request up here and closes it — a cancelled canvas_wait then ends
   * at once and frees its watcher slot instead of blocking until its timeout.
   */
  inflight?: Map<string, Set<() => void>>
}

type RpcMessage = { method?: unknown; id?: unknown; params?: { requestId?: unknown } }
const messages = (body: unknown): RpcMessage[] => (Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []) as RpcMessage[]
const callerKey = (grant: Grant, id: unknown) => `${grant.agentId ?? grant.name}\u0000${String(id)}`

export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, grant: Grant, ctx: RemoteMcpContext, body: unknown): Promise<void> {
  if (req.method !== 'POST') {
    // stateless: no standalone SSE stream to resume, no session to delete
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this endpoint is stateless, use POST' }, id: null }))
    return
  }
  const inflight = ctx.inflight
  const msgs = messages(body)
  if (inflight) {
    for (const m of msgs) {
      if (m.method !== 'notifications/cancelled' || m.params?.requestId === undefined) continue
      const set = inflight.get(callerKey(grant, m.params.requestId))
      // only when it is unambiguous (two conversations of one agent may reuse an id)
      if (set?.size === 1) for (const stop of set) stop()
    }
  }
  const { secret, release } = ctx.access.mintInternal(grant)
  const client = new CanvasClient(ctx.loopback, { token: secret, publicUrl: ctx.publicUrl })
  const server = createMcpServer(client, {
    openBrowser: false,
    remote: true,
    extend: (s, c) => registerContentDesignTools(s, c.client, { prompts: true }),
  })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const stop = () => {
    void transport.close()
    void server.close()
  }
  const keys = inflight ? msgs.filter((m) => typeof m.method === 'string' && m.id !== undefined && m.id !== null).map((m) => callerKey(grant, m.id)) : []
  for (const k of keys) {
    const set = inflight!.get(k) ?? new Set()
    set.add(stop)
    inflight!.set(k, set)
  }
  res.on('close', () => {
    for (const k of keys) {
      const set = inflight!.get(k)
      set?.delete(stop)
      if (set && !set.size) inflight!.delete(k)
    }
    release()
    stop()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
