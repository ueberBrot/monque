#!/usr/bin/env bash
set -euo pipefail

start_mongodb() {
	local started=$SECONDS
	docker run --detach --name monque-dashboard-e2e \
		--publish 127.0.0.1:27018:27017 \
		--health-cmd "mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'" \
		--health-interval 5s --health-timeout 5s \
		--health-retries 30 --health-start-period 30s \
		mongodb/mongodb-atlas-local:8.3.2-20260529T125201Z >/dev/null

	local deadline=$((SECONDS + 180))
	local health
	while ((SECONDS < deadline)); do
		health=$(docker inspect --format '{{if .State.Running}}{{.State.Health.Status}}{{else}}stopped{{end}}' monque-dashboard-e2e)
		case "$health" in
		healthy)
			echo "MongoDB ready after $((SECONDS - started)) seconds"
			return 0
			;;
		stopped | unhealthy) break ;;
		esac
		sleep 1
	done

	echo "MongoDB did not become healthy" >&2
	return 1
}

start_mongodb &
mongo_pid=$!

browser_status=0
(cd apps/dashboard-dev && vp exec playwright install --with-deps --no-shell chromium) || browser_status=$?
mongo_status=0
wait "$mongo_pid" || mongo_status=$?
((browser_status == 0 && mongo_status == 0))
