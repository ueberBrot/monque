#!/usr/bin/env bash
set -euo pipefail

jq --exit-status --arg event "${CI_EVENT:?CI_EVENT is required}" '
  .["build-packages"].outputs.runtime as $runtime |
  (if $runtime == "true" then "success" else "skipped" end) as $expected |
  .["build-packages"].result == "success" and .quality.result == "success" and
  .["build-apps"].result == "success" and
  ($runtime == "true" or $runtime == "false") and
  ($event != "merge_group" or $runtime == "true") and
  .test.result == $expected and .consumers.result == $expected and
  .["dashboard-e2e"].result == $expected
' <<<"${CI_NEEDS:?CI_NEEDS is required}"
