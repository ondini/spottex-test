#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
run_dir="$(mktemp -d)"
manifest="$run_dir/manifest.json"
finished=false

cleanup() {
  status=$?
  if [[ "$finished" != true && -f "$manifest" ]]; then
    cd "$repo_dir"
    npx tsx scripts/invoice-agent/mark-failed.ts "$manifest" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$run_dir"
  exit "$status"
}
trap cleanup EXIT

cd "$repo_dir"
set +e
npx tsx scripts/invoice-agent/export-next.ts "$run_dir"
claim_status=$?
set -e
if [[ "$claim_status" -eq 3 ]]; then
  finished=true
  exit 0
fi
if [[ "$claim_status" -ne 0 ]]; then exit "$claim_status"; fi

mime_type="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.mimeType)' "$manifest")"
document_path="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.documentPath)' "$manifest")"
output="$run_dir/output.json"

if [[ "$mime_type" == "application/pdf" ]]; then
  pdftotext -layout "$document_path" "$run_dir/invoice.txt"
  head -c 200000 "$run_dir/invoice.txt" > "$run_dir/invoice-limited.txt"
  {
    cat "$script_dir/prompt.md"
    printf '\n\n--- ZAČÁTEK TEXTU FAKTURY ---\n'
    cat "$run_dir/invoice-limited.txt"
    printf '\n--- KONEC TEXTU FAKTURY ---\n'
  } | codex exec --ephemeral --ignore-user-config --sandbox read-only --skip-git-repo-check --cd "$run_dir" --output-schema "$script_dir/output.schema.json" --output-last-message "$output" -
else
  codex exec --ephemeral --ignore-user-config --sandbox read-only --skip-git-repo-check --cd "$run_dir" --image "$document_path" --output-schema "$script_dir/output.schema.json" --output-last-message "$output" - < "$script_dir/prompt.md"
fi

cd "$repo_dir"
npx tsx scripts/invoice-agent/import-draft.ts "$manifest" "$output"
finished=true
