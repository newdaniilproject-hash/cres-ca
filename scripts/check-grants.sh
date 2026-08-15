#!/usr/bin/env bash
# Проверка прав НА БОЕВОЙ БАЗЕ. Шаг 3, «проверка попыткой».
#
# ── Зачем отдельно от supabase/tests/06_isolation.sql ─────────────────────
#
# 06_isolation.sql уже держит закрытый список анонимных функций и проверяет
# изоляцию по всем таблицам. Но он гоняется НА ЧИСТОМ POSTGRES, собранном
# из файлов миграций, — и там физически нет того, что раздаёт права
# в облаке: `alter default privileges … grant all … to anon, authenticated`,
# которые Supabase держит на схеме public.
#
# Из-за этого локальный прогон зелёный, а на проде у ролей anon
# и authenticated оказываются права, которых никто не выдавал. Так уже было:
#
#   • 0036 — представления соответствия достались anon;
#   • 0060 → 0061 — те же представления достались authenticated НА ЗАПИСЬ,
#     потому что простое представление автообновляемо и работает правами
#     владельца, то есть мимо RLS;
#   • 0072 — пять функций достались anon, и stock_value_view потеряла
#     security_invoker при `create or replace`.
#
# Три раза один и тот же механизм. Значит проверка обязана смотреть туда,
# где он работает, — на боевую базу.
#
# ── Что проверяется ───────────────────────────────────────────────────────
#
# 1. Список функций, которые может выполнять anon, совпадает с объявленным.
# 2. Ни одно представление не отдано anon.
# 3. У каждого представления либо security_invoker = true, либо оно названо
#    в списке осознанных исключений с указанием причины.
#
# Третий пункт — про правило 3. Представление без invoker читает таблицы
# правами владельца, мимо RLS. У представлений соответствия это сделано
# НАМЕРЕННО (0062: у инспектора нет stock.read, и с invoker он увидел бы
# пустой реестр). У складских — ошибка, и она уже случалась.

set -euo pipefail

: "${SUPABASE_DB_URL:?нет SUPABASE_DB_URL — проверять нечего}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
\set QUIET on
\pset footer off

-- ── 1. Кто может выполнять функции от имени анонима ───────────────────────
do $$
declare
  v_extra   text;
  v_missing text;
  -- Восемь точек входа правила 7 плюс хелперы, которые зовут сами политики,
  -- применяемые к анониму. Список дословно повторяет тот, что в
  -- supabase/tests/06_isolation.sql: две копии одного списка разъезжаются,
  -- поэтому при правке меняются ОБЕ, и расхождение видно сразу — здесь
  -- проверка упадёт, там нет.
  v_allowed text[] := array[
    'active_cities','available_slots','create_booking','create_order',
    'is_platform_staff','is_tenant_member','jwt_memberships','jwt_perms',
    'map_tenants','my_tenants','search_all','storage_tenant','storefront',
    'tenant_can','tenant_has_module','tenant_role','tenants_with',
    'track_order','variant_available'];
begin
  select string_agg(x, ', ' order by x) into v_extra from (
    select p.proname::text as x from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                          and d.deptype = 'e')
    except select unnest(v_allowed)) q;

  select string_agg(x, ', ' order by x) into v_missing from (
    select unnest(v_allowed) as x
    except select p.proname::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')) q;

  if v_extra is not null then
    raise exception 'ПРОВАЛ: анониму відкрита зайва функція — %. Зняти: revoke all on function public.<ім''я>(…) from public, anon;', v_extra;
  end if;
  if v_missing is not null then
    raise exception 'ПРОВАЛ: анониму закрита потрібна функція — %. Публічні читання перестануть працювати.', v_missing;
  end if;
  raise notice 'ok — анонім виконує рівно % функцій зі списку', array_length(v_allowed, 1);
end $$;

-- ── 2. Представления анониму не отдаются вовсе ────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(distinct c.relname, ', ' order by c.relname) into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = c.relname
   where c.relkind = 'v' and g.grantee = 'anon';

  if v_bad is not null then
    raise exception 'ПРОВАЛ: представлення відкриті анониму — %. Це право дає замовчування Supabase, а не рішення.', v_bad;
  end if;
  raise notice 'ok — жодне представлення анониму не відкрите';
end $$;

-- ── 3. security_invoker у представлений ───────────────────────────────────
do $$
declare
  v_bad text;
  -- Осознанные исключения. Каждое существует, чтобы ОБОЙТИ RLS, и это
  -- обход по назначению: инспектор имеет compliance.read и не имеет
  -- stock.read, поэтому реестр он видит только так (0062).
  -- Новое имя сюда добавляется вместе с объяснением, а не молча.
  v_definer_ok text[] := array[
    'compliance_materials', 'compliance_batches',
    'compliance_containers', 'compliance_batch_history',
    'team_access_log'];
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind = 'v'
     and not (c.relname = any(v_definer_ok))
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true';

  if v_bad is not null then
    raise exception 'ПРОВАЛ: представлення читає повз RLS — %. Повернути: alter view public.<ім''я> set (security_invoker = true);', v_bad;
  end if;
  raise notice 'ok — усі представлення поза списком винятків читають правами того, хто дивиться';
end $$;
SQL

echo "✔ права на бойовій базі відповідають оголошеним"
