#!/bin/bash
# Publish benchmark charts to a `docs` branch and re-pin the README to them.
#
# Adapted from json-as. The main working tree is never committed: charts are
# rendered into ./charts (build output) and committed only inside a separate
# `docs` worktree, under charts/v<version>/ so every release keeps its own set.
# Re-publishing a version overwrites just that folder. After pushing, the
# README's chart <img> URLs are re-pinned (left uncommitted for you to review)
# to the version just published, so a README revision references the charts
# built from its own code.
#
#   ./scripts/publish-benchmarks.sh                # run benches, build, publish
#   ./scripts/publish-benchmarks.sh --no-run       # reuse existing bench logs
#   ./scripts/publish-benchmarks.sh --wavm         # pick the chart runtime
#
# Env: REMOTE_NAME (origin), DOCS_BRANCH (docs), PUBLISH_REQUIRE_CLEAN (0).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_NAME="${REMOTE_NAME:-origin}"
DOCS_BRANCH="${DOCS_BRANCH:-docs}"
VERSION="$(node -p "require('./package.json').version")"
CHARTS_OUT="./charts"
RUN_BENCHES=1
CHART_ARGS=()
TMP_CHARTS_DIR="$(mktemp -d)"
TMP_DOCS_DIR="$(mktemp -d)"
WORKTREE_ADDED=0

# GitHub owner/repo from the remote, for the raw.githubusercontent URLs the
# README is pinned to (e.g. JairusSW/utf-as).
REMOTE_URL="$(git remote get-url "$REMOTE_NAME" 2>/dev/null || echo "")"
SLUG="$(printf '%s' "$REMOTE_URL" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"
RAW_BASE="https://raw.githubusercontent.com/${SLUG}/refs/heads/${DOCS_BRANCH}/charts"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-run)
      RUN_BENCHES=0
      shift
      ;;
    --v8|--wavm|--wazero)
      CHART_ARGS+=("$1")
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/publish-benchmarks.sh [--no-run] [--v8|--wavm|--wazero]"
      exit 1
      ;;
  esac
done

cleanup() {
  rm -rf "$TMP_CHARTS_DIR"
  if [[ "$WORKTREE_ADDED" == "1" ]]; then
    git worktree remove --force "$TMP_DOCS_DIR" >/dev/null 2>&1 || true
  else
    rm -rf "$TMP_DOCS_DIR"
  fi
}
trap cleanup EXIT

# Publishing never commits the main working tree: charts are committed only
# inside the separate `docs` worktree, so a dirty/untracked main tree is safe.
# Set PUBLISH_REQUIRE_CLEAN=1 to restore the refuse-if-dirty guard.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  if [[ "${PUBLISH_REQUIRE_CLEAN:-0}" == "1" ]]; then
    echo "Refusing to publish benchmarks with a dirty tracked working tree (PUBLISH_REQUIRE_CLEAN=1)."
    echo "Commit or stash your changes first."
    exit 1
  fi
  echo "⚠️  Working tree has uncommitted changes - charts will reflect them (HEAD: $(git rev-parse --short HEAD))."
fi

if [[ "$RUN_BENCHES" == "1" ]]; then
  echo "Fetching simdutf payloads..."
  bash ./scripts/fetch-simdutf-payloads.sh
  echo "Running benchmarks..."
  bash ./scripts/run-bench.sh "${CHART_ARGS[@]}"
else
  echo "Skipping benchmark runs. Reusing existing logs."
fi

echo "Building charts..."
if [[ ${#CHART_ARGS[@]} -gt 0 ]]; then
  bash ./scripts/build-charts.sh "${CHART_ARGS[@]}"
else
  bash ./scripts/build-charts.sh
fi
test -d "$CHARTS_OUT"
compgen -G "$CHARTS_OUT/*" > /dev/null
cp -R "$CHARTS_OUT/." "$TMP_CHARTS_DIR/"

echo "Preparing ${DOCS_BRANCH} worktree..."
git fetch "$REMOTE_NAME" "$DOCS_BRANCH" >/dev/null 2>&1 || true
if git show-ref --verify --quiet "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}"; then
  git worktree add --detach "$TMP_DOCS_DIR" "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout -B "$DOCS_BRANCH" >/dev/null
  )
else
  git worktree add --detach "$TMP_DOCS_DIR" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout --orphan "$DOCS_BRANCH" >/dev/null
    git rm -rf . >/dev/null 2>&1 || true
  )
fi

# Publish under charts/v<version>/ so each release keeps its own chart set.
# Re-publishing a version overwrites just that folder; other versions untouched.
DEST="v${VERSION}"
echo "Updating charts/${DEST} on ${DOCS_BRANCH}..."
rm -rf "$TMP_DOCS_DIR/charts/${DEST}"
mkdir -p "$TMP_DOCS_DIR/charts/${DEST}"
cp -R "$TMP_CHARTS_DIR/." "$TMP_DOCS_DIR/charts/${DEST}/"

(
  cd "$TMP_DOCS_DIR"
  git add -A charts
  if git diff --cached --quiet; then
    echo "No chart changes to publish for ${DEST}."
    exit 0
  fi

  git config user.name "${GIT_AUTHOR_NAME:-$(git config --get user.name || echo utf-as)}"
  git config user.email "${GIT_AUTHOR_EMAIL:-$(git config --get user.email || echo utf-as@example.com)}"
  git commit -m "Update benchmark charts for ${DEST} [skip ci]" >/dev/null
  git push "$REMOTE_NAME" "$DOCS_BRANCH"
)

# Re-pin the README chart URLs to the version just published, so a README
# revision references the charts built from its own code. Handles both the
# relative path (charts/foo.png, the committed-in-tree style) and an already
# raw-pinned URL (.../refs/heads/docs/charts/[vX/]foo.png). Left uncommitted
# for you to review and commit.
echo "Pinning README chart URLs to charts/${DEST}/..."
# 1) Re-pin existing raw URLs to the new version.
sed -i -E "s#(/refs/heads/${DOCS_BRANCH}/charts/)([^\"')]*/)?([^/\"')]+\.(svg|png))#\1${DEST}/\3#g" README.md
# 2) Convert relative markdown links (](charts/foo.png)) to raw, versioned URLs.
sed -i -E "s#\]\(charts/([^)]+\.(svg|png))\)#](${RAW_BASE}/${DEST}/\1)#g" README.md

echo "Benchmark charts published to ${REMOTE_NAME}/${DOCS_BRANCH}:charts/${DEST}/."
echo "README pinned to ${RAW_BASE}/${DEST}/"
