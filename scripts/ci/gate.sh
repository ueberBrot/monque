#!/usr/bin/env bash
set -euo pipefail

jq --exit-status '
  .["build-packages"].outputs.runtime as $runtime |
  (if $runtime == "true" then "success" else "skipped" end) as $expected |
  .["build-packages"].result == "success" and .quality.result == "success" and
  .["build-apps"].result == "success" and
  ($runtime == "true" or $runtime == "false") and
  .test.result == $expected and .consumers.result == $expected and
  .["dashboard-e2e"].result == $expected
' <<<"${CI_NEEDS:?CI_NEEDS is required}"
