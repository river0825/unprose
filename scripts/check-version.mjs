#!/usr/bin/env node
// scripts/check-version.mjs [--since-tag] — fail when the release is inconsistent (unprose#3):
//   - package.json, the lockfile, .claude-plugin/plugin.json, marketplace.json and the MCP server
//     must carry the same version;
//   - CHANGELOG.md must have a "## [<version>]" section for it;
//   - with --since-tag (CI on pull requests): if what ships changed since the latest v* tag
//     (packages/, skills/, hooks/, .claude-plugin/, .mcp.json, the launcher scripts) the version must differ from
//     that tag, or `claude plugin update` would never pick the change up.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CHANGELOG, root, versions } from './release-files.mjs'

const found = versions()
const version = found['package.json']
const problems = []
for (const [where, v] of Object.entries(found)) if (v !== version) problems.push(`${where} says ${v}, package.json says ${version}`)
if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(fs.readFileSync(CHANGELOG, 'utf8')))
  problems.push(`CHANGELOG.md has no "## [${version}]" section (run scripts/version.mjs <new> to cut one)`)

if (process.argv.includes('--since-tag')) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let tag = ''
  try {
    tag = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
  } catch {
    // no release tag yet: nothing to compare with
  }
  if (tag) {
    const shipped = git('diff', '--name-only', `${tag}..HEAD`, '--', 'packages', 'skills', 'hooks', '.claude-plugin', '.mcp.json', 'scripts/mcp.mjs', 'scripts/runtime.mjs', 'scripts/ensure.mjs', 'scripts/entry.mjs', 'scripts/canvas.mjs', 'scripts/awd.mjs').split('\n').filter(Boolean)
    if (shipped.length && tag === `v${version}`)
      problems.push(`${shipped.length} shipped file(s) changed since ${tag} but the version is still ${version} — bump it with scripts/version.mjs (e.g. ${shipped.slice(0, 3).join(', ')})`)
  }
}

if (problems.length) {
  console.error(`version check failed:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`version ${version}: consistent${process.argv.includes('--since-tag') ? ', bumped since the last tag' : ''}`)
