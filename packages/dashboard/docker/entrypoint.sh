#!/bin/sh
set -eu

: "${MONQUE_DASHBOARD_API_BASE_URL:?MONQUE_DASHBOARD_API_BASE_URL is required}"
export PORT="${PORT-3000}"
export MONQUE_DASHBOARD_BASE_PATH="${MONQUE_DASHBOARD_BASE_PATH-/}"

runtime_config=$(jq -cn '
    def positive_integer($max):
      test("^[0-9]+$") and (tonumber > 0 and tonumber <= $max);
    def require($valid; $message):
      if $valid then . else error($message) end;

    env as $env
    | $env.MONQUE_DASHBOARD_API_BASE_URL as $api
    | $env.MONQUE_DASHBOARD_BASE_PATH as $base
    | $env.MONQUE_DASHBOARD_POLLING_INTERVAL_MS as $polling
    | require($env.PORT | positive_integer(65535);
        "PORT must be an integer between 1 and 65535")
    | require($base | test("^/[A-Za-z0-9/._~-]*$")
        and (contains("//") | not)
        and (split("/") | any(. == "." or . == "..") | not)
        and (ascii_downcase | test("^/(healthz|__monque_dashboard_index)/?$") | not);
        "MONQUE_DASHBOARD_BASE_PATH must be an absolute, non-reserved mount path")
    | require($api | (test("[[:space:]\\\\]") | not) and (startswith("//") | not)
        and test("^https?://(\\[[0-9A-Fa-f:]+\\]|[A-Za-z0-9.-]+)(:[0-9]+)?(/.*)?$|^/.*$")
        and all(capture("^https?://[^/]*:(?<port>[0-9]+)(?:/|$)")?; (.port | tonumber) <= 65535);
        "MONQUE_DASHBOARD_API_BASE_URL must be an HTTP(S) URL or an absolute API path")
    | { apiBaseUrl: $api, basePath: (if $base == "/" then $base else $base | rtrimstr("/") end) }
    | if $polling == null then .
      else require($polling | positive_integer(9007199254740991);
          "MONQUE_DASHBOARD_POLLING_INTERVAL_MS must be a positive integer")
        | . + { pollingIntervalMs: ($polling | tonumber) }
      end
  ')

MONQUE_DASHBOARD_BASE_PATH=$(printf '%s' "$runtime_config" | jq -r '.basePath')
DASHBOARD_PREFIX="${MONQUE_DASHBOARD_BASE_PATH%/}/"
DASHBOARD_PREFIX_PATTERN=$(printf '%s' "$DASHBOARD_PREFIX" | sed 's/\./\\./g')
export DASHBOARD_PREFIX DASHBOARD_PREFIX_PATTERN

jq -nr --argjson config "$runtime_config" --arg prefix "$DASHBOARD_PREFIX" \
  --rawfile html /usr/share/nginx/html/index.html '
    ($config | tojson | gsub("<"; "\\u003c")) as $json
    | "(?<tag><script[^>]*id=\"monque-dashboard-runtime-config\"[^>]*>)[\\s\\S]*?</script>" as $pattern
    | $html
    | gsub("\\./assets/"; $prefix + "assets/")
    | if test($pattern)
      then sub($pattern; "\(.tag)window.__MONQUE_DASHBOARD_CONFIG__ = " + $json + ";</script>")
      else error("Missing dashboard runtime configuration template") end
  ' > /tmp/dashboard-index.html

envsubst "\$PORT \$MONQUE_DASHBOARD_BASE_PATH \$DASHBOARD_PREFIX \$DASHBOARD_PREFIX_PATTERN" \
  < /opt/dashboard/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
