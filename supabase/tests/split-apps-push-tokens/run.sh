#!/usr/bin/env bash
# Verifies which app each push notification reaches after the rider/driver
# split, against a THROWAWAY local Postgres database (never the Supabase
# project — this creates and drops its own database).
#
#   PGUSER=postgres PGHOST=localhost ./supabase/tests/split-apps-push-tokens/run.sh
#
# Applies the real notification migrations in order on top of minimal
# stubs, applies the split migration twice (idempotency), swaps the HTTP
# push sender for a recorder, then runs the scenarios.
set -euo pipefail
DB="${TEST_DB:-ride_push_routing_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../migrations"
export PGOPTIONS="-c client_min_messages=warning"

dropdb --if-exists "$DB" 2>/dev/null
createdb "$DB"
run() { psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

run "$HERE/00_stubs.sql"
for m in \
  20260803120000_dual_role_driver_apply \
  20260803150000_driver_notifications \
  20260830090000_rider_ride_notifications \
  20260830100000_admin_dispatch_config \
  20261006120000_split_apps_push_tokens \
  20261006120000_split_apps_push_tokens; do
  run "$MIG/$m.sql"
done
run "$HERE/90_capture_push.sql"
run "$HERE/50_scenarios.sql" 2>&1 | sed 's/^psql:[^ ]* WARNING:  //'
dropdb "$DB"
