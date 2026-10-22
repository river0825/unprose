// What a reviewer of a domain story asks, as far as a file can answer it (docs/domain-story-review.md). These
// are hints for the conversation, so all but two are `info`: the method's site states the rule each one rests
// on, but whether a story breaks it is for the people telling it to say. Pure and builtin-free.
import { parseDsIcon } from './dsIcons.js'
import type { DsModel } from './domainStory.js'

const QUICK_START = 'domainstorytelling.org/quick-start-guide'
const EGON_HOWTO = 'egon.io/howto'
/** Hofer & Schwentner, Domain Storytelling (Leanpub edition of 2021-02-27), chapter 2 "Good Language Style". */
const BOOK_STYLE = 'Domain Storytelling (Hofer & Schwentner), ch. 2 "Good Language Style"'

export type DsReviewRule = 'scope-missing' | 'scope-purity' | 'request-response' | 'conditional' | 'negative-story' | 'work-objects-variants' | 'date-in-verb' | 'work-object-outcome' | 'work-objects-never-repeat' | 'work-objects-one-icon' | 'icon-unknown' | 'icon-invalid'
export interface DsReviewFinding {
  rule: DsReviewRule
  severity: 'warning' | 'info'
  element?: string
  message: string
  page: string
}

/** Work-object icons the board draws without the file bringing them (DS_OBJECT_KINDS and their aliases). */
const BUILT_IN_OBJECT_ICONS = new Set(['document', 'thing', 'digital', 'folder', 'call', 'email', 'conversation', 'info', 'message', 'information'])
/** A label may hold two languages: "Order placed · 訂單已成立", "Validation passed / 檢查通過". */
const parts = (text: string) => text.split(/\s*[/／·|｜\n]\s*/).map((p) => p.trim()).filter(Boolean)
const OUTCOME_EN = /\b(passed|failed|succeeded|rejected|approved|denied|completed|confirmed|done)$/i
const OUTCOME_CJK = /(未?通過|失敗|成功|完成)$/
const CONDITIONAL_EN = /\b(if|unless|otherwise|else|or)\b/i
const CONDITIONAL_CJK = /如果|否則|或者|還是/
/** A sentence about what does not happen ("不送", "is not sent", "skips") — a story has no symbol for it (the book, pp. 30–31). */
const NEGATIVE = /不送|不發|不再|不會|不執行|不觸發|沒有送|\bnot\b|\bno\b|\bnever\b|\bskip(s|ped)?\b|doesn't|does not|isn't|is not|won't|will not/i
const DATE = /\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}(-\d{2})?\b|\d{1,2}月\d{1,2}日|\b\d{1,2}月/
const num = (n: number) => `#${n}`

export function reviewDomainStory(m: DsModel): DsReviewFinding[] {
  const out: DsReviewFinding[] = []
  const name = (id: string) => m.actors.find((a) => a.id === id)?.text ?? id

  // Scope: "the granularity determines the level of detail" (coarse-, medium- or fine-grained), as-is or to-be, pure or digitalized.
  const unsaid = [!m.scope.granularity && 'granularity (coarse-, medium- or fine-grained)', !m.scope.time && 'time (as-is or to-be)', !m.scope.purity && 'purity (pure or digitalized)'].filter(Boolean)
  if (unsaid.length) out.push({ rule: 'scope-missing', severity: 'info', message: `the scope does not say its ${unsaid.join(', ')} — readers judge every sentence by it (how much detail, today or the future, with or without software), so decide it before telling the story`, page: QUICK_START })

  // "We call domain stories without software systems pure, and those with software systems digitalized."
  const inStory = (id: string) => m.sentences.some((s) => s.actor === id || s.to.includes(id))
  const systems = m.actors.filter((a) => a.kind === 'system' && inStory(a.id))
  if (m.scope.purity === 'pure' && systems.length)
    out.push({ rule: 'scope-purity', severity: 'warning', element: systems[0].id, message: `the scope says pure, but ${systems.map((a) => `"${a.text}"`).join(', ')} ${systems.length > 1 ? 'are software systems' : 'is a software system'} — a story with software systems is digitalized; change the scope, or tell who does this work`, page: QUICK_START })
  if (m.scope.purity === 'digitalized' && !systems.length)
    out.push({ rule: 'scope-purity', severity: 'info', message: 'the scope says digitalized, but no actor is a software system (kind: system) — a story without software systems is pure', page: QUICK_START })

  // "Avoid technical 'request and response' pattern … use Domain Storytelling to model intent" (the book, ch. 2).
  const acting = m.actors.filter((a) => inStory(a.id))
  const [first, second] = acting
  if (m.sentences.length >= 4 && acting.length === 2 && (first.kind === 'system') !== (second.kind === 'system') && acting.every((a) => m.sentences.some((s) => s.actor === a.id)))
    out.push({ rule: 'request-response', severity: 'info', message: `every sentence is between "${first.text}" and "${second.text}" — a user and a system answering each other reads like a screen flow, which a mock-up shows better; a domain story models intent: what is the user after, who else is involved, and how does the system help? Each activity should push the story forward`, page: BOOK_STYLE })

  const told = m.sentences.filter((s) => s.objectText)
  for (const s of m.sentences) {
    // "Domain stories visualize a concrete, meaningful example of a business process."
    const words = [s.verb, s.objectText ?? '', s.toLabel ?? '']
    if (words.some((w) => CONDITIONAL_EN.test(w) || CONDITIONAL_CJK.test(w)))
      out.push({ rule: 'conditional', severity: 'info', element: s.id, message: `${num(s.seq)} "${name(s.actor)} ${s.verb}${s.objectText ? ` ${s.objectText}` : ''}" reads like a choice — a domain story is one concrete example: tell the usual case here, put the variation in a note, and give an alternative that matters a story of its own`, page: QUICK_START })
    // "Actors create, work with, and exchange work objects such as documents, physical things, and digital objects."
    if (s.objectText && parts(s.objectText).some((p) => OUTCOME_EN.test(p) || OUTCOME_CJK.test(p)))
      out.push({ rule: 'work-object-outcome', severity: 'info', element: s.id, message: `${num(s.seq)} work object "${s.objectText}" reads like an outcome, not something an actor creates, works with or hands over — name the thing ("validation result", "signed contract") and keep what happened to it in the verb or a note`, page: QUICK_START })
  }

  // a story of things that do not happen: the point lives in notes, the picture shows nothing (pp. 30–31, 36–37)
  const negative = m.sentences.filter((s) => NEGATIVE.test(`${s.verb} ${s.objectText ?? ''} ${s.note ?? ''}`))
  if (m.sentences.length >= 3 && negative.length * 2 >= m.sentences.length)
    out.push({ rule: 'negative-story', severity: 'info', element: negative[0].id, message: `${negative.length} of ${m.sentences.length} sentences are about what does not happen (${negative.map((s) => num(s.seq)).join(' ')}) — a domain story has no symbol for that and every activity should push the story forward; what does not happen, and why, is an EventStorming timeline (events, policies, hotspots) or a note. Tell the case where it does happen here`, page: BOOK_STYLE })
  for (const s of m.sentences) {
    if (DATE.test(s.verb)) out.push({ rule: 'date-in-verb', severity: 'info', element: s.id, message: `${num(s.seq)} verb "${s.verb}" carries a date — the sequence numbers already say what comes first; put the when in a note (our judgment, not a rule of the method)`, page: QUICK_START })
  }
  // one thing under several names: "Casey plan=free", "Casey plan=growth", "Casey new name" are one contact
  const variants = new Map<string, Set<string>>()
  for (const s of told) {
    const first = (s.objectText ?? '').trim().split(/[\s／/·|]+/)[0]?.toLowerCase()
    if (first && first.length >= 2) variants.set(first, new Set([...(variants.get(first) ?? []), s.objectText!.trim()]))
  }
  for (const [first, names] of variants)
    if (names.size >= 3) out.push({ rule: 'work-objects-variants', severity: 'info', message: `${names.size} work objects start with "${first}": ${[...names].map((n) => `"${n}"`).join(', ')} — if they are one thing, give it one name and keep its state in a note or an annotation (the method draws the same work object again under the same name; its state may change)`, page: QUICK_START })

  // "For every activity, we draw a separate work object (even if the same work object already exists in a previous sentence)."
  const names = new Set(told.map((s) => s.object ?? s.objectText!.trim().toLowerCase()))
  if (told.length >= 4 && names.size === told.length)
    out.push({ rule: 'work-objects-never-repeat', severity: 'info', message: `no work object is in more than one of the ${told.length} sentences — the thing a story is about usually comes back (created, checked, handed on), drawn again each time under the same name; check whether some of these are one work object called differently`, page: QUICK_START })

  // "An icon set should be adapted to the domain" (the book, p. 21); Egon: "upload your own icons". The built-in icons
  // are generic, so when most of the things look alike the picture stops telling them apart — not only when all do.
  const icons = m.icons ?? {}
  const drawnAs = (kind: string) => (BUILT_IN_OBJECT_ICONS.has(kind) || parseDsIcon(icons[kind]) ? kind : 'document')
  const byIcon = new Map<string, Map<string, { text: string; declared: boolean }>>()
  for (const s of told) {
    const icon = drawnAs(s.objectKind)
    const things = byIcon.get(icon) ?? new Map()
    things.set(s.object ?? s.objectText!.trim().toLowerCase(), { text: s.objectText!.trim(), declared: !!s.object })
    byIcon.set(icon, things)
  }
  const [icon, alike] = [...byIcon].sort((a, b) => b[1].size - a[1].size)[0] ?? []
  if (icon && alike && told.length >= 3 && alike.size >= 3 && alike.size * 2 >= names.size) {
    const shown = [...alike.values()]
    const list = shown.slice(0, 5).map((t) => `"${t.text}"`).join(', ') + (shown.length > 5 ? ', …' : '')
    const loose = shown.filter((t) => !t.declared).map((t) => `"${t.text}"`)
    const declare = loose.length ? `; ${loose.slice(0, 3).join(', ')}${loose.length > 3 ? ' …' : ''} ${loose.length > 1 ? 'are' : 'is'} only named in a sentence (drawn as a document) — declare ${loose.length > 1 ? 'them' : 'it'} under \`workObjects\` to give ${loose.length > 1 ? 'them' : 'it'} a kind` : ''
    out.push({ rule: 'work-objects-one-icon', severity: 'info', message: `${alike.size === names.size ? `all ${alike.size}` : `${alike.size} of ${names.size}`} work objects are drawn with the "${icon}" icon (${list}) — a pictogram should say what the thing is, and the built-in icons are generic: draw a few of your own for this domain's things under \`icons:\` and use the name as the kind (a 24 × 24 line drawing of plain shapes, e.g. \`invoice: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 7.5h6M9 11h6"/></svg>'\`), or give each a fitting built-in kind (document, thing, digital, folder, call, email, conversation, info)${declare}`, page: EGON_HOWTO })
  }

  for (const [icon, svg] of Object.entries(icons)) {
    if (!parseDsIcon(svg)) out.push({ rule: 'icon-invalid', severity: 'warning', message: `icon "${icon}" has nothing the board can draw — write a 24 × 24 line drawing from <path d>, <circle>, <ellipse>, <rect>, <line>, <polyline> or <polygon> with plain numbers (no styles, text, images or links); the built-in icon is used instead`, page: EGON_HOWTO })
  }
  for (const o of m.workObjects) {
    if (!BUILT_IN_OBJECT_ICONS.has(o.kind) && !(o.kind in icons)) out.push({ rule: 'icon-unknown', severity: 'info', element: o.id, message: `"${o.text}": no icon named "${o.kind}" — it is drawn as a document; use a built-in kind or draw "${o.kind}" under \`icons:\``, page: EGON_HOWTO })
  }
  return out
}
