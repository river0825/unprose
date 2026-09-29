// Serves the repo's docs/*.md (and the root README) as a small reading site at
// /docs. Markdown is rendered server-side with `marked`; ```mermaid fences
// become <pre class="mermaid"> and are drawn client-side. The shell shares the
// canvas design tokens (docs/DESIGN-SYSTEM.md): paper + graphite, IBM Plex,
// one marker-blue accent, hairlines instead of cards.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Walk upward from this package until a `docs/` directory is found. */
export function findDocsDir(from = __dirname): string | undefined {
  if (process.env.AWD_DOCS_DIR) return path.resolve(process.env.AWD_DOCS_DIR)
  let dir = from
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'docs')
    if (fs.existsSync(path.join(candidate, 'DESIGN.md')) || fs.existsSync(path.join(candidate, 'ARCHITECTURE.md'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export interface DocEntry {
  /** URL slug, e.g. `ARCHITECTURE` or `README`. */
  name: string
  title: string
  file: string
}

const PREFERRED_ORDER = ['MANUAL', 'README', 'ARCHITECTURE', 'ROADMAP', 'agents', 'reflection', 'workflow', 'canvas', 'DESIGN', 'DESIGN-SYSTEM', 'UX-FLOW']

export function listDocs(docsDir: string): DocEntry[] {
  const entries: DocEntry[] = []
  const readme = path.join(path.dirname(docsDir), 'README.md')
  if (fs.existsSync(readme)) entries.push({ name: 'README', title: titleOf(readme) ?? 'README', file: readme })
  for (const f of fs.readdirSync(docsDir).sort()) {
    if (!f.endsWith('.md')) continue
    const name = f.slice(0, -3)
    entries.push({ name, title: titleOf(path.join(docsDir, f)) ?? name, file: path.join(docsDir, f) })
  }
  const rank = (e: DocEntry) => {
    const i = PREFERRED_ORDER.indexOf(e.name)
    return i === -1 ? PREFERRED_ORDER.length : i
  }
  return entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function titleOf(file: string): string | undefined {
  const head = fs.readFileSync(file, 'utf8').slice(0, 4000)
  const m = /^#\s+(.+)$/m.exec(head)
  return m?.[1].trim()
}

/** Resolve a static asset referenced from a doc (images under docs/ or example/). */
export function resolveDocAsset(docsDir: string, rel: string): string | undefined {
  const root = path.dirname(docsDir)
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '')
  const candidates = [path.join(docsDir, safe), path.join(root, safe)]
  for (const c of candidates) {
    if ((c.startsWith(docsDir) || c.startsWith(path.join(root, 'example'))) && fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return undefined
}

export function renderDoc(docsDir: string, name: string): string | undefined {
  const docs = listDocs(docsDir)
  const entry = docs.find((e) => e.name === name)
  if (!entry) return undefined
  const md = fs.readFileSync(entry.file, 'utf8')
  const { html, headings } = renderMarkdownWithToc(md, { inlineSvg: (href) => inlineSvgFor(docsDir, href) })
  return page({ title: entry.title, body: html, docs, current: entry.name, headings, file: path.basename(entry.file) })
}

/**
 * Diagrams live in docs/diagrams/*.svg and are inlined instead of served as <img>,
 * so they pick up the page's fonts and can switch to their `-dark` sibling with the
 * theme. Returns undefined for anything that is not a local .svg.
 */
function inlineSvgFor(docsDir: string, href: string): { light: string; dark?: string } | undefined {
  if (!/\.svg$/i.test(href) || /^[a-z]+:/i.test(href)) return undefined
  const rel = href.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
  const file = resolveDocAsset(docsDir, rel)
  if (!file) return undefined
  const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/^\s*<!DOCTYPE[^>]*>\s*/i, '')
  const darkFile = file.replace(/\.svg$/i, '-dark.svg')
  return { light: read(file), dark: fs.existsSync(darkFile) ? read(darkFile) : undefined }
}

export function renderIndex(docsDir: string): string {
  const docs = listDocs(docsDir)
  const body = `<h1>Docs</h1>
<p class="lede">這個專案的說明文件。要「做某件事」看<a href="/docs/MANUAL">操作手冊</a>；要懂「為什麼這樣設計」看<a href="/docs/ARCHITECTURE">架構說明</a>；其他是 reference。</p>
<ol class="doc-list">${docs
    .map(
      (d) => `<li><a href="/docs/${encodeURIComponent(d.name)}">${escapeHtml(d.title)}</a><span class="slug">${escapeHtml(path.basename(d.file))}</span></li>`,
    )
    .join('')}</ol>`
  return page({ title: 'Docs', body, docs, headings: [] })
}

export interface Heading {
  level: number
  id: string
  text: string
}

export function renderMarkdown(md: string): string {
  return renderMarkdownWithToc(md).html
}

export interface RenderOptions {
  /** Return the SVG text to inline for a local image href (see inlineSvgFor). */
  inlineSvg?: (href: string) => { light: string; dark?: string } | undefined
}

export function renderMarkdownWithToc(md: string, opts: RenderOptions = {}): { html: string; headings: Heading[] } {
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  const renderer = new marked.Renderer()
  const baseCode = renderer.code.bind(renderer)
  renderer.code = function (token) {
    if ((token.lang ?? '').trim() === 'mermaid') return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`
    return baseCode(token)
  }
  renderer.heading = function (token) {
    const text = this.parser.parseInline(token.tokens)
    const plain = token.text.replace(/[`*_]/g, '')
    let id = slugify(plain)
    const n = seen.get(id) ?? 0
    seen.set(id, n + 1)
    if (n > 0) id = `${id}-${n}`
    if (token.depth >= 2 && token.depth <= 3) headings.push({ level: token.depth, id, text: plain })
    return `<h${token.depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${token.depth}>\n`
  }
  renderer.link = function (token) {
    const href = rewriteLink(token.href)
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
    return `<a href="${escapeHtml(href)}"${title}>${this.parser.parseInline(token.tokens)}</a>`
  }
  renderer.image = function (token) {
    const svg = opts.inlineSvg?.(token.href)
    if (svg) {
      const caption = token.text ? `<figcaption>${escapeHtml(token.text)}</figcaption>` : ''
      const dark = svg.dark ? `<div class="only-dark">${svg.dark}</div>` : ''
      return `<figure class="diagram${svg.dark ? ' has-dark' : ''}"><div class="only-light">${svg.light}</div>${dark}${caption}</figure>`
    }
    const src = rewriteAsset(token.href)
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ''}>`
  }
  renderer.table = function (token) {
    const head = `<tr>${token.header.map((c) => `<th${align(c.align)}>${this.parser.parseInline(c.tokens)}</th>`).join('')}</tr>`
    const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td${align(c.align)}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('')
    return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`
  }
  const html = marked.parse(md, { renderer, gfm: true }) as string
  return { html, headings }
}

function align(a: 'center' | 'left' | 'right' | null): string {
  return a ? ` style="text-align:${a}"` : ''
}

function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return out || 'section'
}

/** `workflow.md` / `./canvas.md` → `/docs/workflow`; `../README.md` → `/docs/README`; others untouched. */
function rewriteLink(href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  const m = /^(?:\.\/)?(?:\.\.\/)*([\w.-]+)\.md(#.*)?$/.exec(href)
  if (m) return `/docs/${m[1]}${m[2] ?? ''}`
  if (/^(?:\.\/)?[\w.-]+$/.test(href) && !href.includes('.')) return `/docs/${href}`
  return rewriteAsset(href)
}

function rewriteAsset(href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith('/')) return href
  return `/docs/_asset/${href.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')}`
}

interface PageOpts {
  title: string
  body: string
  docs: DocEntry[]
  current?: string
  headings: Heading[]
  file?: string
}

function page({ title, body, docs, current, headings, file }: PageOpts): string {
  const nav = docs
    .map(
      (d) =>
        `<a href="/docs/${encodeURIComponent(d.name)}"${d.name === current ? ' class="current" aria-current="page"' : ''}>${escapeHtml(d.title)}</a>`,
    )
    .join('')
  const toc =
    headings.length > 1
      ? `<nav class="toc" aria-label="On this page"><div class="side-heading">On this page</div>${headings
          .map((h) => `<a class="l${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`)
          .join('')}</nav>`
      : ''
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — awd docs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
  <a class="boards" href="/">Boards</a>
  <span class="sep" aria-hidden="true"></span>
  <a class="brand" href="/docs">Docs</a>
  ${current ? `<span class="crumb">${escapeHtml(title)}</span>` : ''}
  ${file ? `<span class="file">${escapeHtml(file)}</span>` : ''}
</header>
<div class="shell">
  <aside class="side">
    <nav class="docs-nav" aria-label="Documents"><div class="side-heading">Documents</div>${nav}</nav>
    ${toc}
  </aside>
  <main id="content" class="doc">${body}</main>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
  const css = getComputedStyle(document.documentElement)
  const v = (name) => css.getPropertyValue(name).trim()
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'
    || document.documentElement.dataset.theme === 'dark'
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    fontFamily: v('--font'),
    themeVariables: {
      darkMode: dark,
      background: v('--paper'),
      primaryColor: v('--paper'),
      primaryTextColor: v('--ink'),
      primaryBorderColor: v('--ink-2'),
      secondaryColor: v('--chrome'),
      secondaryTextColor: v('--ink'),
      secondaryBorderColor: v('--rule-2'),
      tertiaryColor: v('--chrome-2'),
      tertiaryTextColor: v('--ink'),
      tertiaryBorderColor: v('--rule-2'),
      lineColor: v('--ink-2'),
      textColor: v('--ink'),
      mainBkg: v('--paper'),
      nodeBorder: v('--ink-2'),
      clusterBkg: v('--chrome'),
      clusterBorder: v('--rule-2'),
      edgeLabelBackground: v('--paper'),
      actorBkg: v('--paper'),
      actorBorder: v('--ink-2'),
      actorTextColor: v('--ink'),
      actorLineColor: v('--rule-2'),
      signalColor: v('--ink-2'),
      signalTextColor: v('--ink'),
      labelBoxBkgColor: v('--chrome'),
      labelBoxBorderColor: v('--rule-2'),
      labelTextColor: v('--ink'),
      loopTextColor: v('--ink'),
      noteBkgColor: v('--c-pale-yellow'),
      noteBorderColor: v('--rule-2'),
      noteTextColor: v('--sticky-ink'),
      activationBkgColor: v('--marker-soft'),
      activationBorderColor: v('--marker'),
      fontSize: '14px',
    },
  })
  await mermaid.run({ querySelector: 'pre.mermaid' })
</script>
<script>
// Lightbox: click a diagram to enlarge; wheel / pinch / +− to zoom, drag to pan,
// double-click to toggle 1× ↔ 2×, 0 to reset, Esc or backdrop to close.
(function () {
  const box = document.createElement('div')
  box.className = 'lightbox'
  box.hidden = true
  box.innerHTML = '<div class="lightbox-bar"><span class="lightbox-title"></span><span class="lightbox-zoom" aria-live="polite"></span>'
    + '<button type="button" data-act="out" aria-label="Zoom out">−</button><button type="button" data-act="in" aria-label="Zoom in">+</button>'
    + '<button type="button" data-act="reset" aria-label="Reset zoom">Fit</button><button type="button" data-act="close" aria-label="Close">Close</button></div>'
    + '<div class="lightbox-stage"><div class="lightbox-inner"></div></div><p class="lightbox-hint">Scroll to zoom · drag to pan · double-click to toggle · Esc to close</p>'
  document.body.appendChild(box)
  const stage = box.querySelector('.lightbox-stage'), inner = box.querySelector('.lightbox-inner')
  const title = box.querySelector('.lightbox-title'), zoomLabel = box.querySelector('.lightbox-zoom')
  let scale = 1, fit = 1, tx = 0, ty = 0, opener = null, drag = null, pinch = null
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  let base = { w: 1, h: 1 }
  // Resize the SVG itself instead of transform:scale — a scaled layer is a bitmap and goes blurry; a resized SVG re-renders as vectors.
  const apply = () => {
    const svg = inner.firstChild
    if (svg) { svg.style.width = base.w * scale + 'px'; svg.style.height = base.h * scale + 'px' }
    inner.style.transform = 'translate(' + tx + 'px,' + ty + 'px)'
    zoomLabel.textContent = Math.round(scale / fit * 100) + '%'
  }
  const size = (svg) => { const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number); return vb.length === 4 && vb[2] ? { w: vb[2], h: vb[3] } : { w: svg.clientWidth || 1200, h: svg.clientHeight || 700 } }
  function open(figure) {
    const visible = Array.from(figure.querySelectorAll('svg')).find((el) => el.getClientRects().length) || figure.querySelector('svg')
    if (!visible) return
    const clone = visible.cloneNode(true)
    // ids would collide with the inline copy; namespace them
    const suffix = '-lb'
    clone.querySelectorAll('[id]').forEach((el) => { el.id = el.id + suffix })
    clone.innerHTML = clone.innerHTML.replace(/url\(#([^)]+)\)/g, 'url(#$1' + suffix + ')').replace(/(href|aria-labelledby)="#?([^"]+)"/g, (m, a, v) => a === 'aria-labelledby' ? a + '="' + v.split(' ').map((x) => x + suffix).join(' ') + '"' : a + '="#' + v + suffix + '"')
    const { w, h } = size(clone)
    base = { w, h }
    clone.removeAttribute('width'); clone.removeAttribute('height'); clone.setAttribute('preserveAspectRatio', 'xMinYMin meet')
    inner.replaceChildren(clone)
    title.textContent = (figure.querySelector('figcaption') || {}).textContent || ''
    opener = figure
    box.hidden = false
    document.body.classList.add('lightbox-open')
    const r = stage.getBoundingClientRect()
    fit = Math.min((r.width - 48) / w, (r.height - 48) / h, 2)
    scale = fit; tx = (r.width - w * scale) / 2; ty = (r.height - h * scale) / 2
    apply()
    box.querySelector('[data-act="close"]').focus()
  }
  function close() { box.hidden = true; document.body.classList.remove('lightbox-open'); inner.replaceChildren(); if (opener) opener.focus(); opener = null }
  function zoomAt(factor, cx, cy) {
    const r = stage.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top
    const next = clamp(scale * factor, fit * 0.5, fit * 8)
    tx = px - (px - tx) * (next / scale); ty = py - (py - ty) * (next / scale); scale = next; apply()
  }
  const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
  document.addEventListener('click', (e) => {
    const fig = e.target.closest('figure.diagram, pre.mermaid')
    if (fig && !box.contains(fig)) { e.preventDefault(); open(fig); return }
    const btn = e.target.closest('.lightbox [data-act]')
    if (btn) {
      const act = btn.dataset.act; const [cx, cy] = center()
      if (act === 'in') zoomAt(1.25, cx, cy); else if (act === 'out') zoomAt(0.8, cx, cy)
      else if (act === 'reset') { const r = stage.getBoundingClientRect(); const svg = inner.firstChild; const { w, h } = size(svg); scale = fit; tx = (r.width - w * scale) / 2; ty = (r.height - h * scale) / 2; apply() }
      else if (act === 'close') close()
      return
    }
    if (e.target === stage && !drag?.moved) close()
  })
  document.addEventListener('keydown', (e) => {
    const fig = e.target.closest && e.target.closest('figure.diagram, pre.mermaid')
    if (fig && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(fig); return }
    if (box.hidden) return
    const [cx, cy] = center()
    if (e.key === 'Escape') close(); else if (e.key === '+' || e.key === '=') zoomAt(1.25, cx, cy); else if (e.key === '-') zoomAt(0.8, cx, cy)
    else if (e.key === '0') box.querySelector('[data-act="reset"]').click()
  })
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY) }, { passive: false })
  stage.addEventListener('dblclick', (e) => { if (scale > fit * 1.5) box.querySelector('[data-act="reset"]').click(); else zoomAt((fit * 2) / scale, e.clientX, e.clientY) })
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && pinch) return
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false, id: e.pointerId }; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging')
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    tx = drag.tx + dx; ty = drag.ty + dy; apply()
  })
  const endDrag = () => { stage.classList.remove('dragging'); setTimeout(() => { drag = null }, 0) }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag)
  // two-finger pinch
  stage.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) } } }, { passive: true })
  stage.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return
    e.preventDefault()
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    zoomAt(d / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2); pinch.d = d
  }, { passive: false })
  stage.addEventListener('touchend', () => { pinch = null }, { passive: true })
  // make figures reachable by keyboard and announce the affordance
  document.querySelectorAll('figure.diagram, pre.mermaid').forEach((f) => { f.tabIndex = 0; f.setAttribute('role', 'button'); f.setAttribute('aria-label', ((f.querySelector('figcaption') || {}).textContent || 'Diagram') + ' — click to enlarge') })
})()
</script>
</body>
</html>`
}

const CSS = `
:root {
  color-scheme: light;
  --paper: #fbfbf9; --paper-dot: #d8d9d4;
  --chrome: #f0f1f0; --chrome-2: #e6e8e6;
  --ink: #161a1f; --ink-2: #444b53; --ink-3: #6b727a;
  --rule: #cfd3d6; --rule-2: #aeb4b9;
  --marker: #1f56d6; --marker-ink: #ffffff; --marker-soft: #e3ebfb;
  --agent: #6e3fc4; --user: #1b7f5a; --danger: #b8342a;
  --c-pale-yellow: #fff3b0; --sticky-ink: #17130f;
  --font: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --measure: 72ch;
  --header-h: 44px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --paper: #1b2027; --paper-dot: #2b323b;
    --chrome: #12161b; --chrome-2: #1a1f26;
    --ink: #e8eaec; --ink-2: #b7bcc3; --ink-3: #8a9099;
    --rule: #2e353d; --rule-2: #414a54;
    --marker: #7ea2ff; --marker-ink: #0b1a3d; --marker-soft: #1d2a45;
    --agent: #b899f2; --user: #67cfa3; --danger: #f08a7e;
    --c-pale-yellow: #c9bd76; --sticky-ink: #100d0a;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #1b2027; --paper-dot: #2b323b;
  --chrome: #12161b; --chrome-2: #1a1f26;
  --ink: #e8eaec; --ink-2: #b7bcc3; --ink-3: #8a9099;
  --rule: #2e353d; --rule-2: #414a54;
  --marker: #7ea2ff; --marker-ink: #0b1a3d; --marker-soft: #1d2a45;
  --agent: #b899f2; --user: #67cfa3; --danger: #f08a7e;
  --c-pale-yellow: #c9bd76; --sticky-ink: #100d0a;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
html, body { margin: 0; }
body { background: var(--paper); color: var(--ink); font: 16px/1.5 var(--font); overflow-x: hidden; }
a { color: var(--marker); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--marker) 40%, transparent); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--marker); }
:focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; border-radius: 2px; }
.skip { position: absolute; left: 8px; top: -40px; padding: 8px 12px; background: var(--marker); color: var(--marker-ink); border-radius: 4px; z-index: 10; }
.skip:focus { top: 8px; }

.top { display: flex; align-items: center; gap: 12px; height: var(--header-h); padding: 0 16px; border-bottom: 1px solid var(--rule); background: var(--chrome); position: sticky; top: 0; z-index: 2; font-size: 13.5px; font-weight: 500; min-width: 0; }
.top a { color: var(--ink-2); text-decoration: none; padding: 6px 4px; border-radius: 4px; }
.top a:hover { color: var(--ink); background: var(--chrome-2); }
.top .brand { color: var(--ink); font-weight: 600; }
.top .sep { width: 1px; height: 16px; background: var(--rule-2); }
.top .crumb { color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.top .file { margin-left: auto; font: 12.5px/1 var(--mono); color: var(--ink-3); white-space: nowrap; }

.shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 40px; max-width: 1120px; margin: 0 auto; padding: 32px 24px 96px; }
.side { position: sticky; top: calc(var(--header-h) + 24px); align-self: start; display: flex; flex-direction: column; gap: 28px; max-height: calc(100vh - var(--header-h) - 48px); overflow-y: auto; }
.side nav { display: flex; flex-direction: column; border-left: 1px solid var(--rule); }
.side-heading { font-size: 12.5px; font-weight: 500; color: var(--ink-3); margin: 0 0 6px 12px; }
.side a { color: var(--ink-2); text-decoration: none; font-size: 13.5px; font-weight: 500; padding: 5px 12px; margin-left: -1px; border-left: 1px solid transparent; }
.side a:hover { color: var(--ink); border-left-color: var(--rule-2); }
.side a.current { color: var(--ink); border-left-color: var(--marker); }
.toc a { font-weight: 400; }
.toc a.l3 { padding-left: 24px; color: var(--ink-3); }

.doc { max-width: var(--measure); min-width: 0; }
.doc > :first-child { margin-top: 0; }
.doc h1 { font-size: 28px; font-weight: 600; line-height: 1.25; letter-spacing: -.01em; margin: 0 0 20px; }
.doc h2 { font-size: 22px; font-weight: 600; line-height: 1.3; margin: 48px 0 12px; padding-top: 16px; border-top: 1px solid var(--rule); }
.doc h3 { font-size: 17px; font-weight: 600; margin: 32px 0 8px; }
.doc h4 { font-size: 15px; font-weight: 600; margin: 24px 0 6px; }
.doc h1, .doc h2, .doc h3, .doc h4 { position: relative; scroll-margin-top: calc(var(--header-h) + 16px); }
.doc .anchor { position: absolute; left: -1.2em; top: 0; width: 1em; color: var(--ink-3); text-decoration: none; opacity: 0; font-weight: 400; }
.doc h1:hover .anchor, .doc h2:hover .anchor, .doc h3:hover .anchor, .doc h4:hover .anchor, .doc .anchor:focus-visible { opacity: 1; }
.doc p, .doc ul, .doc ol { margin: 0 0 14px; }
.doc ul, .doc ol { padding-left: 1.4em; }
.doc li { margin: 4px 0; }
.doc li > p { margin: 0 0 6px; }
.doc strong { font-weight: 600; }
.doc blockquote { margin: 16px 0; padding: 2px 0 2px 16px; border-left: 2px solid var(--marker); color: var(--ink-2); }
.doc blockquote p { margin: 0 0 8px; }
.doc blockquote p:last-child { margin: 0; }
.doc code { font-family: var(--mono); font-size: .875em; background: var(--chrome); border: 1px solid var(--rule); padding: 1px 5px; border-radius: 3px; }
.doc pre { background: var(--chrome); border-top: 1px solid var(--rule-2); border-bottom: 1px solid var(--rule); padding: 14px 16px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 16px 0 20px; }
.doc pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.doc pre.mermaid { background: var(--paper); border: 1px solid var(--rule); text-align: center; padding: 16px; }
.doc pre.mermaid svg { max-width: 100%; height: auto; }
.doc .table-wrap { overflow-x: auto; margin: 16px 0 20px; }
.doc table { border-collapse: collapse; width: 100%; font-size: 14.5px; line-height: 1.45; }
.doc th, .doc td { padding: 8px 10px; vertical-align: top; text-align: left; border-bottom: 1px solid var(--rule); }
.doc th { font-weight: 600; border-bottom: 1px solid var(--rule-2); }
.doc tr:last-child td { border-bottom: 1px solid var(--rule-2); }
.doc img { max-width: 100%; height: auto; border: 1px solid var(--rule); }
.doc figure.diagram { margin: 28px 0; cursor: zoom-in; border-radius: 4px; }
.doc figure.diagram:focus-visible, .doc pre.mermaid:focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; }
.doc pre.mermaid { cursor: zoom-in; }
.doc figure.diagram figcaption::after { content: ' · click to enlarge'; color: var(--ink-3); opacity: 0.7; }
body.lightbox-open { overflow: hidden; }
.lightbox { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(2px); }
.lightbox[hidden] { display: none; }
.lightbox-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--rule); background: var(--chrome); font-size: 13.5px; }
.lightbox-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.lightbox-zoom { font-family: var(--mono, 'IBM Plex Mono', monospace); font-size: 12.5px; color: var(--ink-3); min-width: 44px; text-align: right; }
.lightbox-bar button { min-height: 32px; min-width: 32px; padding: 0 10px; border: 1px solid var(--rule-2); border-radius: 4px; background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; }
.lightbox-bar button:hover { background: var(--chrome-2); }
.lightbox-bar button:focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; }
.lightbox-stage { flex: 1; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
.lightbox-stage.dragging { cursor: grabbing; }
.lightbox-inner { position: absolute; left: 0; top: 0; }
.lightbox-inner svg { display: block; border: 1px solid var(--rule); border-radius: 4px; background: var(--paper); }
.lightbox-hint { margin: 0; padding: 6px 12px; border-top: 1px solid var(--rule); background: var(--chrome); font-size: 12.5px; color: var(--ink-3); text-align: center; }
.doc figure.diagram svg { display: block; width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 4px; }
.doc figure.diagram figcaption { margin-top: 8px; font-size: 13px; color: var(--ink-3); }
.doc figure.diagram .only-dark { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .doc figure.diagram.has-dark .only-light { display: none; }
  :root:not([data-theme='light']) .doc figure.diagram.has-dark .only-dark { display: block; }
}
:root[data-theme='dark'] .doc figure.diagram.has-dark .only-light { display: none; }
:root[data-theme='dark'] .doc figure.diagram.has-dark .only-dark { display: block; }
.doc hr { border: 0; border-top: 1px solid var(--rule); margin: 40px 0; }
.doc hr + h2 { border-top: 0; padding-top: 0; margin-top: -8px; }
.lede { color: var(--ink-2); font-size: 17px; }
.doc-list { list-style: none; padding: 0; margin: 24px 0 0; counter-reset: doc; }
.doc-list li { display: flex; align-items: baseline; gap: 12px; padding: 12px 0; border-top: 1px solid var(--rule); }
.doc-list li:last-child { border-bottom: 1px solid var(--rule); }
.doc-list a { font-weight: 500; text-decoration: none; }
.doc-list a:hover { text-decoration: underline; }
.doc-list .slug { margin-left: auto; color: var(--ink-3); font: 12.5px/1 var(--mono); }

@media (max-width: 860px) {
  .shell { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 20px 16px 64px; }
  .side { position: static; max-height: none; overflow: visible; gap: 12px; min-width: 0; }
  .side nav { flex-direction: row; flex-wrap: wrap; gap: 6px; border-left: 0; }
  .side .side-heading, .side .toc { display: none; }
  .side a { border: 1px solid var(--rule); border-radius: 4px; margin: 0; padding: 8px 12px; min-height: 40px; display: inline-flex; align-items: center; max-width: 100%; overflow-wrap: anywhere; }
  .doc pre, .doc .table-wrap { max-width: calc(100vw - 32px); }
  .side a.current { border-color: var(--marker); color: var(--marker); }
  .doc h1 { font-size: 24px; }
  .doc h2 { font-size: 20px; margin-top: 36px; }
  .doc .anchor { display: none; }
  .top .crumb, .top .file { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .side a, .top a, a { transition: color 160ms ease-out, border-color 160ms ease-out, background-color 160ms ease-out; }
}
`

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
