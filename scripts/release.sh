#!/usr/bin/env bash
set -euo pipefail

# Release script for Tasks CalDAV Sync Obsidian plugin
# Usage:
#   ./scripts/release.sh 1.0.0        # create or update tag 1.0.0
#   ./scripts/release.sh 1.1.0 --new  # create new release (fails if tag exists)

TAG="${1:?Usage: release.sh <tag> [--new]}"
NEW_ONLY="${2:-}"

# Ensure we're on master
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "master" ]]; then
  echo "Error: must be on master branch (currently on $BRANCH)"
  exit 1
fi

# Ensure working tree is clean
if [[ -n $(git status --porcelain --ignore-submodules) ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Check if tag already exists
TAG_EXISTS=$(git tag -l "$TAG")

if [[ -n "$TAG_EXISTS" && "$NEW_ONLY" == "--new" ]]; then
  echo "Error: tag $TAG already exists. Remove --new to update it."
  exit 1
fi

# Build
echo "Building production bundle..."
npm run build

# Verify
echo "Running lint..."
npm run lint

echo "Running tests..."
npx jest --config jest.config.cjs --selectProjects unit

# Update manifest version if needed
MANIFEST_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
if [[ "$MANIFEST_VERSION" != "$TAG" ]]; then
  echo "Updating manifest.json version from $MANIFEST_VERSION to $TAG..."
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json','utf8'));
    m.version = '$TAG';
    fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');
  "
  # Update versions.json
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json','utf8'));
    const v = JSON.parse(fs.readFileSync('versions.json','utf8'));
    v['$TAG'] = m.minAppVersion;
    fs.writeFileSync('versions.json', JSON.stringify(v, null, '\t') + '\n');
  "
  git add manifest.json versions.json
  git commit -m "chore: bump version to $TAG"
  git push origin master

  # Rebuild with updated manifest
  npm run build
fi

# Tag
if [[ -n "$TAG_EXISTS" ]]; then
  echo "Updating existing tag $TAG..."
  git tag -f "$TAG" HEAD
  git push origin "$TAG" --force
else
  echo "Creating new tag $TAG..."
  git tag "$TAG" HEAD
  git push origin "$TAG"
fi

# Create or update release
RELEASE_EXISTS=$(gh release view "$TAG" --json tagName 2>/dev/null || echo "")

if [[ -z "$RELEASE_EXISTS" ]]; then
  echo "Creating new release $TAG..."
  gh release create "$TAG" \
    main.js manifest.json styles.css \
    --title "$TAG" \
    --generate-notes
else
  echo "Updating existing release $TAG..."
  gh release upload "$TAG" main.js manifest.json styles.css --clobber
fi

echo ""
echo "Release $TAG complete: https://github.com/josecoelho/obsidian-tasks-caldav/releases/tag/$TAG"
