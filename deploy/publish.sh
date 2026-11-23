#!/usr/bin/env bash
# Builds and starts Treoo with fictitious demo data, then publishes it through a Cloudflare Quick Tunnel.
# Usage: ./deploy/publish.sh            (run from the repository root on the OCI VM)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then echo "Missing .env — run: cp .env.example .env and set POSTGRES_PASSWORD"; exit 1; fi
if grep -q '^POSTGRES_PASSWORD=change-me' .env; then echo "Set a real POSTGRES_PASSWORD in .env first"; exit 1; fi

profiles=(--profile tunnel)
if grep -q '^AI_MODE=ollama' .env && grep -q '^OLLAMA_URL=http://ollama' .env; then profiles+=(--profile ai); fi

echo "Building and starting Treoo…"
docker compose "${profiles[@]}" up -d --build db app

echo -n "Waiting for the app to be healthy"
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  echo -n "."; sleep 3
done
echo
[ "$status" = healthy ] || { echo "The app did not become healthy. Check: docker compose logs app"; exit 1; }

echo "Loading fictitious demo data (skipped if already present)…"
docker compose exec -T app node apps/api/dist/db/seed.js

echo "Opening the Cloudflare tunnel…"
docker compose "${profiles[@]}" up -d tunnel
url=""
for _ in $(seq 1 40); do
  url=$(docker compose logs tunnel 2>/dev/null | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$url" ] && break
  sleep 2
done
if [ -z "$url" ]; then echo "No tunnel URL yet. Check: docker compose logs tunnel"; exit 1; fi
echo
echo "Treoo is public at: $url"
echo "Demo password for every account: Treoo-demo-2026 (e.g. ana@northbridge.demo)"
