#!/usr/bin/env bash
#
# Capture real command output into screenshots/*.txt.
#
#   ./scripts/capture-screenshots.sh && node scripts/make-screenshots.mjs
#
# Run this after any change to the contract or the deploy path so the images in
# the README stay truthful. Requires the Compact toolchain on PATH:
#
#   source $HOME/.local/bin/env
#
# The deploy capture reads the log written by `npm run deploy`. To refresh it,
# deploy first, then run this script.

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p screenshots

if ! command -v compact >/dev/null 2>&1; then
  echo "compact not found on PATH. Run: source \$HOME/.local/bin/env" >&2
  exit 1
fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

echo "  capturing: compact compile"
{
  echo '$ compact compile contracts/counter.compact managed/counter'
  compact compile contracts/counter.compact "$SCRATCH/managed" 2>&1
  echo
  echo '$ compact compile --version'
  compact compile --version
} >screenshots/01-compact-compile.txt

echo "  capturing: managed/ artifacts"
{
  echo '$ find managed/counter -type f | sort'
  find managed/counter -type f | sort
  echo
  echo '$ du -sh managed/'
  du -sh managed/
} >screenshots/02-managed-artifacts.txt

echo "  capturing: test run"
{
  echo '$ npm test'
  # Strip ANSI colour codes so the rendered image has no escape sequences.
  npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -vE '^[[:space:]]*$'
} >screenshots/03-test-run.txt

LOG="${UMBRAPAY_DEPLOY_LOG:-/tmp/umbrapay-deploy.log}"
if [ -f "$LOG" ]; then
  echo "  capturing: deploy log ($LOG)"
  {
    echo '$ npm run deploy -- --network preview'
    echo
    # The recovery phrase must never reach a committed file. Redact any line
    # that looks like a 24-word BIP-39 phrase, and drop the noisy sync progress.
    sed -E \
      -e 's/^[[:space:]]*([a-z]+[[:space:]]){23}[a-z]+[[:space:]]*$/    [REDACTED - 24-word recovery phrase, written to .midnight-state.json]/' \
      -e '/Still syncing/d' \
      -e '/RPC-CORE/d' \
      -e '/still waiting/d' \
      -e '/^> /d' \
      "$LOG" | grep -vE '^[[:space:]]*$'
    echo '  ...still waiting (polling every 10s)'
  } >screenshots/04-deploy-preview.txt

  if grep -qE '([a-z]+ ){23}[a-z]+' screenshots/04-deploy-preview.txt; then
    echo "  !!! recovery phrase still present in capture — refusing to continue" >&2
    rm -f screenshots/04-deploy-preview.txt
    exit 1
  fi
else
  echo "  skipping deploy capture: $LOG not found (deploy first, or set UMBRAPAY_DEPLOY_LOG)" >&2
fi

echo "  done — now run: node scripts/make-screenshots.mjs"
