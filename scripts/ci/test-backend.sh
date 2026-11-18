#!/usr/bin/env bash
set -euo pipefail

(cd apps/dashboard-dev && vp exec playwright install --with-deps chromium) &
browser_pid=$!

# Only Dashboard Effect and the Effect host need Chromium.
backend_status=0
vp run --filter './packages/*' --filter '!@monque/dashboard' \
	--filter '!@monque/dashboard-effect' --ignore-depends-on --concurrency-limit 2 test || backend_status=$?

browser_status=0
wait "$browser_pid" || browser_status=$?
if ((backend_status != 0 || browser_status != 0)); then
	echo "Backend tests exited with status $backend_status; browser installation exited with status $browser_status" >&2
	exit 1
fi

vp run --filter @monque/dashboard-effect --ignore-depends-on test
vp run --filter @monque/effect-host --ignore-depends-on test
