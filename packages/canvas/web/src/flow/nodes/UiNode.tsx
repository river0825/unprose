// A UI mock element (docs/diagrams.md §6c): drawn from `data.ui` with a small design system of our own.
// Nothing from the file is rendered as HTML — every value is text in a React element — so a mock written
// by an agent (or edited by anyone who can reach the canvas) cannot run scripts or load anything.
import type { NodeProps } from '@xyflow/react'
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import type { Item } from '../../../../src/model'
import { canEditValue, uiPendingOf, uiProposalOf, uiValueOp, type UiPath } from '../../diagrams/uiProposal'
import { uiFindingsOf } from '../../diagrams/uiFindings'
import type { ItemNode } from '../boardToFlow'
import { EditableText } from '../EditableText'
import { useEdit } from '../EditContext'
import { Shell } from './index'
import '../../ui-mock.css'

interface UiItem { id?: string; text: string; meta?: string; icon?: string; badge?: string; active?: boolean }
export interface UiData {
  type: string
  theme?: 'light' | 'dark'
  accent?: string
  radius?: number
  font?: string
  device?: string
  variant?: string
  level?: number
  tone?: string
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  items?: UiItem[]
  columns?: string[]
  rows?: Array<Array<string | number>>
  value?: string | number
  placeholder?: string
  hint?: string
  checked?: boolean
  delta?: string
  bg?: string
  pad?: number
  goto?: string
  path?: Array<string | number>
  textKey?: string
  container?: boolean
}

export const uiOf = (it: Item | undefined): UiData | undefined => {
  const u = it?.type === 'ui' ? (it.data?.ui as UiData | undefined) : undefined
  return u && typeof u.type === 'string' ? u : undefined
}

/** Elements whose words can be edited on the board (the edit becomes a proposal). */
export const UI_EDITABLE = new Set(['screen', 'card', 'navbar', 'sidebar', 'heading', 'text', 'link', 'button', 'input', 'textarea', 'select', 'search', 'checkbox', 'radio', 'toggle', 'badge', 'avatar', 'image', 'table', 'list', 'stat', 'alert', 'progress', 'empty'])

// ── icons: simple 24×24 line glyphs of our own ────────────────────────────────
const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20.5c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6',
  users: 'M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 19.5c.6-3 3.3-5 6.5-5s5.9 2 6.5 5M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.6c1.9.6 3.2 2.3 3.5 4.9',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  home: 'M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  check: 'M4.5 12.5l5 5 10-11',
  x: 'M6 6l12 12M18 6 6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  filter: 'M3.5 5h17l-6.5 8v6l-4-2v-4z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4',
  mail: 'M3.5 6h17v12h-17zM4 6.5l8 6.5 8-6.5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  board: 'M4 4h16v16H4zM9.5 4v16M15 4v9',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z',
  comment: 'M4 5h16v11H9l-5 4z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
}

export function UiIcon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  if (!name) return null
  const d = P[name] ?? P.more
  return (
    <svg className={`ui-icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** The element's words: plain text, or the inline editor while it is being edited. */
function Words({ item, fallback = '', className }: { item: Item; fallback?: string; className?: string }) {
  const edit = useEdit()
  if (edit.editingId === item.id)
    return <EditableText text={item.text ?? ''} editing onCommit={(t) => edit.commitText(item.id, t)} onCancel={edit.cancelEdit} className={className} />
  return <span className={`ui-words ${className ?? ''}`}>{item.text || fallback}</span>
}

// ── one value inside an element, edited in place: a table cell, a list / tab / link item ─────────────
interface ValueEdit {
  /** the value being edited, e.g. ['rows', 1, 2] */
  editing: UiPath | null
  /** the value a text proposal is about, marked on the board */
  proposed?: UiPath
  start: (sub: UiPath) => void
  commit: (sub: UiPath, text: string) => void
  cancel: () => void
}
const ValueCtx = createContext<ValueEdit | null>(null)
const same = (a: UiPath | null | undefined, b: UiPath) => !!a && a.length === b.length && a.every((k, i) => String(k) === String(b[i]))

/** Double-click to change these words: a text proposal for exactly this value in the file. */
function Val({ sub, text, children }: { sub: UiPath; text: string; children?: ReactNode }) {
  const v = useContext(ValueCtx)
  if (v && same(v.editing, sub))
    return (
      <span className="ui-val-editing">
        <EditableText text={text} editing onCommit={(t) => v.commit(sub, t)} onCancel={v.cancel} />
      </span>
    )
  return (
    <span
      className={`ui-val ${v && same(v.proposed, sub) ? 'ui-val-proposed' : ''}`}
      onDoubleClick={
        v
          ? (e) => {
              e.stopPropagation()
              v.start(sub)
            }
          : undefined
      }
    >
      {children ?? text}
    </span>
  )
}

/** `[Done]` in a table cell or list badge reads as a status badge. */
function Cell({ v }: { v: string | number | undefined }) {
  const s = v === undefined ? '' : String(v)
  const m = s.match(/^\[(.+)\]$/)
  if (m) return <span className={`ui-badge-chip t-${toneOf(m[1])}`}>{m[1]}</span>
  return <>{s}</>
}

/** A status word's tone, so `[Done]` is green and `[Blocked]` red without saying so. */
function toneOf(word: string): string {
  const w = word.toLowerCase()
  if (/^(done|active|live|ok|paid|success|online|merged|approved|ready|shipped)/.test(w)) return 'success'
  if (/^(failed|error|blocked|overdue|declined|offline|danger|rejected)/.test(w)) return 'danger'
  if (/^(pending|review|waiting|draft|warning|at risk|paused|in progress)/.test(w)) return 'warning'
  if (/^(new|info|beta|open)/.test(w)) return 'info'
  return 'neutral'
}

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('') || '?'

function body(item: Item, u: UiData, editing: boolean): ReactNode {
  const items = u.items ?? []
  switch (u.type) {
    case 'screen':
      return (
        <div className="ui-screen-name">
          <Words item={item} />
          <span className="ui-screen-size">
            {u.device ?? ''} · {Math.round(item.w)}×{Math.round(item.h)}
          </span>
        </div>
      )
    case 'card':
      return item.text ? <div className="ui-card-title" style={u.pad !== undefined ? { left: Math.max(12, u.pad), right: Math.max(12, u.pad), top: Math.max(8, u.pad - 2) } : undefined}><Words item={item} /></div> : null
    case 'section':
      return null
    case 'navbar':
      return (
        <div className="ui-navbar-in">
          <span className="ui-brand">
            <span className="ui-brand-mark" aria-hidden="true" />
            <Words item={item} fallback="Brand" />
          </span>
          <nav className="ui-navlinks">
            {items.map((l, i) => (
              <span key={i} className={l.active ? 'on' : ''}>
                <Val sub={['items', i]} text={l.text} />
              </span>
            ))}
          </nav>
        </div>
      )
    case 'sidebar':
      return (
        <div className="ui-sidebar-in">
          {item.text ? <div className="ui-sidebar-title"><Words item={item} /></div> : null}
          {items.map((l, i) => (
            <div key={i} className={`ui-side-item ${l.active ? 'on' : ''}`}>
              <UiIcon name={l.icon} />
              <span className="ui-grow"><Val sub={['items', i]} text={l.text} /></span>
              {l.badge ? <span className="ui-count">{l.badge}</span> : null}
            </div>
          ))}
        </div>
      )
    case 'heading':
      return <Words item={item} fallback="Heading" />
    case 'text':
      return <Words item={item} fallback="Text" />
    case 'link':
      return (
        <>
          <UiIcon name={u.icon} />
          <Words item={item} fallback="Link" />
        </>
      )
    case 'button':
      return (
        <>
          <UiIcon name={u.icon} />
          {item.text || editing ? <Words item={item} /> : null}
        </>
      )
    case 'input':
    case 'select':
    case 'search':
    case 'textarea': {
      const val = u.value !== undefined ? String(u.value) : ''
      return (
        <>
          {u.type !== 'search' && (item.text || editing) ? (
            <label className="ui-label">
              <Words item={item} />
            </label>
          ) : null}
          <div className="ui-field">
            {u.type === 'search' ? <UiIcon name="search" /> : u.icon ? <UiIcon name={u.icon} /> : null}
            <span className={`ui-grow ${val ? '' : 'ui-ph'}`}>{val || u.placeholder || (u.type === 'search' ? item.text || 'Search' : '')}</span>
            {u.type === 'select' ? <UiIcon name="chevron-down" /> : null}
          </div>
          {u.hint ? <div className="ui-hint">{u.hint}</div> : null}
        </>
      )
    }
    case 'checkbox':
    case 'radio':
      return (
        <>
          <span className={`ui-check ${u.checked ? 'on' : ''}`} aria-hidden="true">
            {u.checked && u.type === 'checkbox' ? <UiIcon name="check" size={12} /> : null}
          </span>
          <Words item={item} />
        </>
      )
    case 'toggle':
      return (
        <>
          <span className={`ui-switch ${u.checked ? 'on' : ''}`} aria-hidden="true" />
          <Words item={item} />
        </>
      )
    case 'badge':
      return <Words item={item} fallback="Badge" />
    case 'avatar':
      return editing ? <Words item={item} /> : <span>{initials(item.text ?? '')}</span>
    case 'icon':
      return <UiIcon name={u.icon ?? item.text} size={Math.min(item.w, item.h)} />
    case 'divider':
    case 'spacer':
      return null
    case 'image':
      return (
        <div className="ui-image-in">
          <UiIcon name="image" size={28} />
          <Words item={item} />
        </div>
      )
    case 'table':
      return (
        <>
          {item.text ? <div className="ui-block-title"><Words item={item} /></div> : null}
          <table className="ui-table-el">
            <thead>
              <tr>
                {(u.columns ?? []).map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(u.rows ?? []).map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Val sub={['rows', i, j]} text={c === undefined ? '' : String(c)}>
                        <Cell v={c} />
                      </Val>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )
    case 'list':
      return (
        <>
          {item.text ? <div className="ui-block-title"><Words item={item} /></div> : null}
          {items.map((l, i) => (
            <div key={i} className={`ui-list-row ${l.active ? 'on' : ''} ${l.meta ? 'two' : ''}`}>
              {l.icon ? <span className="ui-list-icon"><UiIcon name={l.icon} /></span> : null}
              <span className="ui-grow ui-list-text">
                <Val sub={['items', i]} text={l.text} />
                {l.meta ? <span className="ui-meta">{l.meta}</span> : null}
              </span>
              {l.badge ? <Cell v={/^\[.*\]$/.test(l.badge) ? l.badge : `[${l.badge}]`} /> : null}
              {u.variant !== 'plain' ? <UiIcon name="chevron-right" className="ui-faint" /> : null}
            </div>
          ))}
        </>
      )
    case 'stat': {
      const d = u.delta ?? ''
      return (
        <>
          <span className="ui-stat-label">
            <Words item={item} fallback="Metric" />
          </span>
          <span className="ui-stat-value">{u.value ?? '—'}</span>
          {d ? <span className={`ui-delta ${d.trim().startsWith('-') ? 'down' : 'up'}`}>{d}</span> : null}
        </>
      )
    }
    case 'alert':
      return (
        <>
          <UiIcon name={u.icon ?? (u.tone === 'danger' || u.tone === 'warning' ? 'bell' : u.tone === 'success' ? 'check' : 'comment')} />
          <Words item={item} />
        </>
      )
    case 'progress': {
      const v = Math.max(0, Math.min(100, Number(u.value ?? 0)))
      return (
        <>
          {item.text ? (
            <div className="ui-progress-head">
              <Words item={item} />
              <span>{v}%</span>
            </div>
          ) : null}
          <div className="ui-track">
            <div className="ui-fill" style={{ width: `${v}%` }} />
          </div>
        </>
      )
    }
    case 'tabs':
      return items.map((t, i) => (
        <span key={i} className={`ui-tab ${t.active ? 'on' : ''}`}>
          <Val sub={['items', i]} text={t.text} />
          {t.badge ? <span className="ui-count">{t.badge}</span> : null}
        </span>
      ))
    case 'breadcrumb':
      return items.map((t, i) => (
        <span key={i} className={`ui-crumb ${i === items.length - 1 ? 'on' : ''}`}>
          {i > 0 ? <UiIcon name="chevron-right" size={12} /> : null}
          <Val sub={['items', i]} text={t.text} />
        </span>
      ))
    case 'pagination': {
      const cur = Number(u.value ?? 1)
      return ['‹', '1', '2', '3', '…', '9', '›'].map((p, i) => (
        <span key={i} className={`ui-page ${p === String(cur) ? 'on' : ''}`}>
          {p}
        </span>
      ))
    }
    case 'empty':
      return (
        <div className="ui-empty-in">
          <span className="ui-empty-icon">
            <UiIcon name={u.icon ?? 'folder'} size={22} />
          </span>
          <span className="ui-empty-title">
            <Words item={item} fallback="Nothing here yet" />
          </span>
          {u.value !== undefined ? <span className="ui-meta">{String(u.value)}</span> : null}
        </div>
      )
    case 'chart':
      return <Chart item={item} u={u} />
    default:
      return <Words item={item} />
  }
}

function Chart({ item, u }: { item: Item; u: UiData }) {
  const nums = (u.rows?.[0] ?? []).map(Number).filter((n) => Number.isFinite(n))
  const data = nums.length ? nums : [4, 7, 5, 9, 6, 11, 8, 12]
  const max = Math.max(...data, 1)
  const W = 100
  const H = 60
  const step = W / data.length
  return (
    <>
      {item.text ? <div className="ui-block-title"><Words item={item} /></div> : null}
      <svg className="ui-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="ui-grid-line" />
        ))}
        {u.variant === 'line' ? (
          <polyline className="ui-line" points={data.map((d, i) => `${i * step + step / 2},${H - (d / max) * (H - 4)}`).join(' ')} />
        ) : (
          data.map((d, i) => <rect key={i} className="ui-bar" x={i * step + step * 0.2} width={step * 0.6} y={H - (d / max) * (H - 4)} height={(d / max) * (H - 4)} rx="0.8" />)
        )}
      </svg>
    </>
  )
}

export function UiNode({ data, selected }: NodeProps<ItemNode>) {
  const { item, pulse } = data
  const u = uiOf(item) ?? { type: item.role ?? 'text' }
  const edit = useEdit()
  const proposal = uiProposalOf(item)
  const gone = Boolean(edit.uiRemoved?.has(item.id))
  const editable = UI_EDITABLE.has(u.type) && !gone
  const findings = uiFindingsOf(item)
  const [editingValue, setEditingValue] = useState<UiPath | null>(null)
  const values: ValueEdit | null =
    edit.commitOps && Array.isArray(u.path) && !gone && proposal?.kind !== 'add'
      ? {
          editing: editingValue,
          proposed: uiPendingOf(item)?.sub,
          start: (sub) => {
            if (canEditValue(item, sub)) setEditingValue(sub)
          },
          commit: (sub, text) => {
            setEditingValue(null)
            const op = uiValueOp(item, sub, text, new Date().toISOString())
            if (op) edit.commitOps?.([op], `proposed '${text.slice(0, 40)}'`)
          },
          cancel: () => setEditingValue(null),
        }
      : null
  const style = {
    ...(u.accent ? { ['--u-accent' as string]: u.accent } : {}),
    ...(u.radius !== undefined ? { ['--u-radius' as string]: `${u.radius}px` } : {}),
  } as CSSProperties
  const classes = [
    'ui',
    `ui-${u.type}`,
    `ui-${u.theme ?? 'light'}`,
    u.font ? `ui-font-${u.font}` : '',
    u.variant ? `v-${u.variant}` : '',
    u.size ? `s-${u.size}` : '',
    u.tone ? `t-${u.tone}` : '',
    u.level ? `l-${u.level}` : '',
    u.bg ? `bg-${u.bg}` : '',
    u.type === 'screen' && u.device ? `d-${u.device}` : '',
    u.type === 'badge' && !u.tone ? `t-${toneOf(item.text ?? '')}` : '',
    gone ? 'ui-gone' : '',
    proposal?.kind === 'add' ? 'ui-new' : '',
  ]
  return (
    <Shell
      item={item}
      pulse={pulse}
      selected={selected}
      resizable
      handles={u.type === 'screen'}
      className={classes.filter(Boolean).join(' ')}
      style={style}
      onDouble={editable ? undefined : () => undefined}
    >
      <ValueCtx.Provider value={values}>{body(item, u, edit.editingId === item.id)}</ValueCtx.Provider>
      {findings.length ? (
        <span
          className={`ui-finding-mark ${findings.some((f) => f.severity === 'warning') ? 'warning' : 'info'}`}
          title={findings.map((f) => `${f.severity}: ${f.message}`).join('\n')}
          aria-label={`${findings.length} lint finding${findings.length === 1 ? '' : 's'}: ${findings.map((f) => f.message).join('; ')}`}
          role="img"
        >
          {findings.some((f) => f.severity === 'warning') ? '!' : 'i'}
        </span>
      ) : null}
    </Shell>
  )
}
