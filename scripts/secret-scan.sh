#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'sk-proj-[A-Za-z0-9_-]{20,}'
  'sk-[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  'AKIA[0-9A-Z]{16}'
  'AIza[0-9A-Za-z_-]{35}'
  'xox[baprs]-[A-Za-z0-9-]{20,}'
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
  '-----BEGIN PRIVATE KEY-----'
  '-----BEGIN RSA PRIVATE KEY-----'
  '-----BEGIN DSA PRIVATE KEY-----'
  '-----BEGIN EC PRIVATE KEY-----'
  '-----BEGIN OPENSSH PRIVATE KEY-----'
)

failed=0

scan_pattern() {
  local pattern="$1"

  if [[ -e .git ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git grep --untracked -nIE -e "$pattern" -- . ':!bun.lock' ':!scripts/secret-scan.sh' ':!test/**'
    return $?
  fi

  if command -v rg >/dev/null 2>&1; then
    rg -nI --hidden --no-ignore \
      --glob '!bun.lock' \
      --glob '!scripts/secret-scan.sh' \
      --glob '!test/**' \
      --glob '!node_modules/**' \
      --glob '!.git/**' \
      --glob '!.bun/**' \
      -e "$pattern" .
    return $?
  fi

  grep -RInE \
    --exclude='bun.lock' \
    --exclude='secret-scan.sh' \
    --exclude-dir='.git' \
    --exclude-dir='.bun' \
    --exclude-dir='node_modules' \
    --exclude-dir='test' \
    "$pattern" .
}

for pattern in "${patterns[@]}"; do
  set +e
  matches=$(scan_pattern "$pattern")
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "$matches"
    failed=1
  elif [[ "$status" -ne 1 ]]; then
    echo "Secret scan failed while checking pattern: $pattern" >&2
    exit "$status"
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "Potential secret pattern found. Review the matches." >&2
  exit 1
fi

if [[ -e .git ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "No common secret patterns found in tracked or untracked release-candidate files."
else
  echo "No common secret patterns found in source files."
fi
