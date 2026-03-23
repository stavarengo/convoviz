#!/usr/bin/env bash
# js-exporter release script
# Usage: ./scripts/release.sh [major|minor|patch]
# Bumps version, updates lockfile, commits both, tags, and pushes.

set -euo pipefail

BUMP="${1:-minor}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$JS_DIR/.." && pwd)"

cd "$JS_DIR"

echo "→ Bumping $BUMP version..."
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | sed 's/^v//')

echo "→ Updating lockfile..."
npm install --package-lock-only

echo "→ Committing..."
cd "$ROOT_DIR"
git add js-exporter/package.json js-exporter/package-lock.json
git commit -m "chore(js-exporter): release v${NEW_VERSION} :rocket:"

echo "→ Tagging js-exporter-v${NEW_VERSION}..."
git tag "js-exporter-v${NEW_VERSION}"

echo "→ Pushing..."
git push
git push origin "js-exporter-v${NEW_VERSION}"

echo "✅ Released js-exporter v${NEW_VERSION}"
