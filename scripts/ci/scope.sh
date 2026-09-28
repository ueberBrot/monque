#!/usr/bin/env bash
set -euo pipefail

runtime=true
paths=$(mktemp)
trap 'rm -f "$paths"' EXIT

# Use the actual PR base or push's previous commit. Missing history runs all checks.
if [[ ${BASE_SHA:-} =~ ^[a-f0-9]{40}$ && ! $BASE_SHA =~ ^0+$ ]] &&
  git fetch --no-tags --depth=1 origin "$BASE_SHA" &&
  git diff --name-only --no-renames -z "$BASE_SHA" HEAD -- > "$paths" &&
  [[ -s "$paths" ]]; then
  runtime=false
  # Disabling rename detection includes both sides of moves out of runtime paths.
  while IFS= read -r -d '' path; do
    case "$path" in
      apps/docs/* | docs/*.md | docs/*.mdx | .changeset/*.md) continue ;;
    esac
    if [[ $path != */* && $path == *.md ]]; then continue; fi
    runtime=true
    break
  done < "$paths"
fi

echo "runtime=$runtime" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
echo "Runtime checks required: $runtime"
