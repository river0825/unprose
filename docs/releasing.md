# Releasing

Claude Code (and other plugin hosts) decide whether a plugin has an update by its **version**, so every
release that changes what ships must bump it — otherwise `claude plugin update unprose@unprose` answers
"already at the latest version" and keeps the old code.

1. While working, add a line under `## [Unreleased]` in `CHANGELOG.md` (### Added / Changed / Fixed).
2. Cut the release: `node scripts/version.mjs 0.3.0` (or `npm run version:bump -- 0.3.0`). It writes the
   version into `package.json` (+ lockfile), `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
   and the MCP server, turns `## [Unreleased]` into `## [0.3.0] — <date>` with a fresh `## [Unreleased]`
   above it, and updates the compare links.
3. `git commit -am "release v0.3.0" && git tag v0.3.0 && git push --follow-tags`, then export
   (`scripts/export-public.sh ~/Documents/unprose`), push the public repo, tag it `v0.3.0`, and create the
   GitHub release from the tag with the `## [0.3.0]` section as its text.
4. **Attach the plugin runtime** to the release: `scripts/release-assets.sh 0.3.0` packages the public
   repo's `dist/` as `unprose-runtime-v0.3.0.tgz` + `.sha256` and uploads both (`gh release upload
   --clobber`). An installed plugin whose copy has no `dist/` downloads exactly this file for its version
   (`scripts/runtime.mjs`), so **a release without it cannot self-heal**. The public repo's
   `.github/workflows/release-assets.yml` also attaches it when a release is published, as a safety net.

Checks:

- `npm test` starts with `node scripts/check-version.mjs`: every version field agrees and `CHANGELOG.md`
  has a section for the current version.
- CI (`.github/workflows/ci.yml`) builds and tests on Ubuntu and macOS (Node 20 and 22) with `npm ci`, and
  on pull requests runs `check-version.mjs --since-tag`: if `packages/`, `skills/`, `hooks/`,
  `.claude-plugin/`, `.mcp.json` or the launcher scripts changed since the latest `v*` tag, the version must
  differ from it.
- `scripts/export-public.sh` fails if any ignore rule in the public tree matches `dist/` (`git check-ignore`):
  0.3.0 was installed without its runtime because a `dist/` + `!/dist/` re-include was not honoured.
