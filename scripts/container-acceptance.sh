#!/usr/bin/env bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-dnd-companion:local-container-test}"
PORT="${PORT:-15179}"
NAME="dnd-companion-acceptance-$$"
STATE_ROOT="$(mktemp -d -t dnd-companion-state.XXXXXX)"
SLUG="container-smoke-$(date +%s)-$$"
CHARACTER_ID=""

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [[ "$(basename "$STATE_ROOT")" == dnd-companion-state.* ]] \
    && [[ "$STATE_ROOT" == /tmp/* || "$STATE_ROOT" == /var/folders/* ]]; then
    rm -rf "$STATE_ROOT"
  fi
}
trap cleanup EXIT
mkdir -p "$STATE_ROOT/characters" "$STATE_ROOT/homebrew"
chmod 777 "$STATE_ROOT/characters" "$STATE_ROOT/homebrew"

start_container() {
  docker run -d --name "$NAME" --platform linux/amd64 --init --read-only \
    --tmpfs /tmp:rw,size=64m,mode=1777 --user 1026:100 --memory 2g --cpus 2 \
    -p "127.0.0.1:$PORT:5177" \
    -e APP_RELEASE=container-acceptance -e DATA_DIGEST=sha256:container-data \
    -e EXPECTED_COMPENDIUM_MIN=100000 -e NODE_OPTIONS=--max-old-space-size=1536 \
    -v "$TASK_ROOT/data/srd:/app/data/srd:ro" \
    -v "$TASK_ROOT/data/sources/_normalized:/app/data/sources/_normalized:ro" \
    -v "$STATE_ROOT/characters:/app/data/characters:rw" \
    -v "$STATE_ROOT/homebrew:/app/data/homebrew:rw" \
    "$IMAGE" >/dev/null
}

wait_for_health() {
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  docker logs "$NAME" >&2 || true
  echo "Container did not become healthy." >&2
  exit 1
}

start_container
wait_for_health
BASE_URL="http://127.0.0.1:$PORT" EXPECTED_RELEASE=container-acceptance \
  EXPECTED_DATA_DIGEST=sha256:container-data ALLOW_SMOKE_WRITES=1 \
  node "$TASK_ROOT/scripts/deployment-smoke.mjs"

test "$(docker exec "$NAME" id -u)" = "1026"
docker exec "$NAME" sh -c 'test ! -e /app/.git && test ! -e /app/tests && test ! -e /app/data/pdfs && test ! -e /app/app/src'

CHARACTER_ID="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/characters" \
  -H 'content-type: application/json' \
  --data "{\"name\":\"Container Persistence $SLUG\",\"classes\":[{\"class\":\"fighter\",\"level\":1}]}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).id))")"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/homebrew" \
  -H 'content-type: application/json' \
  --data "{\"type\":\"rule\",\"slug\":\"$SLUG\",\"name\":\"Container Persistence\",\"text\":\"Persistence sentinel.\"}" >/dev/null

docker restart "$NAME" >/dev/null
wait_for_health
curl -fsS "http://127.0.0.1:$PORT/api/characters/$CHARACTER_ID" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/compendium/rule/$SLUG" >/dev/null

docker rm -f "$NAME" >/dev/null
start_container
wait_for_health
curl -fsS "http://127.0.0.1:$PORT/api/characters/$CHARACTER_ID" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/compendium/rule/$SLUG" >/dev/null
curl -fsS -X DELETE "http://127.0.0.1:$PORT/api/characters/$CHARACTER_ID" >/dev/null
curl -fsS -X DELETE "http://127.0.0.1:$PORT/api/homebrew/rule/$SLUG" >/dev/null

echo "Container acceptance passed: restart and force-recreate preserved writable state."
