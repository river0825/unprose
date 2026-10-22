// The website's release notes (scripts/site-release-notes.mjs): CHANGELOG.md → site/releases/index.html and the
// home pages' "What's new". The changelog is text, so everything taken from it must reach the page escaped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anchorOf, escapeHtml, highlights, inline, parseBlocks, parseChangelog, renderBlocks, renderReleasesPage, renderWhatsNew, replaceWhatsNew,
} from '../site-release-notes.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))

test('the current CHANGELOG.md renders: every released version, newest first, each linked to its GitHub release', () => {
  const versions = parseChangelog(changelog)
  assert.ok(versions.length > 10)
  assert.equal(versions[0].version, pkg.version, 'the latest section is the current version')
  assert.ok(versions.every((v) => /^\d+\.\d+\.\d+/.test(v.version) && /^\d{4}-\d{2}-\d{2}$/.test(v.date)), 'no [Unreleased], every version dated')
  assert.ok(versions.every((v) => v.sections.length || v.intro.length), 'no version renders empty')
  const html = renderReleasesPage(versions)
  for (const v of versions) {
    assert.ok(html.includes(`id="${anchorOf(v.version)}"`), `anchor for ${v.version}`)
    assert.ok(html.includes(`https://github.com/river0825/unprose/releases/tag/v${v.version}`), `release link for ${v.version}`)
  }
  assert.doesNotMatch(html, /<script|\son\w+=/i, 'nothing from the changelog runs')
  assert.doesNotMatch(html.replace(/<code>[\s\S]*?<\/code>/g, ''), /\*\*|`/, 'no markdown left over (outside code)')
  // the home pages' block
  const block = renderWhatsNew(versions[0], { releases: 'releases/', lang: 'en' })
  assert.ok(block.includes(`releases/#${anchorOf(versions[0].version)}`))
  assert.ok(highlights(versions[0]).length > 0)
})

test('HTML in the changelog is escaped, and links keep only http(s) and repository paths', () => {
  const md = `# Changelog

## [Unreleased]

### Added
- **not released** yet

## [9.9.9] — 2030-01-02

> **Read this <b>first</b>.** a "quote" & more
> 1. one
> 2. two

### Added
- **A <script>alert(1)</script> headline.** with \`<img src=x onerror=alert(1)>\` in code
  and a [bad link](javascript:alert(1)) and a [good one](https://example.com/?a=1&b="2") and [a doc](docs/canvas.md#x)
  - nested <i>item</i> about river0825/unprose#12
- *emphasis* and "quotes" and 'apostrophes'

### Fixed
- <img src=x onerror=alert(2)>

[9.9.9]: https://example.com/compare
`
  const versions = parseChangelog(md)
  assert.deepEqual(versions.map((v) => v.version), ['9.9.9'], '[Unreleased] is left out')
  const html = renderReleasesPage(versions)
  assert.doesNotMatch(html, /<script>|<img|<b>first|<i>item/)
  assert.doesNotMatch(html, /href="javascript:/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /<code>&lt;img src=x onerror=alert\(1\)&gt;<\/code>/)
  assert.match(html, /<a href="https:\/\/example\.com\/\?a=1&amp;b=&quot;2&quot;">good one<\/a>/)
  assert.match(html, /<a href="https:\/\/github\.com\/river0825\/unprose\/blob\/main\/docs\/canvas\.md#x">a doc<\/a>/)
  assert.match(html, /<a href="https:\/\/github\.com\/river0825\/unprose\/issues\/12">river0825\/unprose#12<\/a>/)
  assert.match(html, /<blockquote><p><strong>Read this &lt;b&gt;first&lt;\/b&gt;\.<\/strong> a &quot;quote&quot; &amp; more<\/p>\n<ol><li>one<\/li><li>two<\/li><\/ol><\/blockquote>/)
  assert.match(html, /<li><em>emphasis<\/em> and &quot;quotes&quot; and &#39;apostrophes&#39;<\/li>/)
  assert.doesNotMatch(html, /example\.com\/compare/, 'link definitions are not text')
  assert.deepEqual(highlights(versions[0]), ['A <script>alert(1)</script> headline', '*emphasis* and "quotes" and \'apostrophes\''])
  const block = renderWhatsNew(versions[0], { releases: '../releases/', lang: 'zh-Hant-TW' })
  assert.doesNotMatch(block, /<script>/)
  assert.match(block, /<ul class="wn-list" lang="en">/)
})

test('lists: continuation lines join the item, deeper bullets nest, blank lines inside a list keep it one list', () => {
  const blocks = parseBlocks(['- **One** first line', '  goes on here', '  - a nested one', '    that wraps', '', '- Two', 'A paragraph', 'that wraps.'])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'ul')
  assert.equal(blocks[0].items.length, 2)
  assert.equal(blocks[0].items[0].text, '**One** first line goes on here')
  assert.equal(blocks[0].items[0].children[0].items[0].text, 'a nested one that wraps')
  assert.deepEqual(blocks[1], { type: 'p', text: 'A paragraph that wraps.' })
  assert.equal(renderBlocks(blocks), '<ul><li><strong>One</strong> first line goes on here<ul><li>a nested one that wraps</li></ul></li><li>Two</li></ul>\n<p>A paragraph that wraps.</p>')
})

test('inline: bold may wrap code; code is never decorated', () => {
  assert.equal(inline('**Set `A=<b>`** now'), '<strong>Set <code>A=&lt;b&gt;</code></strong> now')
  assert.equal(inline('`**not bold**` and `docs/x.md`'), '<code>**not bold**</code> and <code>docs/x.md</code>')
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
})

test("What's new: only the marked block of a page changes", () => {
  const page = 'before\n<!-- whats-new:start -->\nold\n<!-- whats-new:end -->\nafter $& $1'
  assert.equal(replaceWhatsNew(page, 'new $&'), 'before\n<!-- whats-new:start -->\nnew $&\n<!-- whats-new:end -->\nafter $& $1')
  assert.equal(replaceWhatsNew('no markers', 'x'), 'no markers')
  // the committed pages carry the markers the workflow fills
  for (const f of ['site/index.html', 'site/zh-TW/index.html']) {
    const html = fs.readFileSync(path.join(repo, f), 'utf8')
    assert.match(html, /<!-- whats-new:start -->[\s\S]*<!-- whats-new:end -->/, f)
    assert.match(html, /<span data-version><\/span>/, `${f}: the version hook pages.yml fills`)
  }
})
