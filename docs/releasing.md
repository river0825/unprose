# Releasing

Claude Code (and other plugin hosts) decide whether a plugin has an update by its **version**, so every
release that changes what ships must bump it — otherwise `claude plugin update unprose@unprose` answers
"already at the latest version" and keeps the old code.

1. While working, add a line under `## [Unreleased]` in `CHANGELOG.md` (### Added / Changed / Fixed).
2. Cut the release: `node scripts/version.mjs 0.3.0` (or `npm run version:bump -- 0.3.0`). It writes the
   version into `package.json` (+ lockfile), `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
   and the MCP server, turns `## [Unreleased]` into `## [0.3.0] — <date>` with a fresh `## [Unreleased]`
   above it, and updates the compare links.
3. `git commit -am "release v0.3.0" && git tag v0.3.0 && git push --follow-tags`, then create the GitHub
   release from the tag with the `## [0.3.0]` section as its text.

Checks:

- `npm test` starts with `node scripts/check-version.mjs`: every version field agrees and `CHANGELOG.md`
  has a section for the current version.
- CI (`.github/workflows/ci.yml`) builds and tests on Ubuntu and macOS (Node 20 and 22) with `npm ci`, and
  on pull requests runs `check-version.mjs --since-tag`: if `packages/`, `skills/`, `.claude-plugin/`,
  `.mcp.json` or `scripts/mcp.mjs` changed since the latest `v*` tag, the version must differ from it.
