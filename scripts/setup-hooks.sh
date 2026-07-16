#!/bin/sh
# One-time setup: make git use the tracked hooks in .githooks/ so that
# data/market.json is rebuilt automatically on commit and after pull/merge.
#
#   sh scripts/setup-hooks.sh
set -e

cd "$(dirname "$0")/.."

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true

echo "Git hooks enabled (core.hooksPath = .githooks)."
echo "  - pre-commit : rebuilds data/market.json when snapshots change"
echo "  - post-merge : rebuilds data/market.json after a pull that adds snapshots"
