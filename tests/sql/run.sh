#!/usr/bin/env bash
# Run the Supabase migrations and the SQL API tests against a real Postgres.
#
#   DATABASE_URL=postgres://… tests/sql/run.sh   # use an existing, empty database
#   tests/sql/run.sh                             # spin up a throwaway local cluster (needs initdb)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

cleanup() { :; }
if [[ -z "${DATABASE_URL:-}" ]]; then
  bindir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  initdb="$(command -v initdb || echo "$bindir/initdb")"
  pgctl="$(command -v pg_ctl || echo "$bindir/pg_ctl")"
  tmp="$(mktemp -d)"
  # Postgres refuses to run as root; use the postgres system user when we are root.
  as=()
  if [[ "$(id -u)" == "0" ]]; then chown postgres "$tmp"; as=(runuser -u postgres --); fi
  "${as[@]}" "$initdb" -D "$tmp/data" -U postgres --auth=trust -E UTF8 >/dev/null
  port=$(( 54000 + RANDOM % 1000 ))
  "${as[@]}" "$pgctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -w start >/dev/null
  cleanup() { "${as[@]}" "$pgctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
  trap cleanup EXIT
  DATABASE_URL="postgresql://postgres@/postgres?host=$tmp&port=$port"
fi

run() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

run -f "$here/bootstrap.sql"
for f in "$root"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run -f "$f"
done
run -f "$here/api.test.sql"
