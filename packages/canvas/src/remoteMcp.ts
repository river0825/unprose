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
}

export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, grant: Grant, ctx: RemoteMcpContext, body: unknown): Promise<void> {
  if (req.method !== 'POST') {
    // stateless: no standalone SSE stream to resume, no session to delete
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this endpoint is stateless, use POST' }, id: null }))
    return
  }
  const { secret, release } = ctx.access.mintInternal(grant)
  const client = new CanvasClient(ctx.loopback, { token: secret, publicUrl: ctx.publicUrl })
  const server = createMcpServer(client, {
    openBrowser: false,
    remote: true,
    extend: (s, c) => registerContentDesignTools(s, c.client, { prompts: true }),
  })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    release()
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
