#!/usr/bin/env bash
set -euo pipefail

# Release script for Tasks CalDAV Sync Obsidian plugin
# Usage:
#   ./scripts/release.sh 1.0.0              # create or update release
#   ./scripts/release.sh 1.1.0 --new        # create new release (fails if tag exists)
#   ./scripts/release.sh 1.1.0 --dry-run    # show what would happen without making changes
#   ./scripts/release.sh 1.1.0 --new --dry-run

TAG=""
NEW_ONLY=false
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --new) NEW_ONLY=true ;;
    --dry-run) DRY_RUN=true ;;
    -*) echo "Unknown option: $arg"; exit 1 ;;
    *) TAG="$arg" ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "Usage: release.sh <tag> [--new] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  --new       Fail if tag already exists (prevents overwriting)"
  echo "  --dry-run   Show what would happen without making any changes"
  exit 1
fi

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

echo "=== Release $TAG ==="
[[ "$DRY_RUN" == true ]] && echo "(dry run mode — no changes will be made)"
echo ""

# Ensure we're on master
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "master" ]]; then
  echo "Error: must be on master branch (currently on $BRANCH)"
  exit 1
fi

# Ensure working tree is clean (skip in dry-run since we won't commit)
if [[ "$DRY_RUN" == false && -n $(git status --porcelain --ignore-submodules) ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Check if tag already exists
TAG_EXISTS=$(git tag -l "$TAG")

if [[ -n "$TAG_EXISTS" && "$NEW_ONLY" == true ]]; then
  echo "Error: tag $TAG already exists. Remove --new to update it."
  exit 1
fi

# Build & verify
echo "--- Build & verify ---"
run npm run build
run npm run lint
run npx jest --config jest.config.cjs --selectProjects unit

# Check versions
echo ""
echo "--- Version check ---"
MANIFEST_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
PACKAGE_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
MIN_APP_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).minAppVersion)")

echo "Target tag:       $TAG"
echo "manifest.json:    $MANIFEST_VERSION"
echo "package.json:     $PACKAGE_VERSION"
echo "minAppVersion:    $MIN_APP_VERSION"

if [[ "$MANIFEST_VERSION" != "$TAG" || "$PACKAGE_VERSION" != "$TAG" ]]; then
  echo ""
  echo "Version mismatch — updating to $TAG..."

  run node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json','utf8'));
    m.version = '$TAG';
    fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');
  "

  run node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json','utf8'));
    p.version = '$TAG';
    fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');
  "

  run node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('manifest.json','utf8'));
    const v = JSON.parse(fs.readFileSync('versions.json','utf8'));
    v['$TAG'] = m.minAppVersion;
    fs.writeFileSync('versions.json', JSON.stringify(v, null, '\t') + '\n');
  "

  run git add manifest.json package.json versions.json
  run git commit -m "chore: bump version to $TAG"
  run git push origin master

  # Rebuild with updated manifest
  echo "Rebuilding with updated version..."
  run npm run build
else
  echo "Versions already match $TAG — no bump needed."
fi

# Tag
echo ""
echo "--- Tag ---"
if [[ -n "$TAG_EXISTS" ]]; then
  echo "Tag $TAG exists — will update to HEAD."
  run git tag -f "$TAG" HEAD
  run git push origin "$TAG" --force
else
  echo "Tag $TAG is new — will create at HEAD."
  run git tag "$TAG" HEAD
  run git push origin "$TAG"
fi

# Release
echo ""
echo "--- GitHub release ---"
RELEASE_EXISTS=$(gh release view "$TAG" --json tagName 2>/dev/null || echo "")

if [[ -z "$RELEASE_EXISTS" ]]; then
  echo "No existing release — will create new release $TAG."
  run gh release create "$TAG" \
    main.js manifest.json styles.css \
    --title "$TAG" \
    --generate-notes
else
  echo "Release exists — will update assets."
  run gh release upload "$TAG" main.js manifest.json styles.css --clobber
fi

echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. No changes were made."
else
  echo "Release $TAG complete: https://github.com/josecoelho/obsidian-tasks-caldav/releases/tag/$TAG"
fi
