#!/usr/bin/env node
// scripts/version.mjs <new version> — bump Unprose everywhere and cut the release notes.
//   - package.json (+ lockfile), .claude-plugin/plugin.json, .claude-plugin/marketplace.json, the MCP
//     server's version: `claude plugin update` only sees a new release when these change (unprose#3);
//   - CHANGELOG.md: "## [Unreleased]" becomes "## [<new>] — <today>", a fresh empty "## [Unreleased]"
//     goes above it, and the compare links at the bottom are updated.
// Then: commit, tag v<new>, push; the GitHub release uses the <new> section as its text.
import fs from 'node:fs'
import { CHANGELOG, REPO_URL, setVersion, versions } from './release-files.mjs'

const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error('usage: node scripts/version.mjs <major.minor.patch>')
  process.exit(1)
}
const prev = versions()['package.json']
if (prev === next) {
  console.error(`already at ${next}`)
  process.exit(1)
}

// 1. release notes first: fail before touching anything if the changelog is not in shape
let log = fs.readFileSync(CHANGELOG, 'utf8')
if (!log.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no "## [Unreleased]" section')
  process.exit(1)
}
if (log.includes(`## [${next}]`)) {
  console.error(`CHANGELOG.md already has a [${next}] section`)
  process.exit(1)
}
const today = new Date().toISOString().slice(0, 10)
log = log.replace('## [Unreleased]', `## [Unreleased]\n\n## [${next}] — ${today}`)
const links = log.match(/^\[Unreleased\]: .*$/m)
const release = `[${next}]: ${REPO_URL}/compare/v${prev}...v${next}`
log = links
  ? log.replace(links[0], `[Unreleased]: ${REPO_URL}/compare/v${next}...HEAD\n${release}`)
  : `${log.trimEnd()}\n\n[Unreleased]: ${REPO_URL}/compare/v${next}...HEAD\n${release}\n`
fs.writeFileSync(CHANGELOG, log)

// 2. every version field
setVersion(next)
console.log(`${prev} → ${next}`)
for (const [where, v] of Object.entries(versions())) console.log(`  ${v === next ? '✔' : '✖'} ${where}: ${v}`)
console.log(`next: git commit -am "release v${next}" && git tag v${next} && git push --follow-tags`)
