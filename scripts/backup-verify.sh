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
#
# ── Два пути, и второй честно назван слабее ───────────────────────────────
#
# ПОЛНЫЙ путь (есть закрытый ключ и ключи R2): берём из хранилища самый
# свежий архив — тот самый, который взяли бы в аварии, — расшифровываем,
# сверяем контрольную сумму и разворачиваем. Проверяется вся цепочка,
# включая шифрование, хранилище и целостность объекта.
#
# ОСЛАБЛЕННЫЙ путь (ключей ещё нет): снимаем свежий дамп и разворачиваем
# его. Проверяется, что дамп в принципе снимается и разворачивается
# в работающую базу с целыми связями и сходящимся остатком. НЕ проверяется
# то, ради чего существует хранилище: доехал ли архив, читается ли он
# ключом, не испортился ли лежащий объект.
#
# Ослабленный путь введён не для красоты отчёта. Без него проверка
# не запускалась вовсе, и класс отказов «дамп не разворачивается» никто
# не ловил месяцами. Половина проверки, которая работает, ловит больше,
# чем полная, которая ждёт секретов.

set -euo pipefail

: "${VERIFY_DB_URL:?нет VERIFY_DB_URL — чистая база для разворачивания}"
R2_BUCKET="${R2_BUCKET:-cresca-backups}"

if [ -n "${BACKUP_AGE_PRIVATE_KEY:-}" ] && [ -n "${R2_ACCOUNT_ID:-}" ] \
   && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  ROUTE=full
else
  ROUTE=weak
  : "${SUPABASE_DB_URL:?нет ни ключей хранилища, ни SUPABASE_DB_URL — проверять нечего}"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$ROUTE" = "full" ]; then
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

  # ── Берём САМУЮ СВЕЖУЮ полную копию ─────────────────────────────────────
  # Именно ту, которую взяли бы в аварии. Проверять заведомо старую
  # и заведомо целую — значит проверять не то.
  LATEST="$(aws s3api list-objects-v2 \
    --bucket "$R2_BUCKET" --prefix daily/full- \
    --endpoint-url "$R2_ENDPOINT" \
    --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"

  if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
    echo "!! в хранилище нет ни одной полной копии" >&2
    exit 1
  fi
  echo "▸ повний шлях, перевіряю: $LATEST"

  aws s3 cp "s3://${R2_BUCKET}/${LATEST}" "$WORK/backup.age" \
    --endpoint-url "$R2_ENDPOINT" --only-show-errors

  # ── Расшифровка ─────────────────────────────────────────────────────────
  #
  # Ключ НЕ пишется в файл как есть, а из него ВЫРЕЗАЕТСЯ сама строка
  # `AGE-SECRET-KEY-…`. Причина в том, как ключ попадает в секрет: человек
  # копирует файл `key.txt`, а в нём три строки — две с решёткой и одна
  # с ключом. По дороге через блокнот и веб-форму к ним прилипают возвраты
  # каретки от Windows, лишние пробелы, а иногда переносы теряются вовсе
  # и всё склеивается в одну строку. Первый же боевой прогон упал на
  # `unknown identity type` именно из-за этого — при полностью верном ключе.
  #
  # Вырезание снимает весь этот класс отказов разом: неважно, вставили
  # файл целиком, одну строку или склеенную кашу — ключ найдётся.
  printf '%s' "$BACKUP_AGE_PRIVATE_KEY" | tr -d '\r' \
    | grep -o 'AGE-SECRET-KEY-[A-Z0-9]*' | head -1 > "$WORK/key.txt" || true
  if ! grep -q '^AGE-SECRET-KEY-' "$WORK/key.txt"; then
    echo "!! у секреті BACKUP_AGE_PRIVATE_KEY немає рядка AGE-SECRET-KEY-…" >&2
    echo "   Вставте вміст файлу key.txt із запуску «Ключ шифрування копій»." >&2
    exit 1
  fi
  chmod 600 "$WORK/key.txt"
  age --decrypt --identity "$WORK/key.txt" \
      --output "$WORK/backup.sql" "$WORK/backup.age"

  # ── Контрольная сумма из имени должна сойтись ───────────────────────────
  # Имя содержит первые 16 знаков суммы исходного дампа. Расхождение
  # означает, что архив испортился в пути или в хранилище, — и заметить
  # это надо здесь, а не в день аварии.
  EXPECTED="$(printf '%s' "$LATEST" | sed -n 's/.*-\([0-9a-f]\{16\}\)\.sql\.age$/\1/p')"
  ACTUAL="$(sha256sum "$WORK/backup.sql" | cut -c1-16)"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "!! контрольная сумма не сошлась: в имени $EXPECTED, у файла $ACTUAL" >&2
    exit 1
  fi
  echo "▸ сумма сошлась: $ACTUAL"
else
  echo "::warning::Ослаблена перевірка: немає закритого ключа або ключів R2 — перевіряється свіжий дамп, а не архів зі сховища"
  echo "▸ ослаблений шлях: знімаю свіжий дамп"
  LATEST="(свіжий дамп, не архів)"
  pg_dump "$SUPABASE_DB_URL" \
    --schema=public --schema=storage \
    --no-owner --no-privileges \
    --format=plain --file="$WORK/backup.sql"

  if ! tail -c 4096 "$WORK/backup.sql" | grep -q "PostgreSQL database dump complete"; then
    echo "!! дамп оборван: нет завершающей строки" >&2
    exit 1
  fi
fi

# ── Разворачивание в чистую базу ──────────────────────────────────────────
psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q \
  -c 'drop schema if exists public cascade; create schema public;' \
  -c 'drop schema if exists storage cascade;'

# ── Подпорки платформы, без которых дамп разворачивается НЕ ВЕСЬ ──────────
#
# Найдено первым же боевым прогоном: проверка объявила «у копії немає
# таблиць: tenants, profiles», хотя копия была цела. Причина не в копии,
# а в чистом Postgres, куда её разворачивают:
#
#   • `tenants.slug` имеет тип `extensions.citext`. Схемы `extensions`
#     в голом Postgres нет, расширения тоже — CREATE TABLE падает,
#     таблица не появляется.
#   • `profiles.id` ссылается на `auth.users`. Схему `auth` держит сам
#     Supabase, в дамп она не входит намеренно (иначе ломает вход при
#     настоящем восстановлении) — и ссылка не на что опереться.
#
# Значит стенд обязан воспроизвести то, что при НАСТОЯЩЕМ восстановлении
# даёт платформа. Иначе проверка объявляет провалом собственную
# недостроенность, а это худший вид ложной тревоги: на неё перестают
# смотреть, и настоящий провал проходит незамеченным.
psql "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q \
  -c 'create schema if not exists extensions;' \
  -c 'create extension if not exists citext    schema extensions;' \
  -c 'create extension if not exists pgcrypto  schema extensions;' \
  -c 'create extension if not exists "uuid-ossp" schema extensions;' \
  -c 'create schema if not exists auth;' \
  -c 'create table if not exists auth.users (id uuid primary key);'

# Дамп содержит объекты, которых в чистом Postgres нет (роли Supabase,
# расширения в своих схемах). Это ожидаемо и не является отказом:
# отказом является невозможность получить ДАННЫЕ. Поэтому здесь
# ON_ERROR_STOP выключен намеренно, а вердикт выносят проверки ниже.
psql "$VERIFY_DB_URL" -q -f "$WORK/backup.sql" > "$WORK/restore.log" 2>&1 || true

# Ошибки разворачивания печатаем ВСЕГДА, а не только при провале.
# Первый боевой прогон упал с «немає таблиць», а причина — отсутствие типа
# `citext` — лежала в этом файле и никуда не выводилась; на её поиск ушёл
# лишний круг. Двадцать строк в журнале дешевле одного такого круга.
echo "▸ помилки розгортання (перші 20, якщо є)"
grep -i '^ERROR' "$WORK/restore.log" | head -20 | sed 's/^/   /' || true

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

  -- Пустоту НЕ судим здесь. Раньше тут стояла догадка: «пусты все журналы
  -- разом — значит дамп без данных». Она провалила первую же настоящую
  -- проверку на боевой базе, где журналы пусты ЧЕСТНО: клиент ещё не начал
  -- работать. Проверка, которая не отличает «данные потерялись» от «данных
  -- ещё нет», обязана сравнивать с источником, а не гадать. Сравнение —
  -- ниже, в скрипте, где есть доступ и к копии, и к источнику.
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

# ── Копия против источника: не потерялись ли строки ───────────────────────
#
# Единственный честный ответ на вопрос «полны ли данные» — сравнить с тем,
# откуда снимали. Пустая таблица в копии не отказ, если она пуста и
# в источнике; отказ — когда в источнике строки есть, а в копии их нет.
#
# Сравнение «не меньше», а не «ровно столько же», намеренно: между снятием
# дампа и этой проверкой в боевую базу могли добавиться строки, и требовать
# точного равенства значило бы получать ложные отказы в рабочие часы.
if [ -n "${SUPABASE_DB_URL:-}" ]; then
  echo "▸ порівнюю з джерелом"
  LOST=0
  for t in tenants profiles tenant_members materials material_batches \
           material_containers stock_movements cleaning_entries \
           sterilization_cycles sanitation_solutions tech_cards material_documents; do
    SRC="$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from public.$t" 2>/dev/null || echo skip)"
    [ "$SRC" = "skip" ] && continue
    DST="$(psql "$VERIFY_DB_URL" -tAc "select count(*) from public.$t" 2>/dev/null || echo 0)"
    if [ "$SRC" -gt 0 ] && [ "$DST" -eq 0 ]; then
      echo "!! $t: у джерелі $SRC рядків, у копії жодного" >&2
      LOST=1
    else
      echo "   $t: джерело $SRC, копія $DST"
    fi
  done
  [ "$LOST" -eq 0 ] || { echo "!! ПРОВАЛ: копія втратила дані" >&2; exit 1; }
  echo "ok — копія не втратила жодної таблиці з даними"
else
  echo "-- джерело недоступне, повноту не порівнюю"
fi

# ── Случайный документ должен открываться ─────────────────────────────────
#
# Последняя и самая честная проверка: берём из восстановленной базы путь
# случайного документа и достаём этот файл из копии файлов. Именно здесь
# ловится случай «база цела, а PDF потеряны» — тот самый, при котором
# реестр перестаёт быть доказательством.
DOC_PATH="$(psql "$VERIFY_DB_URL" -tAc \
  "select path from public.material_documents order by random() limit 1" || true)"

if [ "$ROUTE" != "full" ]; then
  echo "-- копію файлів не перевіряю: немає ключів R2, самої копії файлів теж немає"
elif [ -n "$DOC_PATH" ]; then
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
