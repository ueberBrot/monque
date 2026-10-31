#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: bash packages/dashboard/tests/docker/dashboard-image.sh IMAGE}
scratch=$(mktemp -d)
container=""

cleanup() {
  local status=$?
  if [[ -n "$container" ]]; then
    if [[ "$status" != 0 ]]; then docker logs "$container" >&2 || true; fi
    docker container rm --force "$container" > /dev/null || true
  fi
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT

expect_status() {
  local expected=$1 url=$2 actual
  shift 2
  actual=$(curl --silent --show-error --max-time 5 --dump-header "$scratch/headers" \
    --output "$scratch/body" --write-out '%{http_code}' "$@" "$url")
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected HTTP $expected from $url; received $actual" >&2
    cat "$scratch/body" >&2
    exit 1
  fi
}

expect_invalid_configuration() {
  container=$(docker create --read-only --tmpfs /tmp "$@" "$image")
  docker start "$container" > /dev/null
  local exit_code
  exit_code=$(timeout 10s docker wait "$container")
  if [[ "$exit_code" == 0 ]]; then
    echo "Expected invalid startup configuration to fail: $*" >&2
    exit 1
  fi
  docker container rm "$container" > /dev/null
  container=""
}

uid=$(docker run --rm --entrypoint id "$image" -u)
if [[ "$uid" == 0 ]]; then
  echo "Dashboard image must run as a non-root user" >&2
  exit 1
fi
docker run --rm --entrypoint sh "$image" -c 'test -z "$(command -v node || command -v bun)"'

expect_invalid_configuration
for invalid in \
  'MONQUE_DASHBOARD_API_BASE_URL=' \
  'MONQUE_DASHBOARD_API_BASE_URL=file:///api' \
  'MONQUE_DASHBOARD_API_BASE_URL=https://[' \
  'MONQUE_DASHBOARD_API_BASE_URL=https://api.example.test:65536/ops' \
  'MONQUE_DASHBOARD_API_BASE_URL=https://[::1]:65536/ops' \
  'MONQUE_DASHBOARD_BASE_PATH=dashboard' \
  'MONQUE_DASHBOARD_BASE_PATH=/ops/*' \
  'MONQUE_DASHBOARD_BASE_PATH=/ops/../dashboard' \
  'MONQUE_DASHBOARD_BASE_PATH=//dashboard' \
  'MONQUE_DASHBOARD_BASE_PATH=/healthz/' \
  'MONQUE_DASHBOARD_BASE_PATH=/HEALTHZ' \
  'MONQUE_DASHBOARD_BASE_PATH=/healthz//' \
  'MONQUE_DASHBOARD_BASE_PATH=/__monque_dashboard_index' \
  'MONQUE_DASHBOARD_POLLING_INTERVAL_MS=' \
  'MONQUE_DASHBOARD_POLLING_INTERVAL_MS=0' \
  'MONQUE_DASHBOARD_POLLING_INTERVAL_MS=1.5' \
  'PORT=0' \
  'PORT=65536' \
  'PORT=not-a-port'; do
  expect_invalid_configuration --env MONQUE_DASHBOARD_API_BASE_URL=/ops --env "$invalid"
done
echo 'Verified startup configuration validation'

for mount in / /ops/dashboard/ /ops.dashboard/; do
  prefix=${mount%/}
  base_path=${prefix:-/}
  case "$mount" in
    /) api_base_url=https://api.example.test:443/management ;;
    /ops/dashboard/) api_base_url=/ops ;;
    *) api_base_url='https://[::1]:3000/management' ;;
  esac
  container=$(docker run --detach --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges \
    --publish 127.0.0.1::3000 \
    --env "MONQUE_DASHBOARD_API_BASE_URL=$api_base_url" \
    --env "MONQUE_DASHBOARD_BASE_PATH=$mount" \
    --env MONQUE_DASHBOARD_POLLING_INTERVAL_MS=15000 \
    "$image")
  address=$(docker port "$container" 3000/tcp)
  origin="http://$address"

  curl --fail --silent --show-error --max-time 2 \
    --retry 30 --retry-all-errors --retry-delay 1 \
    "$origin/healthz" > "$scratch/health"
  grep --quiet '"status":"ok"' "$scratch/health"
  expect_status 200 "$origin/healthz"
  grep --extended-regexp --ignore-case --quiet '^content-type:.*application/json' "$scratch/headers"
  grep --extended-regexp --ignore-case --quiet '^cache-control:.*no-store' "$scratch/headers"

  for route in / /index.html /jobs /jobs/job-123 /jobs/job.123 /queue-views /queue-views/email.send /health; do
    curl --fail --silent --show-error --max-time 5 \
      --dump-header "$scratch/headers" --output "$scratch/html" "$origin$prefix$route"
    grep --fixed-strings --quiet "\"apiBaseUrl\":\"$api_base_url\"" "$scratch/html"
    grep --fixed-strings --quiet "\"basePath\":\"$base_path\"" "$scratch/html"
    grep --fixed-strings --quiet '"pollingIntervalMs":15000' "$scratch/html"
    grep --extended-regexp --ignore-case --quiet '^cache-control:.*no-store' "$scratch/headers"
    expect_status 200 "$origin$prefix$route" --head
  done

  asset=$(sed --silent --regexp-extended 's/.*src="([^"]+\.js)".*/\1/p' "$scratch/html" | head --lines=1)
  if [[ "$asset" != "$prefix"/assets/*.js ]]; then
    echo "Missing mount-aware JavaScript asset in $mount HTML: $asset" >&2
    exit 1
  fi
  curl --fail --silent --show-error --max-time 5 \
    --dump-header "$scratch/headers" --output "$scratch/asset" "$origin$asset"
  test -s "$scratch/asset"
  grep --extended-regexp --ignore-case --quiet '^cache-control:.*immutable' "$scratch/headers"
  grep --extended-regexp --ignore-case --quiet '^content-type:.*(application|text)/javascript' "$scratch/headers"
  expect_status 200 "$origin$asset" --head
  expect_status 200 "$origin$asset" --header 'Accept-Encoding: gzip'
  grep --extended-regexp --ignore-case --quiet '^content-encoding:.*gzip' "$scratch/headers"
  expect_status 200 "$origin$asset" --header 'Accept-Encoding: gzip' --header 'Via: 1.1 dashboard-proxy'
  grep --extended-regexp --ignore-case --quiet '^content-encoding:.*gzip' "$scratch/headers"

  while IFS= read -r asset_path; do
    expect_status 200 "$origin$prefix$asset_path"
    expect_status 200 "$origin$prefix$asset_path" --head
  done < <(docker exec "$container" find /usr/share/nginx/html/assets -type f | \
    sed 's|^/usr/share/nginx/html||')

  expect_status 404 "$origin$prefix/assets/missing.js"
  expect_status 404 "$origin$prefix/api/v1/jobs"
  expect_status 404 "$origin$prefix/missing.js"
  expect_status 405 "$origin/auth/login" --request POST
  expect_status 404 "$origin/__monque_dashboard_index"
  expect_status 405 "$origin$prefix/jobs/job-123" --request POST
  if [[ -n "$prefix" ]]; then expect_status 404 "$origin/jobs"; fi

  docker container stop --time 12 "$container" > /dev/null
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
  docker container rm "$container" > /dev/null
  container=""
  echo "Verified public dashboard pages and assets at mount $mount"
done

api_base_url='https://api.example.test/ops/"</script><script>alert(1)</script>'
container=$(docker run --detach --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges --publish 127.0.0.1::8080 \
  --env "MONQUE_DASHBOARD_API_BASE_URL=$api_base_url" --env PORT=8080 "$image")
origin="http://$(docker port "$container" 8080/tcp)"
curl --fail --silent --show-error --max-time 2 \
  --retry 30 --retry-all-errors --retry-delay 1 "$origin/jobs" > "$scratch/html"
grep --fixed-strings --quiet '"basePath":"/"' "$scratch/html"
grep --fixed-strings --quiet '\"\u003c/script>\u003cscript>alert(1)\u003c/script>' "$scratch/html"
if grep --fixed-strings --quiet '"pollingIntervalMs"' "$scratch/html"; then
  echo 'Polling must be disabled when no interval is configured' >&2
  exit 1
fi
if grep --fixed-strings --quiet '</script><script>alert(1)</script>' "$scratch/html"; then
  echo 'Runtime configuration must escape HTML script delimiters' >&2
  exit 1
fi
for ((attempt = 0; attempt < 40; attempt++)); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]]; then
    break
  fi
  sleep 1
done
test "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy
docker container stop --time 12 "$container" > /dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
docker container rm "$container" > /dev/null
container=""
echo 'Verified default mount, optional polling, custom port, container health, and safe runtime configuration'
