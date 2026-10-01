import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canvasOrigin, probeCanvas } from '../src/client.js'
import { startServer } from '../src/server.js'
import { MemoryBoardRepository } from '../src/adapters/boards/index.js'

test('the canvas origin comes from a plain URL or a pasted board link (unprose#5)', () => {
  assert.equal(canvasOrigin('http://localhost:4400'), 'http://localhost:4400')
  assert.equal(canvasOrigin('https://canvas.example.com/'), 'https://canvas.example.com')
  assert.equal(canvasOrigin('https://canvas.example.com/b/b_abc123?focus=x'), 'https://canvas.example.com')
  assert.equal(canvasOrigin('https://example.com/tools/canvas/b/b_1'), 'https://example.com/tools/canvas', 'a proxy path prefix is kept')
  assert.equal(canvasOrigin('http://localhost:4400/api/boards'), 'http://localhost:4400')
  assert.throws(() => canvasOrigin('not a url'))
})

test('probeCanvas: a running canvas answers, a closed port gives the reason', async () => {
  const srv = await startServer({ port: 0, store: new MemoryBoardRepository() })
  try {
    assert.deepEqual(await probeCanvas(srv.url), { ok: true })
  } finally {
    await srv.close()
  }
  const down = await probeCanvas('http://127.0.0.1:9', 2000)
  assert.equal(down.ok, false)
  assert.ok(!down.ok && down.reason.length > 0)
})

test('`awd-canvas mcp` with an unreachable canvas exits non-zero and says what to set', () => {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js')
  const r = spawnSync(process.execPath, [cli, 'mcp'], { env: { ...process.env, AWD_CANVAS_URL: 'http://127.0.0.1:9/b/b_x' }, input: '', encoding: 'utf8', timeout: 15000 })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /unprose MCP: cannot reach http:\/\/127\.0\.0\.1:9 \(/)
  assert.match(r.stderr, /set AWD_CANVAS_URL/)
})
