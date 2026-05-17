#!/usr/bin/env bash
set -euo pipefail

# Release script for Tasks CalDAV Sync Obsidian plugin — PR-based.
#
# We cannot push directly to master, so releasing is two-phase:
#
#   Phase 1 (versions != <tag>): branch off master, bump version, push the
#           branch, open a PR, then stop. You review & merge the PR.
#   Phase 2 (re-run after merge, versions == <tag>): build, tag HEAD, and
#           publish the GitHub release. (Pushing a tag is not a branch push,
#           so it does not violate master branch protection.)
#
# Usage:
#   ./scripts/release.sh 1.1.7              # phase 1, then (after merge) phase 2
#   ./scripts/release.sh 1.1.7 --new        # fail if tag already exists
#   ./scripts/release.sh 1.1.7 --dry-run    # show what would happen, change nothing

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
  echo "Two-phase, PR-based release:"
  echo "  1. First run (versions != <tag>): opens a version-bump PR. Merge it."
  echo "  2. Re-run after merge (versions == <tag>): tags HEAD and publishes."
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

ensure_master_clean() {
  local branch
  branch=$(git branch --show-current)
  if [[ "$branch" != "master" ]]; then
    echo "Error: must be on master branch (currently on $branch)"
    exit 1
  fi
  if [[ "$DRY_RUN" == false && -n $(git status --porcelain --ignore-submodules) ]]; then
    echo "Error: working tree is not clean. Commit or stash changes first."
    exit 1
  fi
}

build_and_verify() {
  run npm run build
  run npm run lint
  run npx jest --config jest.config.cjs --selectProjects unit
}

echo "=== Release $TAG ==="
[[ "$DRY_RUN" == true ]] && echo "(dry run mode — no changes will be made)"
echo ""

# Check if tag already exists
TAG_EXISTS=$(git tag -l "$TAG")

if [[ -n "$TAG_EXISTS" && "$NEW_ONLY" == true ]]; then
  echo "Error: tag $TAG already exists. Remove --new to update it."
  exit 1
fi

# Read current versions
MANIFEST_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
PACKAGE_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
MIN_APP_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).minAppVersion)")

if [[ "$MANIFEST_VERSION" != "$TAG" || "$PACKAGE_VERSION" != "$TAG" ]]; then
  # ----------------------------------------------------------------------
  # Phase 1 — open a version-bump PR (no direct push to master)
  # ----------------------------------------------------------------------
  echo "--- Phase 1: version-bump PR ---"
  echo "manifest.json: $MANIFEST_VERSION   package.json: $PACKAGE_VERSION   ->   $TAG"
  echo ""

  ensure_master_clean
  run git fetch origin
  run git pull --ff-only origin master

  RELEASE_BRANCH="release/$TAG"
  run git switch -c "$RELEASE_BRANCH"

  echo ""
  echo "--- Build & verify ---"
  build_and_verify

  echo ""
  echo "--- Bump version to $TAG ---"
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
  run git push -u origin "$RELEASE_BRANCH"
  run gh pr create --base master --head "$RELEASE_BRANCH" \
    --title "chore: bump version to $TAG" \
    --body "Version bump for release $TAG.

Merge this, then re-run \`./scripts/release.sh $TAG\` from an up-to-date master to tag HEAD and publish the GitHub release."

  echo ""
  echo "Phase 1 complete. Next:"
  echo "  1. Review & merge the PR above."
  echo "  2. git switch master && git pull --ff-only origin master"
  echo "  3. Re-run: ./scripts/release.sh $TAG   (tags & publishes)"
  exit 0
fi

# ----------------------------------------------------------------------
# Phase 2 — versions match: tag HEAD + publish the GitHub release
# ----------------------------------------------------------------------
echo "--- Phase 2: tag & publish ---"
ensure_master_clean
run git fetch origin
run git pull --ff-only origin master

echo ""
echo "Target tag:       $TAG"
echo "manifest.json:    $MANIFEST_VERSION"
echo "package.json:     $PACKAGE_VERSION"
echo "minAppVersion:    $MIN_APP_VERSION"
echo "Versions match $TAG — no bump needed."

echo ""
echo "--- Build & verify ---"
build_and_verify

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
