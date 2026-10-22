#!/usr/bin/env node
// scripts/site-release-notes.mjs — the website's release notes, made from CHANGELOG.md (no dependencies).
//
//   node scripts/site-release-notes.mjs            writes site/releases/index.html (every released version, newest
//                                                  first) and refreshes the "What's new" block of site/index.html
//                                                  and site/zh-TW/index.html (between <!-- whats-new:start --> and
//                                                  <!-- whats-new:end -->) from the latest version
//   node scripts/site-release-notes.mjs --check    the same, but writes nothing: fails when CHANGELOG.md cannot be read
//
// .github/workflows/pages.yml runs it before uploading site/, so the published notes follow CHANGELOG.md by
// themselves. site/releases/ is generated, not committed (.gitignore): to preview the site locally, run this
// script once, then open site/index.html (or serve site/ with any static server).
//
// The changelog is text written by people and agents: every piece of it is HTML-escaped before it goes on the page;
// links keep only http(s) URLs and repository paths.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = 'https://github.com/river0825/unprose'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** HTML-escape text (also safe inside a double- or single-quoted attribute). */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c])

/** `0.28.0` → `v0-28-0`, the anchor of a version on the release notes page. */
export const anchorOf = (version) => `v${version.replace(/[^0-9A-Za-z]+/g, '-')}`

/** Where a link in the changelog may point: http(s) URLs, `#anchors`, and paths in the repository (made absolute). */
function safeHref(url) {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('#')) return u
  if (/^[A-Za-z0-9_./-]+(#[A-Za-z0-9_-]+)?$/.test(u) && !u.includes('..')) return `${REPO}/blob/main/${u.replace(/^\.?\//, '')}`
  return null
}

/**
 * Inline markdown → HTML: `code`, **bold**, *emphasis*, [text](url), owner/repo#123 issue references and
 * docs/<name>.md paths. Everything else is escaped text.
 */
export function inline(md) {
  // code spans first, out of the way of every other rule (bold may wrap one: **Set `X=1`**), as private-use markers
  const codes = []
  const text = String(md)
    .replace(/[\uE000\uE001]/g, '')
    .replace(/(`+)([\s\S]*?)\1/g, (_, ticks, code) => `\uE000${codes.push(code.trim() || code) - 1}\uE001`)
  return inlineText(text).replace(/\uE000(\d+)\uE001/g, (_, n) => `<code>${escapeHtml(codes[+n])}</code>`)
}

function inlineText(text) {
  if (!text) return ''
  // links first, on the raw text, so their URLs are handled whole
  const pieces = []
  const linkRe = /\[([^\]\n]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m; (m = linkRe.exec(text)); ) {
    pieces.push(decorate(text.slice(last, m.index)))
    const href = safeHref(m[2])
    pieces.push(href ? `<a href="${escapeHtml(href)}">${decorate(m[1], false)}</a>` : decorate(m[1]))
    last = m.index + m[0].length
  }
  pieces.push(decorate(text.slice(last)))
  return pieces.join('')
}

/** Escaped text with bold, emphasis, and (unless inside a link already) issue references and docs paths. */
function decorate(raw, links = true) {
  let s = escapeHtml(raw)
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
  if (!links) return s
  s = s.replace(/\b(river0825\/unprose)#(\d+)\b/g, (_, repo, n) => `<a href="https://github.com/${repo}/issues/${n}">${repo}#${n}</a>`)
  s = s.replace(/(^|[\s(])(docs\/[A-Za-z0-9_-]+\.md)\b/g, (_, pre, p) => `${pre}<a href="${REPO}/blob/main/${p}">${p}</a>`)
  return s
}

// ── blocks ────────────────────────────────────────────────────────────────────────────────────────

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const indentOf = (line) => line.match(/^\s*/)[0].length

/** Markdown blocks of a changelog section: paragraphs, (nested) lists, block quotes. */
export function parseBlocks(lines) {
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^\s*>/.test(line)) {
      const quoted = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*> ?/, ''))
      blocks.push({ type: 'quote', blocks: parseBlocks(quoted) })
      continue
    }
    const m = line.match(LIST)
    if (m) {
      const base = m[1].length
      const ordered = /\d/.test(m[2])
      const items = []
      while (i < lines.length) {
        // blank lines between two items of one list do not end it
        let k = i
        while (k < lines.length && !lines[k].trim()) k++
        if (k > i && k < lines.length && (lines[k].match(LIST)?.[1].length ?? -1) === base) i = k
        const im = lines[i].match(LIST)
        if (!im || im[1].length !== base || /\d/.test(im[2]) !== ordered) break
        const body = [im[3]]
        i++
        // the item goes on while lines are indented deeper than its marker (continuations and nested lists)
        while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) body.push(lines[i++])
        items.push(parseItem(body, base))
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) para.push(lines[i++].trim())
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    else blocks.push({ type: 'p', text: lines[i++].replace(/^#+\s*/, '') })
  }
  return blocks
}

function parseItem(body, base) {
  const text = [body[0].trim()]
  let j = 1
  while (j < body.length && !LIST.test(body[j])) text.push(body[j++].trim())
  const rest = body.slice(j)
  const inner = rest.length ? Math.min(...rest.map(indentOf)) : base + 2
  return { text: text.join(' '), children: rest.length ? parseBlocks(rest.map((l) => l.slice(Math.min(inner, indentOf(l))))) : [] }
}

export function renderBlocks(blocks) {
  return blocks
    .map((b) => {
      if (b.type === 'p') return `<p>${inline(b.text)}</p>`
      if (b.type === 'quote') return `<blockquote>${renderBlocks(b.blocks)}</blockquote>`
      const tag = b.type
      return `<${tag}>${b.items.map((it) => `<li>${inline(it.text)}${it.children.length ? renderBlocks(it.children) : ''}</li>`).join('')}</${tag}>`
    })
    .join('\n')
}

// ── the changelog ─────────────────────────────────────────────────────────────────────────────────

const VERSION_HEAD = /^## \[([^\]]+)\](?:\s*[—–-]+\s*(\d{4}-\d{2}-\d{2}))?/
const LINK_DEF = /^\[[^\]]+\]:\s*\S+/

/**
 * CHANGELOG.md (Keep a Changelog) → `[{ version, date, intro: Block[], sections: [{ title, blocks }] }]` in file order
 * (newest first). `[Unreleased]` is left out unless `unreleased: true`.
 */
export function parseChangelog(text, { unreleased = false } = {}) {
  const versions = []
  let cur = null
  let section = null
  let buf = []
  const flush = () => {
    if (!cur) return
    const blocks = parseBlocks(buf)
    if (section) section.blocks = blocks
    else cur.intro = blocks
    buf = []
  }
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const vh = line.match(VERSION_HEAD)
    if (vh) {
      flush()
      section = null
      cur = { version: vh[1].trim(), date: vh[2] ?? null, intro: [], sections: [] }
      versions.push(cur)
      continue
    }
    if (!cur) continue
    if (LINK_DEF.test(line)) continue
    const sh = line.match(/^###\s+(.+)$/)
    if (sh) {
      flush()
      section = { title: sh[1].trim(), blocks: [] }
      cur.sections.push(section)
      continue
    }
    buf.push(line)
  }
  flush()
  return versions.filter((v) => unreleased || !/^unreleased$/i.test(v.version))
}

/** The headline of a bullet: its leading **bold** run, without a closing period or colon; else its first sentence. */
export function headlineOf(itemText) {
  const bold = itemText.match(/^\*\*([\s\S]+?)\*\*/)
  const head = bold ? bold[1] : itemText.split(/(?<=[.!?])\s/)[0]
  return head.replace(/[.:]\s*$/, '').trim()
}

/**
 * The latest version's highlights: the headlines of its top-level bullets under Added, then Changed (any other
 * section counts as Changed), at most `max`; a version with only fixes shows its fixes.
 */
export function highlights(version, max = 4) {
  const heads = (pick) =>
    version.sections
      .filter(pick)
      .flatMap((s) => s.blocks.filter((b) => b.type === 'ul' || b.type === 'ol').flatMap((b) => b.items.map((it) => headlineOf(it.text))))
      .filter(Boolean)
  const isFixed = (s) => /^fixed$/i.test(s.title)
  const main = [...heads((s) => /^added$/i.test(s.title)), ...heads((s) => !/^added$/i.test(s.title) && !isFixed(s))]
  return (main.length ? main : heads(isFixed)).slice(0, max)
}

const releaseUrl = (v) => `${REPO}/releases/tag/v${encodeURIComponent(v)}`

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────

const LOGO = '<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="14" height="12" rx="2" fill="#ffb648"/><rect x="15" y="15" width="14" height="12" rx="2" fill="#7dbdff"/></svg>'

/** site/releases/index.html: every version, newest first, each linked to its GitHub release. */
export function renderReleasesPage(versions, { generatedFrom = 'CHANGELOG.md' } = {}) {
  const latest = versions[0]
  const index = versions
    .map((v) => `<li><a href="#${anchorOf(v.version)}">${escapeHtml(v.version)}</a></li>`)
    .join('')
  const body = versions
    .map((v) => {
      const id = anchorOf(v.version)
      const sections = v.sections
        .map((s) => `<section class="rn-section"><h3>${escapeHtml(s.title)}</h3>\n${renderBlocks(s.blocks)}</section>`)
        .join('\n')
      return `<article class="rn-version" id="${id}" aria-labelledby="${id}-title">
<header class="rn-head"><h2 id="${id}-title"><a class="rn-anchor" href="#${id}">${escapeHtml(v.version)}</a></h2>${v.date ? `<time datetime="${escapeHtml(v.date)}">${escapeHtml(v.date)}</time>` : ''}<a class="rn-gh" href="${escapeHtml(releaseUrl(v.version))}">GitHub release<span class="visually-hidden"> v${escapeHtml(v.version)}</span></a></header>
${v.intro.length ? `<div class="rn-intro">${renderBlocks(v.intro)}</div>\n` : ''}${sections}
</article>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Release notes · Unprose</title>
<meta name="description" content="What each version of Unprose brought, newest first${latest ? ` (latest: ${escapeHtml(latest.version)})` : ''}.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="../assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="../">${LOGO}Unprose</a>
    <nav class="site-nav" aria-label="Main">
      <a href="../#start">Get started</a>
      <a href="./" aria-current="page">Release notes</a>
      <a href="${REPO}">GitHub</a>
      <a href="../zh-TW/" lang="zh-Hant-TW" hreflang="zh-Hant-TW">中文</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap rn">
  <h1>Release notes</h1>
  <p class="lede">What each version brought, newest first. Made from <a href="${REPO}/blob/main/${escapeHtml(generatedFrom)}">${escapeHtml(generatedFrom)}</a>; each version links to its GitHub release. The version in the canvas's bottom-left corner says <strong>update</strong> when a newer one is out.</p>
  <nav class="rn-index" aria-label="Versions"><h2 class="visually-hidden">Versions</h2><ul>${index}</ul></nav>
${body}
</main>
<footer class="site-footer">
  <div class="wrap foot-row">
    <p>Unprose is open source under the <a href="${REPO}/blob/main/LICENSE">Apache-2.0</a> license.</p>
    <p><a href="${REPO}/issues/new/choose">Report a problem or suggest a feature</a></p>
  </div>
</footer>
</body>
</html>
`
}

/** The "What's new" block of a home page: the latest version, its highlights, a link to all notes. */
export function renderWhatsNew(version, { releases, lang = 'en' }) {
  const id = anchorOf(version.version)
  const items = highlights(version).map((h) => `<li>${inline(h)}</li>`).join('')
  const all = lang === 'en' ? 'All release notes' : '所有版本的更新說明（英文）'
  const intro = lang === 'en' ? 'Version' : '版本'
  return `<p class="wn-head">${intro} <a href="${releases}#${id}"><strong>${escapeHtml(version.version)}</strong></a>${version.date ? `, <time datetime="${escapeHtml(version.date)}">${escapeHtml(version.date)}</time>` : ''}</p>
<ul class="wn-list"${lang === 'en' ? '' : ' lang="en"'}>${items}</ul>
<p class="wn-more"><a href="${releases}">${all}</a></p>`
}

const START = /<!-- whats-new:start -->[\s\S]*?<!-- whats-new:end -->/

/** Replace the marked block of a page; the page without markers is returned as it was. */
export function replaceWhatsNew(html, block) {
  return START.test(html) ? html.replace(START, () => `<!-- whats-new:start -->\n${block}\n<!-- whats-new:end -->`) : html
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const check = process.argv.includes('--check')
  const versions = parseChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'))
  if (!versions.length) throw new Error('CHANGELOG.md: no released version found ("## [x.y.z] — date")')
  const page = renderReleasesPage(versions)
  const pages = [
    { file: 'site/index.html', releases: 'releases/', lang: 'en' },
    { file: 'site/zh-TW/index.html', releases: '../releases/', lang: 'zh-Hant-TW' },
  ]
  if (check) {
    console.log(`release notes: ${versions.length} versions, latest ${versions[0].version} (${page.length} bytes) — nothing written`)
    return
  }
  const out = path.join(root, 'site/releases/index.html')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, page)
  for (const p of pages) {
    const file = path.join(root, p.file)
    if (!fs.existsSync(file)) continue
    const html = fs.readFileSync(file, 'utf8')
    const next = replaceWhatsNew(html, renderWhatsNew(versions[0], p))
    if (next !== html) fs.writeFileSync(file, next)
  }
  console.log(`release notes: ${versions.length} versions, latest ${versions[0].version} → site/releases/index.html; What's new refreshed`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
