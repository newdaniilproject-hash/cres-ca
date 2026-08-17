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
#     security_invoker при `create or replace`;
#   • 0082 — то же, что 0060, на v_bookings, v_orders, team_access_log
#     и stock_low_view: миграции писали `grant select`, а `grant` ДОБАВЛЯЕТ
#     право к раздаче по умолчанию, а не заменяет её. Пункт 4 ниже появился
#     ровно после этого: три первых проверки ту дыру не видели.
#
# Четыре раза один и тот же механизм. Значит проверка обязана смотреть туда,
# где он работает, — на боевую базу.
#
# ── Что проверяется ───────────────────────────────────────────────────────
#
# 1. Список функций, которые может выполнять anon, совпадает с объявленным.
# 2. Ни одно представление не отдано anon.
# 3. У каждого представления либо security_invoker = true, либо оно названо
#    в списке осознанных исключений с указанием причины.
# 4. Ни одно представление не отдано НИКОМУ на запись.
# 5. Права на функции модуля «Команда» совпадают с объявленными, и удалённые
#    имена не воскресли.
# 6. В `invitations` нельзя писать иначе как функциями.
#
# Третий пункт — про правило 3. Представление без invoker читает таблицы
# правами владельца, мимо RLS. У представлений соответствия это сделано
# НАМЕРЕННО (0062: у инспектора нет stock.read, и с invoker он увидел бы
# пустой реестр). У складских — ошибка, и она уже случалась.
#
# Четвёртый — оборотная сторона третьего, и без него третий опасен: пока
# представление только читает, обход RLS ограничен выдачей, которую автор
# представления написал сам. Как только у роли появляется INSERT/UPDATE/
# DELETE, тем же обходом идёт ЗАПИСЬ — правами владельца, без политик
# и без WITH CHECK, то есть и в чужого арендатора тоже.

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
  --
  -- Функции 0079–0081 (team_overview, permission_audit_log, block_member,
  -- unblock_member, effective_perm_set, assert_grant_within, my_staff_id,
  -- staff_access_guard) сюда НЕ добавлены и не должны: анониму в модуле
  -- «Команда» не открыто ничего. Их права проверяет пункт 5.
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
    -- 0083: два последних среза соответствия. Добавлены сюда 17.08.2026,
    -- и до этого дня проверка краснела на них МЕСЯЦ, начиная с наката 0083.
    -- Это цена не обновлённого списка исключений: сторож, который кричит
    -- всегда, перестают читать, и настоящую находку он уже не донесёт.
    --   compliance_actors    — имена исполнителей журналов. Читает profiles
    --                          и staff, куда инспектору хода нет вовсе.
    --   compliance_offerings — услуги без цен. Читает offerings, которые
    --                          висят на catalog.read, а у инспектора его нет.
    -- Обе фильтруют по собственному WHERE с tenants_with('compliance.read').
    'compliance_actors', 'compliance_offerings',
    -- 0053: срез журнала прав. Читает audit_log, к которому у смотрящего
    -- прямого доступа нет; изоляцию проверяет собственный WHERE
    -- с tenants_with('team.read').
    'team_access_log',
    -- 0090: журнал доступа к данным. Тот же случай и по той же причине:
    -- читает audit_log напрямую, а решает, кому что показать, сам —
    -- владельцу по tenants_with('settings.read'), сотруднику его
    -- собственные строки по actor_id. Запись через него закрыта отдельно
    -- (0095) и проверяется пунктом 4 ниже.
    'data_access_log',
    -- 0078: маскирование телефонов. Эти два ОБЯЗАНЫ быть definer —
    -- они читают колонку, которую смотрящему читать нельзя. Изоляцию
    -- арендатора каждое проверяет собственным WHERE с tenants_with().
    'v_bookings', 'v_orders'];
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

-- ── 4. Представления только читают ────────────────────────────────────────
--
-- Исключений здесь НЕТ и быть не может: у представления нет RLS, поэтому
-- любая запись через него идёт мимо политик. Если понадобилось писать
-- «через представление» — пишется функция SECURITY DEFINER, которая
-- проверяет арендатора сама.
do $$
declare v_bad text;
begin
  select string_agg(distinct g.table_name || ' (' || g.grantee || ': ' || g.privilege_type || ')',
                    ', ' order by g.table_name || ' (' || g.grantee || ': ' || g.privilege_type || ')')
    into v_bad
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where g.table_schema = 'public' and c.relkind = 'v'
     and g.grantee in ('anon', 'authenticated', 'PUBLIC')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  if v_bad is not null then
    raise exception 'ПРОВАЛ: представлення відкриті на запис — %. Definer-представлення пише правами власника, тобто повз RLS і без WITH CHECK. Зняти: revoke insert, update, delete, truncate on public.<ім''я> from anon, authenticated;', v_bad;
  end if;
  raise notice 'ok — представлення нікому не відкриті на запис';
end $$;

-- ── 5. Модуль «Команда»: кто что выполняет ────────────────────────────────
--
-- Разделение простое. Функция, которую зовёт ЭКРАН, обязана быть открыта
-- `authenticated` — иначе экран сломается молча, на нажатии кнопки.
-- Функция, которую зовут ТРИГГЕРЫ и другие функции, обязана быть закрыта:
-- она SECURITY DEFINER и работает правами владельца, а проверку «кто зовёт»
-- делает не она, а тот, кто её вызвал.
--
-- `member_access_ok` закрыта отдельным решением 0081: открытая, она
-- отвечала кому угодно на вопрос «чи заблокований цей у цьому закладі».
do $$
declare
  v_bad text;
  v_screen text[] := array[
    'team_overview', 'team_sessions', 'permission_audit_log',
    'block_member', 'unblock_member', 'my_staff_id',
    'create_invitation', 'revoke_invitation', 'accept_invitation',
    'apply_permission_template', 'end_sessions', 'transfer_ownership'];
  v_service text[] := array[
    'effective_perm_set', 'assert_grant_within', 'member_access_ok',
    'tenant_members_guard', 'staff_access_guard', 'staff_no_delete',
    'permission_audit_immutable', 'custom_access_token_hook'];
  -- Удалены в 0081 (правило 8: выключено значит удалено). Возврат любого
  -- имени означает, что снова существуют два пути одного действия.
  v_gone text[] := array['block_staff', 'unblock_staff'];
begin
  select string_agg(x, ', ' order by x) into v_bad from (
    select unnest(v_screen) as x
    except select p.proname::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: екран команди не може викликати — %. Кнопка впаде на «permission denied for function».', v_bad;
  end if;

  select string_agg(x, ', ' order by x) into v_bad from (
    select unnest(v_service) as x
    intersect select p.proname::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'))) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: службова функція відкрита користувачу — %. Вона SECURITY DEFINER і сама не перевіряє, хто її кличе.', v_bad;
  end if;

  select string_agg(p.proname::text, ', ' order by p.proname::text) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname::text = any(v_gone);
  if v_bad is not null then
    raise exception 'ПРОВАЛ: видалена функція повернулася — %. Два імені одної дії розходяться через півроку (0081).', v_bad;
  end if;

  raise notice 'ok — % функцій екрана відкриті, % службових закриті, видалені не повернулися',
    array_length(v_screen, 1), array_length(v_service, 1);
end $$;

-- ── 6. Приглашения пишутся только функциями ───────────────────────────────
--
-- 0081: у `authenticated` были INSERT и UPDATE прямо на `invitations`,
-- а `accept_invitation` брала роль из строки, ничего не перепроверяя, —
-- то есть приглашение себе с ролью `admin` выписывалось одним INSERT.
-- `create_invitation` и `revoke_invitation` — SECURITY DEFINER и владеют
-- таблицей, права `authenticated` им не нужны. Оставлено ровно SELECT:
-- экран показывает список выписанных приглашений.
do $$
declare v_bad text;
begin
  select string_agg(g.grantee || ': ' || g.privilege_type, ', '
                    order by g.grantee || ': ' || g.privilege_type)
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name = 'invitations'
     and g.grantee in ('anon', 'authenticated', 'PUBLIC')
     and g.privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception 'ПРОВАЛ: у invitations можна писати руками — %. Роль і права беруться зі строки, тобто це видача собі будь-якої ролі.', v_bad;
  end if;

  select string_agg(policyname, ', ' order by policyname) into v_bad
    from pg_policies
   where schemaname = 'public' and tablename = 'invitations' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'ПРОВАЛ: на invitations повернулася політика запису — %.', v_bad;
  end if;

  raise notice 'ok — у invitations лишилося тільки читання';
end $$;
SQL

echo "✔ права на бойовій базі відповідають оголошеним"
