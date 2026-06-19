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

for pattern in "${patterns[@]}"; do
  set +e
  matches=$(git grep -nIE -e "$pattern" -- . ':!bun.lock' ':!scripts/secret-scan.sh')
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

echo "No common secret patterns found in tracked files."
