#!/usr/bin/env bash
# Поднимает временный Postgres, накатывает все миграции по порядку
# и прогоняет тесты. Существующие базы не затрагиваются.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$(mktemp -d)/data"
PORT="${PORT:-$(shuf -i 5500-5900 -n 1)}"
SOCK="$(mktemp -d)"
export PATH="$PGBIN:$PATH"

cleanup() {
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA" "$SOCK"
}
trap cleanup EXIT

mkdir -p "$PGDATA"
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$(dirname "$PGDATA")" "$SOCK"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi

"${RUN[@]}" "PATH=$PGBIN:\$PATH initdb -D $PGDATA -A trust" >/dev/null
"${RUN[@]}" "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -l $PGDATA/log -o '-k $SOCK -p $PORT' start" >/dev/null
sleep 2

psql() { command psql -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== заглушки Supabase"
psql -q -f "$ROOT/supabase/tests/00_stubs.sql"

echo "== миграции"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql -q -f "$f"
done

echo "== тесты"
psql -f "$ROOT/supabase/tests/01_permissions.sql"
psql -f "$ROOT/supabase/tests/02_stock.sql"
psql -f "$ROOT/supabase/tests/03_orders.sql"
psql -f "$ROOT/supabase/tests/04_bookings.sql"
psql -f "$ROOT/supabase/tests/05_compliance.sql"

echo
echo "Готово. Ни одной строки «ПРОВАЛ» выше — значит все запреты сработали."
