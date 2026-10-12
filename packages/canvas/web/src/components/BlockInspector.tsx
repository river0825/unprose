// Inspector for one workflow block (docs/studio.md §4): what it is, in words a
// person can read. Its texts (persona, prompt, script, yaml) take line comments
// (§5); talking about the whole block happens in the Chat tab (§2b).
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import type { Author, Board, Item } from '../../../src/model'
import { anchoredOn, filesOf, yamlRange, type Anchor, type TextSource } from '../inspector/anchor'
import { chatsFor } from '../inspector/chat'
import { KIND_LABEL, agentItem, stepItem, type BlockDetail } from '../inspector/detail'
import { Markdown } from '../inspector/Markdown'
import { isBusy, signFor } from '../inspector/status'
import { timeAgo } from '../time'
import { TextView } from './TextView'
import '../inspector.css'

// the large view with Edit mode (docs/studio.md §9), loaded the first time a script is opened
const SourceDialog = lazy(() => import('./SourceDialog'))
import { Links } from './Links'
import { PanelLink } from '../inspector/panelNav'
import { consumersOf, parseListen, producersOf, wireFor } from '../inspector/wiring'
import type { DiscussArg } from '../inspector/diff'

/** Open the Files tab at this file (and line, or line range). */
export type OpenFile = (path: string, at?: { line?: number; range?: { start: number; end: number } }) => void

interface Props {
  board: Board
  item: Item
  detail: BlockDetail
  onSelect: (id: string) => void
  /** switch the panel to the Chat tab (about this block) */
  onOpenChat: () => void
  onToast: (text: string) => void
  onOpenFile: OpenFile
  onAnchoredComment: (target: string, text: string, anchor: Anchor, discuss?: DiscussArg) => void
  onReply: (rootId: string, text: string) => void
  /** "open the source" from the script block on the canvas (a new \`n\` each time) */
  sourceRequest?: { mode: 'view' | 'edit'; n: number }
  /** its annotations and TODOs (components/ItemMarks.tsx) */
  marks?: ReactNode
}

/** What every commentable text in the Inspector needs. */
interface TextCtx {
  board: Board
  item: Item
  files: Record<string, string>
  onOpenFile: OpenFile
  onAnchoredComment: Props['onAnchoredComment']
  onReply: Props['onReply']
}

const who = (a: Author) => (a === 'agent' ? 'Agent' : 'You')

export function BlockInspector({ board, item, detail, onSelect, onOpenChat, onToast, onOpenFile, onAnchoredComment, onReply, sourceRequest, marks }: Props) {
  const files = filesOf(board)
  const ctx: TextCtx = { board, item, files, onOpenFile, onAnchoredComment, onReply }
  const range = yamlRange(item)
  const config = (item.data?.config ?? {}) as Record<string, unknown>
  const title = blockTitle(item, detail)
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => onToast(`${what} copied`))
      .catch(() => onToast(`Copy this: ${text}`))
  const where = detail.source ? `${detail.source.workflow}${detail.source.line ? `:${detail.source.line}` : ''}` : undefined

  return (
    <div className="inspector">
      <header className="insp-head">
        <span className={`insp-kind k-${detail.kind}`}>{KIND_LABEL[detail.kind]}</span>
        <h2 className="insp-title">{title}</h2>
        {where && (
          <span className="insp-where">
            {detail.source && files[detail.source.workflow] !== undefined ? (
              <button type="button" className="insp-source mono" title="Open in Files" onClick={() => onOpenFile(detail.source!.workflow, { line: detail.source!.line, range })}>
                {where}
              </button>
            ) : (
              <span className="insp-source mono">{where}</span>
            )}
            <button type="button" className="link small" onClick={() => copy(where, 'Location')}>
              copy
            </button>
          </span>
        )}
        {typeof config.description === 'string' && <p className="insp-desc">{config.description}</p>}
        {detail.kind === 'agent' && typeof detail.frontmatter?.description === 'string' && <p className="insp-desc">{detail.frontmatter.description}</p>}
      </header>

      <KindBody board={board} item={item} detail={detail} config={config} onSelect={onSelect} ctx={ctx} sourceRequest={sourceRequest} />

      {range && detail.source && files[detail.source.workflow] !== undefined && (
        <Section title="Definition" note={`${detail.source.workflow}:${range.start}–${range.end}`}>
          <Commentable ctx={ctx} text={files[detail.source.workflow]} src={{ file: detail.source.workflow }} range={range} summary="View yaml" />
        </Section>
      )}

      <Links
        board={board}
        item={item}
        onSelect={onSelect}
        wiring={
          detail.listens?.length || detail.emits?.length ? (
            <dl className="kv">
              {detail.listens?.length ? (
                <>
                  <dt>Listens to</dt>
                  <dd>
                    <ul className="wire-list">
                      {detail.listens.map((l) => (
                        <ListenRow key={l} board={board} self={item.id} line={l} onSelect={onSelect} />
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
              {detail.emits?.length ? (
                <>
                  <dt>Emits</dt>
                  <dd>
                    <ul className="wire-list">
                      {detail.emits.map((e) => (
                        <EmitRow key={e} board={board} self={item.id} event={e} onSelect={onSelect} />
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
            </dl>
          ) : undefined
        }
      />

      {marks}

      <ChatLink board={board} item={item} onOpenChat={onOpenChat} />

      <details className="insp-item">
        <summary>Item on the board</summary>
        <dl className="kv">
          <dt>Id</dt>
          <dd className="mono">{item.id}</dd>
          <dt>Position</dt>
          <dd className="mono">
            {Math.round(item.x)}, {Math.round(item.y)} ({Math.round(item.w)} by {Math.round(item.h)})
          </dd>
          <dt>Drawn</dt>
          <dd>
            {who(item.updatedBy)}, {timeAgo(item.updatedAt)}
          </dd>
        </dl>
      </details>
    </div>
  )
}

function blockTitle(item: Item, d: BlockDetail): string {
  if (d.kind === 'agent') return `@${String(item.data?.agent ?? item.text?.split('\n')[0] ?? item.id).replace(/^@/, '')}`
  return String(item.data?.nodeId ?? item.text?.split('\n')[0] ?? item.id)
}

// ---------------------------------------------------------------- per kind

function KindBody({ board, item, detail: d, config, onSelect, ctx, sourceRequest }: { board: Board; item: Item; detail: BlockDetail; config: Record<string, unknown>; onSelect: (id: string) => void; ctx: TextCtx; sourceRequest?: Props['sourceRequest'] }) {
  const retry = config.retry as { max?: number; backoff?: string | number } | undefined
  const timeout = typeof config.timeout === 'string' ? config.timeout : undefined
  const limits = (retry || timeout) && (
    <Section title="Limits">
      <dl className="kv">
        {timeout && (
          <>
            <dt>Timeout</dt>
            <dd>{timeout}</dd>
          </>
        )}
        {retry && (
          <>
            <dt>Retry</dt>
            <dd>
              up to {retry.max ?? '?'} time{retry.max === 1 ? '' : 's'}
              {retry.backoff ? `, ${duration(retry.backoff)} apart` : ''}
            </dd>
          </>
        )}
      </dl>
    </Section>
  )
  const link = (label: string, target: Item | undefined) =>
    target ? (
      <button type="button" className="link" data-item-link={target.id} onClick={() => onSelect(target.id)}>
        {label}
      </button>
    ) : (
      <span>{label}</span>
    )

  switch (d.kind) {
    case 'agent': {
      const fm = d.frontmatter ?? {}
      const data = item.data ?? {}
      const tools = (fm.tools ?? data.tools) as unknown
      const delegates = (fm.delegates ?? data.delegates) as unknown
      const steps = d.steps ?? (data.steps as string[] | undefined) ?? []
      const known = new Set(['description', 'model', 'effort', 'runner', 'tools', 'memory', 'delegates'])
      const other = Object.entries(fm).filter(([k]) => !known.has(k))
      return (
        <>
          <Section title="Persona" note={d.file} onNote={d.file && ctx.files[d.file] !== undefined ? () => ctx.onOpenFile(d.file!) : undefined}>
            <Persona ctx={ctx} persona={d.persona} file={d.file} />
          </Section>
          <Section title="How it runs">
            <dl className="kv">
              <dt>Model</dt>
              <dd>{str(fm.model ?? data.model) ?? 'default'}</dd>
              {fm.effort !== undefined || data.effort !== undefined ? (
                <>
                  <dt>Effort</dt>
                  <dd>{str(fm.effort ?? data.effort)}</dd>
                </>
              ) : null}
              <dt>Runner</dt>
              <dd>{str(fm.runner ?? data.runner) ?? 'claude-code'}</dd>
              <dt>Tools</dt>
              <dd>{Array.isArray(tools) && tools.length ? <Chips items={tools.map(String)} /> : <span className="muted">none listed</span>}</dd>
              {fm.memory !== undefined && (
                <>
                  <dt>Memory</dt>
                  <dd>
                    <Value v={fm.memory} />
                  </dd>
                </>
              )}
              {Array.isArray(delegates) && delegates.length > 0 && (
                <>
                  <dt>Delegates to</dt>
                  <dd className="insp-links">
                    {delegates.map((a) => (
                      <span key={String(a)}>{link(`@${a}`, agentItem(board, String(a)))}</span>
                    ))}
                  </dd>
                </>
              )}
              {other.map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
            </dl>
          </Section>
          <Section title="Runs these steps">
            {steps.length ? (
              <ul className="insp-steps">
                {steps.map((s) => (
                  <li key={s}>{link(s, stepItem(board, s))}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No step uses this agent.</p>
            )}
          </Section>
        </>
      )
    }
    case 'ai': {
      const agent = d.agent ?? (config.agent as string | undefined)
      const outcomes = d.outcomes ?? (config.outcomes as string[] | undefined) ?? []
      const input = d.input ?? (config.input as Record<string, unknown> | undefined) ?? {}
      const output = d.output ?? (config.output as Record<string, unknown> | undefined)
      return (
        <>
          <Section title="Who">
            <dl className="kv">
              <dt>Agent</dt>
              <dd>{agent ? link(`@${agent}`, agentItem(board, agent)) : d.role ? `role ${d.role}` : <span className="muted">none</span>}</dd>
              <dt>Model</dt>
              <dd>{d.model ?? str(config.model) ?? 'agent default'}</dd>
              {d.file && (
                <>
                  <dt>Prompt file</dt>
                  <dd className="mono">
                    <FileLink ctx={ctx} path={d.file} />
                  </dd>
                </>
              )}
            </dl>
          </Section>
          <Section title="Prompt">
            {d.prompt ? (
              <Commentable ctx={ctx} text={d.prompt} src={{ doc: 'prompt', block: item.id }} summary="System prompt, before {{ }} is filled in" />
            ) : (
              <p className="muted">No prompt recorded.</p>
            )}
          </Section>
          <Section title="Input">
            {Object.keys(input).length ? (
              <dl className="kv">
                {Object.entries(input).map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </dl>
            ) : (
              <p className="muted">No input mapping.</p>
            )}
          </Section>
          <Section title="Output">
            <p className="insp-lead">Ends as {outcomes.length ? <Chips items={outcomes} inline /> : <span className="muted">done</span>}</p>
            {output && <SchemaSummary schema={output} />}
            {output && <Code text={JSON.stringify(output, null, 2)} summary="Output schema (JSON)" />}
          </Section>
          {limits}
        </>
      )
    }
    case 'gate':
    case 'human': {
      const rules = d.rules ?? []
      return (
        <>
          <Section title="When does it go on?">
            {d.plain?.length ? (
              <ul className="insp-plain">
                {d.plain.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No rules written out.</p>
            )}
          </Section>
          {rules.length > 0 && (
            <Section title="Rules">
              <div className="insp-table-wrap">
                <table className="insp-table">
                  <thead>
                    <tr>
                      <th scope="col">Outcome</th>
                      <th scope="col">When</th>
                      <th scope="col">Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.outcome}</td>
                        <td className="mono">{r.when}</td>
                        <td>{r.terminal ? 'stops' : 'goes on'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          {(d.timeout || d.resumeOn?.length) && (
            <Section title="Waiting">
              <dl className="kv">
                {d.resumeOn?.length ? (
                  <>
                    <dt>Resumes on</dt>
                    <dd>
                      <Chips items={d.resumeOn} />
                    </dd>
                  </>
                ) : null}
                {d.timeout && (
                  <>
                    <dt>Gives up after</dt>
                    <dd>{d.timeout}</dd>
                  </>
                )}
              </dl>
            </Section>
          )}
        </>
      )
    }
    case 'script': {
      // what View / Edit open: the script file, else (an inline command) the step's lines in the workflow yaml
      const fileText = d.file ? (ctx.files[d.file] ?? (d.truncated ? undefined : d.code)) : undefined
      const yamlFile = d.source?.workflow
      const yamlText = yamlFile ? ctx.files[yamlFile] : undefined
      const target: ScriptTarget | undefined =
        d.file && fileText !== undefined
          ? { text: fileText, file: d.file }
          : !d.file && yamlFile && yamlText !== undefined
            ? { text: yamlText, file: yamlFile, line: yamlRange(item)?.start ?? d.source?.line }
            : undefined
      return (
        <>
          <Section title="Command" actions={!d.file && target ? <ScriptActions ctx={ctx} target={target} request={sourceRequest} what="the command (its lines in the workflow yaml)" /> : undefined}>
            <pre className="insp-cmd mono">{d.run ?? str(config.run) ?? ''}</pre>
          </Section>
          <Section
            title="Source"
            note={d.file}
            onNote={d.file && ctx.files[d.file] !== undefined ? () => ctx.onOpenFile(d.file!) : undefined}
            actions={d.file && target ? <ScriptActions ctx={ctx} target={target} request={sourceRequest} what={d.file} /> : undefined}
          >
            {d.file && (ctx.files[d.file] ?? d.code) !== undefined ? (
              <>
                <Commentable ctx={ctx} text={ctx.files[d.file] ?? d.code!} src={{ file: d.file }} summary="Show source" />
                {d.truncated && ctx.files[d.file] === undefined && <p className="muted">Cut at 20 000 characters — open the file for the rest.</p>}
              </>
            ) : d.code ? (
              <Code text={d.code} summary="Script source" open />
            ) : (
              <p className="muted">{d.file ? 'The file could not be read.' : 'The command does not name a file in the repo — Edit above changes the command in the workflow yaml.'}</p>
            )}
          </Section>
          {limits}
        </>
      )
    }
    case 'trigger':
      return (
        <Section title="Starts a run">
          <dl className="kv">
            <dt>On</dt>
            <dd>{d.on ?? str(config.on)}</dd>
            <dt>Emits</dt>
            <dd className="mono">{d.emit ?? str(config.emit)}</dd>
            {Object.entries(d.config ?? {})
              .filter(([k]) => k !== 'on' && k !== 'emit')
              .map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
          </dl>
        </Section>
      )
  }
}

// ---------------------------------------------------------------- chat

/** One way in to the conversation: the Chat tab, which also covers multi-selections. */
function ChatLink({ board, item, onOpenChat }: { board: Board; item: Item; onOpenChat: () => void }) {
  const chats = chatsFor(board, [item.id])
  const latest = chats[0]
  const busy = chats.filter((c) => isBusy(signFor(c.root, c.messages))).length
  return (
    <section className="insp-chatlink" aria-label="Chat about this block">
      <button type="button" className="primary small" onClick={onOpenChat}>
        Chat about this block
      </button>
      <span className="muted">
        {chats.length ? `${chats.length} chat${chats.length === 1 ? '' : 's'}, latest ${timeAgo(latest.lastAt)}` : 'No chats yet'}
      </span>
      {busy > 0 && (
        <span className="agent-status s-working compact" aria-live="polite">
          agent working on {busy}
          <span className="dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- bits

function Section({ title, note, onNote, actions, children }: { title: string; note?: string; onNote?: () => void; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="insp-sec">
      {actions && <div className="insp-sec-actions">{actions}</div>}
      <h3>
        {title}
        {note &&
          (onNote ? (
            <button type="button" className="link insp-note mono" title="Open in Files" onClick={onNote}>
              {note}
            </button>
          ) : (
            <span className="insp-note mono">{note}</span>
          ))}
      </h3>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- script source

interface ScriptTarget {
  text: string
  file: string
  /** where to put the cursor (an inline command's line in the workflow yaml) */
  line?: number
}

/**
 * View / Edit for a script: the large view with syntax highlighting and line comments; Edit turns the
 * draft into a request to the AI, which reviews it with the person and then writes the file (§9).
 * A request from the canvas (the block's ‹/› button or a double-click) opens it too.
 */
function ScriptActions({ ctx, target, request, what }: { ctx: TextCtx; target: ScriptTarget; request?: { mode: 'view' | 'edit'; n: number }; what: string }) {
  const [open, setOpen] = useState<'view' | 'edit' | null>(null)
  useEffect(() => {
    if (request) setOpen(request.mode)
  }, [request?.n])
  return (
    <>
      <button type="button" className="small" onClick={() => setOpen('view')} aria-haspopup="dialog" title={`View ${what} with syntax highlighting and line comments`}>
        View
      </button>
      <button type="button" className="small" onClick={() => setOpen('edit')} aria-haspopup="dialog" title={`Edit ${what}; the AI reviews your edit with you before the file changes`}>
        Edit
      </button>
      {open && (
        <Suspense fallback={null}>
          <SourceDialog
            board={ctx.board}
            text={target.text}
            src={{ file: target.file }}
            label={target.file}
            targetFor={() => ctx.item.id}
            onAnchoredComment={ctx.onAnchoredComment}
            onReply={ctx.onReply}
            onClose={() => setOpen(null)}
            focusLine={target.line}
            startInEdit={open === 'edit'}
          />
        </Suspense>
      )}
    </>
  )
}

// ---------------------------------------------------------------- commentable text

/** A text with line comments, folded behind a summary that counts its lines and comments. */
function Commentable({ ctx, text, src, summary, range }: { ctx: TextCtx; text: string; src: TextSource; summary: string; range?: { start: number; end: number } }) {
  const comments = anchoredOn(ctx.board, src).length
  const lines = range ? range.end - range.start + 1 : text.split('\n').length
  return (
    <details className="insp-code" open={comments > 0 || (!range && lines <= 40)}>
      <summary>
        {summary}{' '}
        <span className="muted">
          ({lines} line{lines === 1 ? '' : 's'}
          {comments ? `, ${comments} comment${comments === 1 ? '' : 's'}` : ''})
        </span>
      </summary>
      <TextView
        board={ctx.board}
        text={text}
        src={src}
        label={'file' in src ? src.file : 'Prompt'}
        range={range}
        targetFor={() => ctx.item.id}
        onAnchoredComment={ctx.onAnchoredComment}
        onReply={ctx.onReply}
      />
      {'file' in src && ctx.files[src.file] !== undefined && (
        <button type="button" className="link small" onClick={() => ctx.onOpenFile(src.file, range ? { range } : undefined)}>
          Open {src.file.split('/').pop()} in Files
        </button>
      )}
    </details>
  )
}

/** The agent's persona: easy to read (rendered), or its file with line numbers to comment on. */
function Persona({ ctx, persona, file }: { ctx: TextCtx; persona?: string; file?: string }) {
  const source = file ? ctx.files[file] : undefined
  const comments = file ? anchoredOn(ctx.board, { file }).length : 0
  const [view, setView] = useState<'read' | 'source'>(comments ? 'source' : 'read')
  if (!persona?.trim() && source === undefined) return <p className="muted">No persona text in the agent file.</p>
  return (
    <>
      {source !== undefined && file && (
        <div className="insp-toggle" role="group" aria-label="Show the persona as">
          <button type="button" className="small" aria-pressed={view === 'read'} onClick={() => setView('read')}>
            Read
          </button>
          <button type="button" className="small" aria-pressed={view === 'source'} onClick={() => setView('source')}>
            Source & comments{comments ? ` (${comments})` : ''}
          </button>
        </div>
      )}
      {view === 'source' && source !== undefined && file ? (
        <TextView board={ctx.board} text={source} src={{ file }} label={file} targetFor={() => ctx.item.id} onAnchoredComment={ctx.onAnchoredComment} onReply={ctx.onReply} />
      ) : persona?.trim() ? (
        <Markdown text={persona} />
      ) : (
        <p className="muted">No persona text in the agent file.</p>
      )}
      {source === undefined && file && <p className="muted insp-hint">Redraw the board (awd graph --canvas) to comment on this file by line.</p>}
    </>
  )
}

function FileLink({ ctx, path }: { ctx: TextCtx; path: string }) {
  return ctx.files[path] !== undefined ? (
    <button type="button" className="link mono" onClick={() => ctx.onOpenFile(path)}>
      {path}
    </button>
  ) : (
    <>{path}</>
  )
}

function Code({ text, summary, open }: { text: string; summary: string; open?: boolean }) {
  const lines = text.split('\n').length
  return (
    <details className="insp-code" open={open && lines <= 40}>
      <summary>
        {summary} <span className="muted">({lines} line{lines === 1 ? '' : 's'})</span>
      </summary>
      <pre className="mono">
        <code>{text}</code>
      </pre>
    </details>
  )
}

/** Top-level fields of an object schema, one line each: `plan · string — numbered steps…`. */
function SchemaSummary({ schema }: { schema: Record<string, unknown> }) {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!props) return null
  const required = new Set((schema.required as string[] | undefined) ?? [])
  return (
    <ul className="insp-fields">
      {Object.entries(props).map(([k, p]) => {
        const type = Array.isArray(p.enum) ? p.enum.map(String).join(' | ') : str(p.type) ?? 'any'
        return (
          <li key={k}>
            <span className="mono">{k}</span>
            {required.has(k) ? '' : <span className="muted"> (optional)</span>} <span className="muted">· {type}</span>
            {typeof p.description === 'string' && <div className="muted">{p.description}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function Chips({ items, inline }: { items: string[]; inline?: boolean }) {
  return (
    <span className={`insp-chips${inline ? ' inline' : ''}`}>
      {items.map((t) => (
        <span key={t} className="insp-chip mono">
          {t}
        </span>
      ))}
    </span>
  )
}

const blockName = (it: Item) => it.text?.split('\n')[0].trim() || it.id

function BlockLink({ it, onSelect, note }: { it: Item; onSelect: (id: string) => void; note?: string }) {
  return (
    <PanelLink id={it.id} name={blockName(it)} className="wire-block" onSelect={onSelect}>
      {blockName(it)}
      {note ? <span className="wire-note">{note}</span> : null}
    </PanelLink>
  )
}

/** An event name; when a wire is drawn for it, a button that selects that wire (it comes to the front). */
function EventChip({ event, wire, onSelect }: { event: string; wire: Item | undefined; onSelect: (id: string) => void }) {
  if (!wire) return <span className="insp-chip mono">{event}</span>
  return (
    <PanelLink id={wire.id} name={`the wire ${event}`} className="insp-chip mono wire-chip" onSelect={onSelect}>
      {event}
    </PanelLink>
  )
}

/** One listened event, and the block(s) it comes from. */
function ListenRow({ board, self, line, onSelect }: { board: Board; self: string; line: string; onSelect: (id: string) => void }) {
  const { event, condition } = parseListen(line)
  const from = producersOf(board, event, self)
  const wire = wireFor(board, event, from[0], board.items[self])
  return (
    <li>
      <EventChip event={event} wire={wire} onSelect={onSelect} />
      {condition ? <span className="wire-if mono">if {condition}</span> : null}
      <span className="wire-dir">
        <span aria-hidden="true">←</span> <span className="sr">comes from</span>
        {from.length ? from.map((it) => <BlockLink key={it.id} it={it} onSelect={onSelect} />) : <span className="muted">{event.startsWith('*.') ? 'any step' : 'nothing on this board emits it'}</span>}
      </span>
    </li>
  )
}

/** One emitted event, and the block(s) that run on it. */
function EmitRow({ board, self, event, onSelect }: { board: Board; self: string; event: string; onSelect: (id: string) => void }) {
  const to = consumersOf(board, event, self)
  const wire = wireFor(board, event, board.items[self], to[0]?.item)
  return (
    <li>
      <EventChip event={event} wire={wire} onSelect={onSelect} />
      <span className="wire-dir">
        <span aria-hidden="true">→</span> <span className="sr">goes to</span>
        {to.length ? (
          to.map(({ item: it, condition, resume }, i) => <BlockLink key={`${it.id}-${i}`} it={it} onSelect={onSelect} note={resume ? 'resumes' : condition ? `if ${condition}` : undefined} />)
        ) : (
          <span className="muted">no one listens</span>
        )}
      </span>
    </li>
  )
}


function Row({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>
        <Value v={v} />
      </dd>
    </>
  )
}

function Value({ v }: { v: unknown }) {
  if (typeof v === 'string') return <span className={v.includes('{{') ? 'mono' : undefined}>{v}</span>
  if (typeof v === 'number' || typeof v === 'boolean') return <span className="mono">{String(v)}</span>
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return <Chips items={v as string[]} />
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x !== 'object'))
    return (
      <span className="insp-pairs">
        {Object.entries(v).map(([k, x]) => (
          <span key={k}>
            <span className="muted">{k}</span> <span className="mono">{String(x)}</span>
          </span>
        ))}
      </span>
    )
  return <span className="mono">{JSON.stringify(v)}</span>
}

/** A duration as the yaml would say it: 10000 → 10s, '7d' stays. */
function duration(v: string | number): string {
  if (typeof v === 'string') return v
  const units: Array<[string, number]> = [['w', 604_800_000], ['d', 86_400_000], ['h', 3_600_000], ['m', 60_000], ['s', 1000]]
  for (const [u, ms] of units) if (v >= ms && v % ms === 0) return `${v / ms}${u}`
  return `${v}ms`
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
