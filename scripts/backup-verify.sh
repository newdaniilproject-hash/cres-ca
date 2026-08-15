#!/usr/bin/env bash
# Проверка резервной копии ВОССТАНОВЛЕНИЕМ. Шаг 1 плана, пункт Г.
#
# ── Зачем отдельный запуск ────────────────────────────────────────────────
#
# Копия, которую ни разу не разворачивали, — это не копия, а надежда.
# Отказы, которые ловит только восстановление и не ловит ничто другое:
# оборванный дамп, несовместимая версия pg_dump, потерянный ключ
# шифрования, испорченный объект в хранилище, дамп без половины таблиц
# из-за прав. Каждый из них выглядит как успешная копия ровно до того дня,
# когда она понадобилась.
#
# Поэтому проверка идёт СВЕРХУ ВНИЗ, тем же путём, что и настоящее
# восстановление: скачали из хранилища → расшифровали → развернули
# в чистую базу → посчитали. Ни одного шага в обход.
#
# ── Про закрытый ключ ─────────────────────────────────────────────────────
#
# Это единственное место, где нужна ЗАКРЫТАЯ половина ключа шифрования.
# В ежедневной выгрузке её нет и быть не должно: там достаточно открытой.
# Разделение сделано ради того, чтобы утечка секретов сборки не означала
# утечку всех прошлых копий.

set -euo pipefail

: "${BACKUP_AGE_PRIVATE_KEY:?нет BACKUP_AGE_PRIVATE_KEY — закрытый ключ}"
: "${R2_ACCOUNT_ID:?нет R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?нет R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?нет R2_SECRET_ACCESS_KEY}"
R2_BUCKET="${R2_BUCKET:-cresca-backups}"
: "${VERIFY_DB_URL:?нет VERIFY_DB_URL — чистая база для разворачивания}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Берём САМУЮ СВЕЖУЮ полную копию ───────────────────────────────────────
# Именно ту, которую взяли бы в аварии. Проверять заведомо старую и заведомо
# целую — значит проверять не то.
LATEST="$(aws s3api list-objects-v2 \
  --bucket "$R2_BUCKET" --prefix daily/full- \
  --endpoint-url "$R2_ENDPOINT" \
  --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"

if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
  echo "!! в хранилище нет ни одной полной копии" >&2
  exit 1
fi
echo "▸ проверяю: $LATEST"

aws s3 cp "s3://${R2_BUCKET}/${LATEST}" "$WORK/backup.age" \
  --endpoint-url "$R2_ENDPOINT" --only-show-errors

# ── Расшифровка ───────────────────────────────────────────────────────────
printf '%s' "$BACKUP_AGE_PRIVATE_KEY" > "$WORK/key.txt"
chmod 600 "$WORK/key.txt"
age --decrypt --identity "$WORK/key.txt" \
    --output "$WORK/backup.sql" "$WORK/backup.age"

# ── Контрольная сумма из имени должна сойтись ─────────────────────────────
# Имя содержит первые 16 знаков суммы исходного дампа. Расхождение означает,
# что архив испортился в пути или в хранилище, — и заметить это надо здесь,
# а не в день аварии.
EXPECTED="$(printf '%s' "$LATEST" | sed -n 's/.*-\([0-9a-f]\{16\}\)\.sql\.age$/\1/p')"
ACTUAL="$(sha256sum "$WORK/backup.sql" | cut -c1-16)"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "!! контрольная сумма не сошлась: в имени $EXPECTED, у файла $ACTUAL" >&2
  exit 1
fi
echo "▸ сумма сошлась: $ACTUAL"

# ── Разворачивание в чистую базу ──────────────────────────────────────────
psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q \
  -c 'drop schema if exists public cascade; create schema public;' \
  -c 'drop schema if exists storage cascade;'

# Дамп содержит объекты, которых в чистом Postgres нет (роли Supabase,
# расширения в своих схемах). Это ожидаемо и не является отказом:
# отказом является невозможность получить ДАННЫЕ. Поэтому здесь
# ON_ERROR_STOP выключен намеренно, а вердикт выносят проверки ниже.
psql "$VERIFY_DB_URL" -q -f "$WORK/backup.sql" > "$WORK/restore.log" 2>&1 || true

# ── Что именно проверяем ──────────────────────────────────────────────────
#
# Не «база развернулась», а «в ней есть то, ради чего её хранят».
# Список — это то, что клиент обязан предъявить проверке и чего нельзя
# восстановить никаким другим способом.
echo "▸ считаю строки"
psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
\set QUIET on
\pset footer off

do $$
declare
  v_t       text;
  v_missing text[] := '{}';
  v_empty   text[] := '{}';
  v_n       bigint;
  -- Таблицы, пустота которых означает потерю. Справочники и заготовки
  -- сюда не входят: они восстанавливаются миграциями.
  v_must text[] := array[
    'tenants', 'profiles', 'tenant_members',
    'materials', 'material_batches', 'material_containers',
    'stock_movements',
    'cleaning_entries', 'sterilization_cycles', 'sanitation_solutions',
    'tech_cards', 'material_documents'
  ];
begin
  foreach v_t in array v_must loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_t
    ) then
      v_missing := v_missing || v_t;
      continue;
    end if;
    execute format('select count(*) from public.%I', v_t) into v_n;
    raise notice '  % — % рядків', rpad(v_t, 24), v_n;
    if v_n = 0 then v_empty := v_empty || v_t; end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'ПРОВАЛ: у копії немає таблиць: %', array_to_string(v_missing, ', ');
  end if;

  -- Пустая таблица — не всегда отказ: у молодого салона может не быть
  -- ни одного цикла стерилизации. Отказ — когда пусты ВСЕ журналы разом:
  -- это уже похоже на дамп без данных, а не на молодой салон.
  if v_empty @> array['cleaning_entries','sterilization_cycles','sanitation_solutions']
     and 'stock_movements' = any(v_empty) then
    raise exception 'ПРОВАЛ: усі журнали й рух складу порожні — це дамп без даних';
  end if;

  raise notice 'ok — таблиці на місці';
end $$;

-- Целостность связей: восстановленная база не должна содержать ссылок
-- в никуда. Это ловит дамп, снятый в момент незавершённой транзакции.
do $$
declare v_broken bigint;
begin
  select count(*) into v_broken
    from public.stock_movements m
    left join public.tenants t on t.id = m.tenant_id
   where t.id is null;
  if v_broken > 0 then
    raise exception 'ПРОВАЛ: % рухів посилаються на неіснуючого орендаря', v_broken;
  end if;

  select count(*) into v_broken
    from public.material_containers c
    left join public.materials mt on mt.id = c.material_id
   where mt.id is null;
  if v_broken > 0 then
    raise exception 'ПРОВАЛ: % ємностей посилаються на неіснуючий засіб', v_broken;
  end if;

  raise notice 'ok — звʼязки цілі';
end $$;

-- Остаток обязан сходиться с журналом и в восстановленной копии тоже.
-- Если не сходится — копия снята в момент, когда база была неконсистентна,
-- и восстанавливать по ней учёт нельзя.
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from public.materials m
   where m.current_stock <> coalesce(
     (select sum(quantity) from public.stock_movements s where s.material_id = m.id), 0);
  if v_bad > 0 then
    raise exception 'ПРОВАЛ: у % засобів залишок не сходиться з журналом', v_bad;
  end if;
  raise notice 'ok — залишок сходиться з журналом';
end $$;
SQL

# ── Случайный документ должен открываться ─────────────────────────────────
#
# Последняя и самая честная проверка: берём из восстановленной базы путь
# случайного документа и достаём этот файл из копии файлов. Именно здесь
# ловится случай «база цела, а PDF потеряны» — тот самый, при котором
# реестр перестаёт быть доказательством.
DOC_PATH="$(psql "$VERIFY_DB_URL" -tAc \
  "select path from public.material_documents order by random() limit 1" || true)"

if [ -n "$DOC_PATH" ]; then
  if aws s3api head-object --bucket "$R2_BUCKET" \
       --key "files/documents/${DOC_PATH}" \
       --endpoint-url "$R2_ENDPOINT" >/dev/null 2>&1; then
    echo "ok — випадковий документ на місці: $DOC_PATH"
  else
    echo "!! документа немає в копії файлів: $DOC_PATH" >&2
    exit 1
  fi
else
  echo "ok — документів у базі ще немає, перевіряти нічого"
fi

echo "✔ копія $LATEST розгортається і містить дані"
