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
# The deploy and interact captures read logs written by `npm run deploy` /
# `npm run interact`. To refresh them, run those first, then run this script.
#
# Point the script at logs other than the defaults with:
#
#   UMBRAPAY_DEPLOY_LOG           preview deploy log  → 04-deploy-preview.txt
#   UMBRAPAY_DEPLOY_LOG_PREPROD   preprod deploy log  → 05-deploy-preprod.txt
#   UMBRAPAY_INTERACT_LOG         interact log        → 06-interact-<network>.txt
#   UMBRAPAY_INTERACT_NETWORK     network label for 06 (default: preview)
#
# A capture whose log is missing is skipped, and the committed file is left
# alone, so a partial environment never overwrites real evidence with nothing.

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

# Clean a run log for publication: drop the noisy sync/progress chatter, and
# redact anything that looks like a 24-word BIP-39 recovery phrase. The phrase
# must never reach a committed file.
scrub() {
  sed -E \
    -e 's/^[[:space:]]*([a-z]+[[:space:]]){23}[a-z]+[[:space:]]*$/    [REDACTED - 24-word recovery phrase, written to .midnight-state.json]/' \
    -e 's/^\r//' \
    -e '/Still syncing/d' \
    -e '/RPC-CORE/d' \
    -e '/still waiting/d' \
    -e '/^> /d' \
    "$1" | grep -vE '^[[:space:]]*$'
}

# Refuse to publish a capture that still contains a recovery phrase.
guard_phrase() {
  if grep -qE '([a-z]+ ){23}[a-z]+' "$1"; then
    echo "  !!! recovery phrase still present in $1 — refusing to continue" >&2
    rm -f "$1"
    exit 1
  fi
}

# $1 network, $2 log, $3 output file
capture_deploy() {
  local net="$1" log="$2" out="$3"
  if [ ! -f "$log" ]; then
    echo "  skipping $out: $log not found" >&2
    return 0
  fi
  echo "  capturing: deploy log $net ($log)"
  {
    echo "\$ npm run deploy -- --network $net"
    echo
    scrub "$log"
    # A run that reached the funding gate stops there; a completed deploy has
    # nothing more to say, so do not stub a progress line onto it.
    if ! grep -q 'Deployment complete' "$log"; then
      echo '  ...still waiting (polling every 10s)'
    fi
  } >"$out"
  guard_phrase "$out"
}

capture_deploy preview "${UMBRAPAY_DEPLOY_LOG:-/tmp/umbrapay-deploy.log}" screenshots/04-deploy-preview.txt
capture_deploy preprod "${UMBRAPAY_DEPLOY_LOG_PREPROD:-/tmp/umbrapay-deploy-preprod.log}" screenshots/05-deploy-preprod.txt

# The interaction capture is the strongest evidence in this repository: it shows
# a real circuit call landing on chain and the ledger moving by the private
# amount only.
INTERACT_NET="${UMBRAPAY_INTERACT_NETWORK:-preview}"
INTERACT_LOG="${UMBRAPAY_INTERACT_LOG:-/tmp/umbrapay-interact.log}"
if [ -f "$INTERACT_LOG" ]; then
  echo "  capturing: interact log $INTERACT_NET ($INTERACT_LOG)"
  {
    echo "\$ npm run interact -- --network $INTERACT_NET"
    echo
    scrub "$INTERACT_LOG"
  } >"screenshots/06-interact-${INTERACT_NET}.txt"
  guard_phrase "screenshots/06-interact-${INTERACT_NET}.txt"
else
  echo "  skipping interact capture: $INTERACT_LOG not found" >&2
fi

echo "  done — now run: node scripts/make-screenshots.mjs"
