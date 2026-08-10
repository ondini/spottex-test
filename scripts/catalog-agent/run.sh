#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
run_dir="$(mktemp -d)"
trap 'rm -rf -- "$run_dir"' EXIT

codex exec \
  --ephemeral \
  --ignore-user-config \
  --sandbox read-only \
  --cd "$repo_dir" \
  --output-schema "$script_dir/candidate.schema.json" \
  --output-last-message "$run_dir/candidates.json" \
  - < "$script_dir/prompt.md"

cd "$repo_dir"
npx tsx scripts/catalog-agent/import-candidates.ts "$run_dir/candidates.json"
