// Interop with Egon.io (https://egon.io, source github.com/WPS/egon.io), the Domain Storytelling modeler by
// the method's authors. Egon is GPL-3.0: nothing of its code or icon artwork is copied here — this module only
// reads and writes its saved file format (`.egn`, JSON), as documented by its source:
//   { iconSet: { name, actors: { <Icon>: <svg> }, workObjects: { <Icon>: <svg> } },
//     domainStory: { title, description, version, scope: { granularity, pointInTime, domainPurity },
//                    businessObjects: [...] } }
// businessObjects: `domainStory:actor<Icon>` / `domainStory:workObject<Icon>` shapes { id, name, x, y },
// `domainStory:activity` { source, target, number, name, waypoints }, `domainStory:group` { children },
// `domainStory:textAnnotation` { text } and `domainStory:connection` { source, target } (annotation → element).
// An activity starting at an actor carries the sentence number; one starting at a work object passes it on.
import { idAllocator } from './ids.js'
import { normalizeDomainStory, type DomainStoryContent } from './domainStory.js'
import { dsGlyphMarkup, parseDsIcon } from './dsIcons.js'

type Obj = { id: string; type: string; name?: string; text?: string; x?: number; y?: number; width?: number; height?: number; number?: number | null; source?: string; target?: string; children?: string[]; waypoints?: Array<{ x: number; y: number }>; pickedColor?: string }

const ACTOR = 'domainStory:actor'
const OBJECT = 'domainStory:workObject'
const lowerIcon = (icon: string) => icon.toLowerCase()
const capIcon = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1)

export interface EgonImport {
  content: DomainStoryContent
  title?: string
  description?: string
  /** What could not be carried over (e.g. an annotation linked to nothing). */
  warnings: string[]
}

/** An Egon.io story (the parsed `.egn` JSON, or the legacy bare array) → our domain-story content. */
export function fromEgon(file: unknown): EgonImport {
  const warnings: string[] = []
  const root = file as { domainStory?: { businessObjects?: Obj[]; title?: string; description?: string; scope?: Record<string, string> }; dst?: unknown } | Obj[]
  const story = Array.isArray(root) ? { businessObjects: root.filter((o) => (o as Obj).type) as Obj[] } : (root.domainStory ?? (typeof root.dst === 'string' ? JSON.parse(root.dst) : root.dst) ?? {})
  const objs: Obj[] = Array.isArray(story) ? story : (story.businessObjects ?? [])
  if (!objs.length) throw new Error('no domain story found (expected { domainStory: { businessObjects: [...] } })')
  const byId = new Map(objs.map((o) => [o.id, o]))
  const alloc = idAllocator()
  const ours = new Map<string, string>() // Egon id → our element id

  const actors = objs.filter((o) => o.type.startsWith(ACTOR)).map((o, i) => {
    const icon = o.type.slice(ACTOR.length) || 'Person'
    const text = (o.name ?? '').trim() || `${icon} ${i + 1}`
    const id = alloc(undefined, text, 'actor')
    ours.set(o.id, id)
    return { id, text, kind: lowerIcon(icon) }
  })
  const workObjects = objs.filter((o) => o.type.startsWith(OBJECT)).map((o, i) => {
    const icon = o.type.slice(OBJECT.length) || 'Document'
    const text = (o.name ?? '').trim() || `${icon.toLowerCase()} ${i + 1}`
    const id = alloc(undefined, text, 'object')
    ours.set(o.id, id)
    return { id, text, kind: lowerIcon(icon) }
  })
  const isActor = (id?: string) => !!id && byId.get(id)?.type.startsWith(ACTOR)
  const isObject = (id?: string) => !!id && byId.get(id)?.type.startsWith(OBJECT)
  const activities = objs.filter((o) => o.type === 'domainStory:activity')

  const starts = activities.filter((a) => isActor(a.source)).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  let next = 1
  const sentences = starts.map((a) => {
    const seq = typeof a.number === 'number' && a.number > 0 ? a.number : next
    next = Math.max(next, seq + 1)
    const verb = (a.name ?? '').trim() || 'does'
    const id = alloc(undefined, `${seq}-${verb}`, 'sentence')
    ours.set(a.id, id)
    if (isObject(a.target)) {
      const onward = activities.filter((b) => b.source === a.target && isActor(b.target))
      const toLabel = onward.map((b) => (b.name ?? '').trim()).find(Boolean)
      return { id, seq, actor: ours.get(a.source!)!, verb, object: ours.get(a.target!)!, ...(onward.length ? { to: onward.map((b) => ours.get(b.target!)!) } : {}), ...(toLabel ? { toLabel } : {}) }
    }
    return { id, seq, actor: ours.get(a.source!)!, verb, ...(isActor(a.target) ? { to: [ours.get(a.target!)!] } : {}) }
  })
  for (const a of activities) if (!isActor(a.source) && !isObject(a.source)) warnings.push(`activity ${a.id} starts at neither an actor nor a work object — skipped`)

  const groups = objs
    .filter((o) => o.type === 'domainStory:group')
    .map((g, i) => ({ id: alloc(undefined, (g.name ?? '').trim() || `group ${i + 1}`, 'group'), text: (g.name ?? '').trim() || `Group ${i + 1}`, members: (g.children ?? []).map((c) => ours.get(c)).filter((x): x is string => !!x) }))

  const annotations = objs
    .filter((o) => o.type === 'domainStory:textAnnotation')
    .flatMap((t) => {
      const link = objs.find((c) => c.type === 'domainStory:connection' && (c.source === t.id || c.target === t.id))
      const other = link ? (link.source === t.id ? link.target : link.source) : undefined
      const on = other ? ours.get(other) : undefined
      if (!on) {
        warnings.push(`annotation "${(t.text ?? '').slice(0, 40)}" is linked to nothing — skipped`)
        return []
      }
      return [{ on, text: t.text ?? '' }]
    })

  const s = (story as { scope?: Record<string, string> }).scope ?? {}
  const scope = { ...(s.granularity ? { granularity: s.granularity } : {}), ...(s.pointInTime ? { time: s.pointInTime } : {}), ...(s.domainPurity ? { purity: s.domainPurity } : {}) }
  const content = {
    ...(Object.keys(scope).length ? { scope } : {}),
    actors,
    workObjects,
    sentences,
    ...(groups.length ? { groups } : {}),
    ...(annotations.length ? { annotations } : {}),
  } as DomainStoryContent
  const meta = story as { title?: string; description?: string }
  return { content, ...(meta.title ? { title: meta.title } : {}), ...(meta.description ? { description: meta.description } : {}), warnings }
}

// Plain glyphs of our own (not Egon's artwork) so Egon has an icon for every name the story uses.
const GLYPH: Record<string, string> = {
  Person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/>',
  Group: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5zM10 20c0-3 3-5 6-5s6 2 6 5z"/>',
  System: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8v-2H8z"/>',
  Document: '<path d="M6 2h8l4 4v16H6z"/>',
}
const svg = (icon: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${GLYPH[icon] ?? '<rect x="4" y="4" width="16" height="16" rx="3"/>'}</svg>`

/** Our domain-story content → an Egon.io `.egn` object. Positions follow our left → right layout. */
export function toEgon(content: DomainStoryContent, opts: { title?: string; description?: string } = {}): Record<string, unknown> {
  const m = normalizeDomainStory(content)
  let n = 0
  const id = (p: 'shape' | 'connection') => `${p}_${1000 + ++n}`
  const objs: Obj[] = []
  const shapeOf = new Map<string, Obj>()
  const COL = 250
  const at = (col: number, row: number) => ({ x: 100 + col * COL, y: 100 + row * 200 })
  const center = (o: Obj) => ({ x: (o.x ?? 0) + 38, y: (o.y ?? 0) + 38 })

  const firstSeen: string[] = []
  for (const s of [...m.sentences].sort((a, b) => a.seq - b.seq)) for (const a of [s.actor, ...s.to]) if (!firstSeen.includes(a)) firstSeen.push(a)
  for (const a of m.actors) if (!firstSeen.includes(a.id)) firstSeen.push(a.id)
  firstSeen.forEach((aid, i) => {
    const a = m.actors.find((x) => x.id === aid)!
    const o: Obj = { id: id('shape'), type: `${ACTOR}${capIcon(a.kind)}`, name: a.text, ...at(i, 0), pickedColor: 'black' }
    shapeOf.set(a.id, o)
    objs.push(o)
  })
  const seqs = [...new Set(m.sentences.map((s) => s.seq))].sort((a, b) => a - b)
  const icons = { actors: new Set(m.actors.map((a) => capIcon(a.kind))), workObjects: new Set<string>() }
  for (const s of m.sentences) {
    const col = seqs.indexOf(s.seq)
    const stack = m.sentences.filter((x) => x.seq === s.seq).indexOf(s)
    const actor = shapeOf.get(s.actor)!
    if (s.objectText) {
      icons.workObjects.add(capIcon(s.objectKind))
      const wo: Obj = { id: id('shape'), type: `${OBJECT}${capIcon(s.objectKind)}`, name: s.objectText, ...at(col, 1 + stack), pickedColor: 'black' }
      objs.push(wo)
      shapeOf.set(s.id, wo)
      objs.push({ id: id('connection'), type: 'domainStory:activity', name: s.verb, number: s.seq, source: actor.id, target: wo.id, waypoints: [center(actor), center(wo)], pickedColor: 'black' })
      for (const r of s.to) {
        const to = shapeOf.get(r)!
        objs.push({ id: id('connection'), type: 'domainStory:activity', name: s.toLabel ?? '', number: null, source: wo.id, target: to.id, waypoints: [center(wo), center(to)], pickedColor: 'black' })
      }
    } else {
      for (const r of s.to.length ? s.to : []) {
        const to = shapeOf.get(r)!
        objs.push({ id: id('connection'), type: 'domainStory:activity', name: s.verb, number: s.seq, source: actor.id, target: to.id, waypoints: [center(actor), center(to)], pickedColor: 'black' })
      }
    }
  }
  for (const g of m.groups) {
    const members = g.members.map((mid) => shapeOf.get(mid) ?? objs.find((o) => o.type.startsWith(OBJECT) && o.name === m.workObjects.find((w) => w.id === mid)?.text)).filter((o): o is Obj => !!o)
    if (!members.length) continue
    const xs = members.map((o) => o.x ?? 0)
    const ys = members.map((o) => o.y ?? 0)
    objs.push({ id: id('shape'), type: 'domainStory:group', name: g.text, x: Math.min(...xs) - 40, y: Math.min(...ys) - 40, width: Math.max(...xs) - Math.min(...xs) + 160, height: Math.max(...ys) - Math.min(...ys) + 160, children: members.map((o) => o.id), pickedColor: 'black' })
  }
  m.annotations.forEach((a, i) => {
    const target = shapeOf.get(a.on)
    const t: Obj = { id: id('shape'), type: 'domainStory:textAnnotation', text: a.text, x: 100 + i * COL, y: 100 + (seqs.length ? 3 : 2) * 200, width: 150, height: 60 }
    objs.push(t)
    if (target) objs.push({ id: id('connection'), type: 'domainStory:connection', source: t.id, target: target.id, waypoints: [center(t), center(target)] })
  })
  // the story's own icons go into Egon's icon set as the shapes we draw (dsIcons.ts), under the kind's name
  const own = (icon: string) => {
    const glyph = parseDsIcon(m.icons?.[lowerIcon(icon)] ?? m.icons?.[icon])
    return glyph ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${dsGlyphMarkup(glyph)}</svg>` : undefined
  }
  const iconMap = (names: Set<string>) => Object.fromEntries([...names].map((k) => [k, own(k) ?? svg(k)]))
  return {
    iconSet: { name: 'unprose', actors: iconMap(icons.actors), workObjects: iconMap(icons.workObjects) },
    domainStory: {
      businessObjects: objs,
      title: opts.title ?? '',
      description: opts.description ?? '',
      version: '4.0.0',
      scope: { ...(m.scope.granularity ? { granularity: m.scope.granularity } : {}), ...(m.scope.time ? { pointInTime: m.scope.time } : {}), ...(m.scope.purity ? { domainPurity: m.scope.purity } : {}) },
    },
  }
}

