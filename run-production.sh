#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f -- "${BASH_SOURCE[0]}")"
APP_DIR="$(cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)"
LOCK_FILE="/tmp/payment-reminder-run.lock"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

cd "$APP_DIR"

# The cron environment usually does not load nvm, so we load it ourselves if needed.
if ! command -v node >/dev/null 2>&1; then
  NVM_SCRIPT="${NVM_DIR:-${HOME}/.nvm}/nvm.sh"
  if [[ -s "$NVM_SCRIPT" ]]; then
    # shellcheck source=/dev/null
    source "$NVM_SCRIPT"
    nvm use 24 --silent
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  log "ERROR: node or npm is not available"
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  log "ERROR: the flock command is not available"
  exit 1
fi

# Don't start the next cycle while the previous one is still running.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Previous run is still in progress; skipping this cycle"
  exit 0
fi

if [[ ! -d .git ]]; then
  log "ERROR: $APP_DIR is not a Git repository"
  exit 1
fi

if [[ ! -f .env ]]; then
  log "ERROR: $APP_DIR/.env not found"
  exit 1
fi

before_lock_hash=""
if [[ -f package-lock.json ]]; then
  before_lock_hash="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
fi

log "Checking GitHub for updates"
if GIT_TERMINAL_PROMPT=0 git fetch origin main; then
  local_commit="$(git rev-parse HEAD)"
  remote_commit="$(git rev-parse origin/main)"

  if [[ "$local_commit" != "$remote_commit" ]]; then
    log "Installing the latest origin/main version"
    git merge --ff-only origin/main
  else
    log "Code is already up to date"
  fi
else
  log "WARNING: GitHub is unreachable; continuing with the current code version"
fi

after_lock_hash=""
if [[ -f package-lock.json ]]; then
  after_lock_hash="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
fi

if [[ ! -d node_modules || "$before_lock_hash" != "$after_lock_hash" ]]; then
  log "Installing npm dependencies"
  npm ci --omit=dev
else
  log "npm dependencies have not changed"
fi

log "Running automated tests"
npm test

log "Starting payment-reminder"
exec node src/index.js
