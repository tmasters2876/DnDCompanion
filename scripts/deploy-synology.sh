#!/usr/bin/env bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAS_HOST="${NAS_HOST:-tmasters@10.0.1.50}"
NAS_ROOT="${NAS_ROOT:-/volume1/docker/dnd-companion}"
WITH_DATA=0

for arg in "$@"; do
  case "$arg" in
    --with-data) WITH_DATA=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$NAS_ROOT" != /volume*/docker/dnd-companion ]]; then
  echo "Refusing unexpected NAS_ROOT: $NAS_ROOT" >&2
  exit 2
fi
if [[ -n "$(git -C "$TASK_ROOT" status --porcelain)" ]]; then
  echo "Commit or discard local changes before staging a NAS release." >&2
  exit 1
fi

RELEASE="$(git -C "$TASK_ROOT" rev-parse HEAD)"
if [[ "${ALLOW_UNPUSHED:-0}" != "1" && "$RELEASE" != "$(git -C "$TASK_ROOT" rev-parse origin/main)" ]]; then
  echo "HEAD must match origin/main before deployment (or set ALLOW_UNPUSHED=1 for pre-push acceptance)." >&2
  exit 1
fi

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  npm --prefix "$TASK_ROOT" run test:all
fi

ssh -o BatchMode=yes "$NAS_HOST" "mkdir -p '$NAS_ROOT/releases' '$NAS_ROOT/data-releases' '$NAS_ROOT/state/characters' '$NAS_ROOT/state/homebrew' && chmod 775 '$NAS_ROOT/state/characters' '$NAS_ROOT/state/homebrew'"

if ! ssh -o BatchMode=yes "$NAS_HOST" "test -d '$NAS_ROOT/releases/$RELEASE'"; then
  UPLOAD_RELEASE="$NAS_ROOT/releases/.uploading-$RELEASE-$$"
  git -C "$TASK_ROOT" archive "$RELEASE" | ssh -o BatchMode=yes "$NAS_HOST" \
    "set -eu; mkdir '$UPLOAD_RELEASE'; tar -xf - -C '$UPLOAD_RELEASE'; mv '$UPLOAD_RELEASE' '$NAS_ROOT/releases/$RELEASE'"
fi

MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT
(
  cd "$TASK_ROOT"
  find data/srd data/sources/_normalized -type f -name '*.json' -print0 \
    | LC_ALL=C sort -z | xargs -0 shasum -a 256
) > "$MANIFEST"
LOCAL_DATA_VERSION="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"

if [[ "$WITH_DATA" == "1" ]]; then
  DATA_VERSION="$LOCAL_DATA_VERSION"
  if ! ssh -o BatchMode=yes "$NAS_HOST" "test -d '$NAS_ROOT/data-releases/$DATA_VERSION'"; then
    UPLOAD_DATA="$NAS_ROOT/data-releases/.uploading-$DATA_VERSION-$$"
    tar -C "$TASK_ROOT/data" -czf - srd sources/_normalized | ssh -o BatchMode=yes "$NAS_HOST" \
      "set -eu; mkdir '$UPLOAD_DATA'; tar -xzf - -C '$UPLOAD_DATA'; mv '$UPLOAD_DATA' '$NAS_ROOT/data-releases/$DATA_VERSION'"
  fi
else
  DATA_VERSION="$(ssh -o BatchMode=yes "$NAS_HOST" "test -f '$NAS_ROOT/.env' && sed -n 's/^DND_DATA_VERSION=//p' '$NAS_ROOT/.env' | head -1 || true")"
  if [[ ! "$DATA_VERSION" =~ ^[a-f0-9]{64}$ ]]; then
    echo "No deployed data release found. Re-run with --with-data." >&2
    exit 1
  fi
  if [[ "$DATA_VERSION" != "$LOCAL_DATA_VERSION" ]]; then
    echo "Local normalized data changed. Re-run with --with-data." >&2
    exit 1
  fi
fi

BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ssh -o BatchMode=yes "$NAS_HOST" "cat > '$NAS_ROOT/compose.yaml'" < "$TASK_ROOT/deploy/synology/compose.yaml"
printf 'DND_RELEASE=%s\nDND_DATA_VERSION=%s\nBUILD_DATE=%s\nPUID=1026\nPGID=100\n' \
  "$RELEASE" "$DATA_VERSION" "$BUILD_DATE" \
  | ssh -o BatchMode=yes "$NAS_HOST" "cat > '$NAS_ROOT/.env'"
printf '{"release":"%s","dataDigest":"sha256:%s","builtAt":"%s"}\n' \
  "$RELEASE" "$DATA_VERSION" "$BUILD_DATE" \
  | ssh -o BatchMode=yes "$NAS_HOST" "cat > '$NAS_ROOT/release.json'"

echo "Staged release $RELEASE"
echo "Staged data sha256:$DATA_VERSION"
echo "Container Manager project file: $NAS_ROOT/compose.yaml"
echo "After build/recreate: BASE_URL=http://10.0.1.50:15177 npm run test:deployment"
