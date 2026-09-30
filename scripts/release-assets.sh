#!/usr/bin/env bash
# scripts/release-assets.sh <version> [public-repo-dir] [--no-upload]
# Package the plugin runtime of a release — the public repo's dist/ (awd.mjs, canvas.mjs, web/, CHANGELOG.md,
# package.json) — as unprose-runtime-v<version>.tgz + .sha256 and attach both to the GitHub release v<version>.
# An installed plugin downloads this when its copy has no dist/ (scripts/runtime.mjs → downloadRuntime).
# Run after `gh release create v<version>` (docs/releasing.md). Idempotent: re-uploads with --clobber.
set -euo pipefail
version="${1:?usage: scripts/release-assets.sh <version> [public-repo-dir] [--no-upload]}"
repo_dir="${2:-$HOME/Documents/unprose}"
upload=1
for a in "$@"; do [ "$a" = "--no-upload" ] && upload=0; done
[ "${2:-}" = "--no-upload" ] && repo_dir="$HOME/Documents/unprose"

dist="$repo_dir/dist"
[ -f "$dist/canvas.mjs" ] && [ -f "$dist/awd.mjs" ] || { echo "release-assets: no dist/ runtime in $repo_dir — run scripts/export-public.sh first" >&2; exit 1; }
have="$(node -e "console.log(require('$dist/package.json').version)" 2>/dev/null || true)"
[ "$have" = "$version" ] || { echo "release-assets: $dist is v${have:-?}, not v$version" >&2; exit 1; }

out="$(mktemp -d)"
name="unprose-runtime-v$version.tgz"
tar -czf "$out/$name" -C "$dist" .
( builtin cd "$out" && shasum -a 256 "$name" > "$name.sha256" )
echo "built $out/$name ($(du -h "$out/$name" | cut -f1)) and $name.sha256"
if [ "$upload" = 1 ]; then
  gh release upload "v$version" "$out/$name" "$out/$name.sha256" --clobber -R river0825/unprose
  echo "uploaded to https://github.com/river0825/unprose/releases/tag/v$version"
else
  echo "(--no-upload: not attached)"
fi
