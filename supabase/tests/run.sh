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

# pg_cron и pg_net ставит Supabase, в чистом Postgres их нет — и миграция
# 0018 на них падает. Это не мелочь стенда: из-за неё ОБЯЗАТЕЛЬНЫЙ прогон
# («любая правка миграций прогоняется через run.sh до коммита») не доходил
# ни до одного теста с того дня, как 0018 появилась. Отсюда и то, что
# миграции 0016–0020 не покрыты ни одним сценарием: их нечем было проверить.
#
# Заглушки кладём РАСШИРЕНИЯМИ, а не объектами в 00_stubs.sql, сознательно:
# тогда `create extension if not exists pg_cron` в миграции исполняется
# ровно так, как уйдёт в бой, и мы тестируем настоящий текст файла,
# а не его пересказ. Сигнатуры повторяют настоящие, включая имена
# именованных аргументов net.http_get — иначе вызов в 0018 не разберётся.
EXTDIR="$("$PGBIN/pg_config" --sharedir)/extension"
for ext in pg_cron pg_net; do
  [ -f "$EXTDIR/$ext.control" ] && continue
  if [ ! -w "$EXTDIR" ]; then
    echo "!! Нет ни расширения $ext, ни прав записи в $EXTDIR." >&2
    echo "   Поставьте $ext или запустите прогон под root." >&2
    exit 1
  fi
  printf "default_version = '1.0'\nrelocatable = false\n" > "$EXTDIR/$ext.control"
done

if [ ! -s "$EXTDIR/pg_cron--1.0.sql" ]; then
  cat > "$EXTDIR/pg_cron--1.0.sql" <<'SQL'
create schema if not exists cron;
create table cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  jobname  text unique,
  active   boolean not null default true
);
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  delete from cron.job where jobname = job_name returning true;
$$;
SQL
fi

if [ ! -s "$EXTDIR/pg_net--1.0.sql" ]; then
  cat > "$EXTDIR/pg_net--1.0.sql" <<'SQL'
create schema if not exists net;
-- Ничего никуда не шлёт: на стенде наружу ходить нельзя, да и незачем —
-- проверяется, что задание СОЗДАНО и разбирается, а не что оно долетело.
create function net.http_get(
  url                  text,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{}'::jsonb,
  timeout_milliseconds int   default 5000
) returns bigint language sql as $$ select 1::bigint $$;
SQL
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

# ── Почему вывод собирается в файл ────────────────────────────────────────
#
# Тесты сообщают о провале СТРОКОЙ «ПРОВАЛ», а не кодом возврата: они
# написаны на проверках внутри do-блоков, и psql про них не знает.
# Пока итог читал человек, этого хватало. В задании GitHub читателя нет,
# и прогон, который печатает «ПРОВАЛ» и завершается нулём, — это зелёная
# метка на сломанном запрете. Поэтому вывод перехватывается и проверяется.
LOG="$(mktemp)"
{
  psql -f "$ROOT/supabase/tests/01_permissions.sql"
  psql -f "$ROOT/supabase/tests/02_stock.sql"
  psql -f "$ROOT/supabase/tests/03_orders.sql"
  psql -f "$ROOT/supabase/tests/04_bookings.sql"
  psql -f "$ROOT/supabase/tests/05_compliance.sql"
  # 06 обёрнут в begin/rollback и после себя базу не меняет, поэтому стоит
  # последним и ничего за собой не тянет.
  psql -f "$ROOT/supabase/tests/06_isolation.sql"
  psql -f "$ROOT/supabase/tests/07_register_card.sql"
  psql -f "$ROOT/supabase/tests/08_stock_plus.sql"
  psql -f "$ROOT/supabase/tests/09_team.sql"
  psql -f "$ROOT/supabase/tests/10_contacts.sql"
  # 11–21 закрывают миграции 0016–0027: до них на эти файлы не было ни
  # одного сценария — прогон падал на 0018 раньше, чем доходил до тестов.
  psql -f "$ROOT/supabase/tests/11_search_geo.sql"
  psql -f "$ROOT/supabase/tests/12_citext.sql"
  psql -f "$ROOT/supabase/tests/13_cron.sql"
  psql -f "$ROOT/supabase/tests/14_storage.sql"
  psql -f "$ROOT/supabase/tests/15_modules.sql"
  psql -f "$ROOT/supabase/tests/16_audit_log.sql"
  psql -f "$ROOT/supabase/tests/17_expiry_sku.sql"
  psql -f "$ROOT/supabase/tests/18_notify_delivery.sql"
  psql -f "$ROOT/supabase/tests/19_register_tenant.sql"
  psql -f "$ROOT/supabase/tests/20_profile_consents.sql"
  # 21 удаляет строки насовсем (удаление аккаунта) и после себя базу не
  # восстанавливает — но работает только на собственных фикстурах.
  psql -f "$ROOT/supabase/tests/21_account_deletion.sql"
  # 22 стоит после него по той же причине и по тому же правилу: он тоже
  # заводит своих людей и свои заклады и тоже заканчивается удалением
  # аккаунта — теперь уже проверяя, что вместе с человеком уходят журнал
  # безопасности и отпечатки его устройств.
  psql -f "$ROOT/supabase/tests/22_security_perimeter.sql"
  # 23 обёрнут в begin/rollback и после себя базу не меняет, поэтому его
  # место здесь безразлично: он заводит своего арендатора, свою услугу
  # и свой товар и откатывает всё до строки.
  psql -f "$ROOT/supabase/tests/23_rate_limit.sql"
} 2>&1 | tee "$LOG"

echo
if grep -q 'ПРОВАЛ' "$LOG"; then
  echo "!! ПРОВАЛЫ:" >&2
  grep -n 'ПРОВАЛ' "$LOG" >&2
  rm -f "$LOG"
  exit 1
fi
rm -f "$LOG"
echo "Готово. Ни одной строки «ПРОВАЛ» — значит все запреты сработали."
