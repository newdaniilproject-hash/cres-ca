-- ===========================================================================
-- 0058. Видалення акаунта: обхід графа залежностей замість надії на каскади
-- ===========================================================================
--
-- ЩО БУЛО.
--   delete_my_account() (0024, полагоджена в частині Storage у 0057) прибирала
--   заклад одним рядком: `delete from public.tenants where id = v_tenant`,
--   розраховуючи, що решта поїде каскадом через tenant_id.
--
-- ЧОМУ ЦЕ ДЕФЕКТ.
--   Каскад від tenants справді знімає рядки з таблиць першого рівня, але
--   всередині орендаря є дванадцять зв'язків із `on delete restrict`:
--     bookings.offering_id, bookings.variant_id, material_containers.batch_id,
--     order_items.offering_id, order_items.variant_id, stock_count_lines.variant_id,
--     stock_movements.material_id, stock_movements.variant_id,
--     stock_receipt_lines.material_id, stock_receipt_lines.variant_id,
--     stock_reservations.variant_id, variant_materials.material_id.
--   Це не помилка схеми, а захист: він не дає стерти матеріал, за яким уже є рух,
--   тобто не дає загубити журнал. Каскад від батька його не «передавлює» —
--   Postgres валить усю операцію:
--     23503: update or delete on table "materials" violates foreign key
--     constraint "stock_receipt_lines_material_id_fkey"
--   Через це видалення акаунта не спрацювало жодного разу: користувач тиснув
--   кнопку і отримував помилку, дані лишалися в базі.
--
-- ЧИМ ЗАГРОЖУВАЛО.
--   Порушення Apple 5.1.1(v) (застосунок із реєстрацією зобов'язаний давати
--   видалити акаунт) — блокер релізу; порушення домовленості з клієнтом
--   «дані закладу — власність клієнта»; і GDPR/152-ФЗ-подібні вимоги на
--   стирання персональних даних.
--
-- ЩО СТАЛО.
--   RESTRICT не чіпаємо — він потрібен у звичайній роботі. Натомість функція
--   тепер сама прибирає дочірні рядки в правильному порядку, а до tenants
--   доходить, коли за орендарем уже нічого не лишилося.
--   Порядок не виписаний руками: public.purge_tenant_rows() будує його на льоту
--   з pg_constraint —
--     1) «таблиця орендаря» = має колонку tenant_id АБО має зовнішній ключ на
--        таблицю орендаря (так під ніж потрапляють і stock_receipt_lines,
--        stock_count_lines, variant_materials, import_errors — вони прив'язані
--        до орендаря через батька);
--     2) рівень таблиці = найдовший ланцюг зовнішніх ключів, що веде до неї;
--        видаляємо від нуля вгору, тобто від листя до кореня.
--   Довідники платформи (categories, specialities, role_grants,
--   order_status_transitions, booking_status_transitions, category_attributes)
--   у це коло не входять — до орендаря вони не прив'язані й лишаються цілі.
--   Так само лишаються загальні шаблони notification_templates із tenant_id is null.
--   Нову таблицю, яку заведуть завтра, функція підхопить сама; якщо ж вона
--   виявиться таблицею орендаря без жодного шляху до tenant_id, буде гучна
--   помилка, а не тихо забуті рядки.
--
--   audit_log обробляється окремо і в кінці: тригер audit_row() пише в нього
--   рядок на КОЖНЕ видалення, тож прибрати його на початку — марно, він тут же
--   наповниться знову. Спершу орендар, потім tenants, і аж тоді журнал.
--
--   Усе це працює під прапорцем app.purging_account = 'on' (діє лише на поточну
--   транзакцію) — єдина законна шпарина в захисті незмінних журналів
--   (audit_log_guard, journal_guard, finance_records_guard, tech_cards_guard,
--   guard_applied_document, staff_no_delete, tenant_members_guard), і існує вона
--   рівно заради видалення акаунта. Поза цим прапорцем усі заборони діють як діяли.
-- ===========================================================================

create or replace function public.purge_tenant_rows(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  r      record;
  v_pred text;
begin
  -- Функція небезпечна поза сценарієм видалення акаунта, тому вимагаємо прапорець.
  if coalesce(current_setting('app.purging_account', true), 'off') <> 'on' then
    raise exception 'purge_tenant_rows() викликається лише під час видалення акаунта';
  end if;

  for r in
    with recursive
    fk as (
      select distinct c.conrelid as child, c.confrelid as parent
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class cc     on cc.oid = c.conrelid
        join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace and cn.nspname = 'public'
        join pg_catalog.pg_class pc     on pc.oid = c.confrelid
        join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
       where c.contype = 'f'
         and c.conrelid <> c.confrelid          -- посилання на себе порядку не задає
    ),
    owned as (
      select c.oid as tbl
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind = 'r'
         and exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id'
                        and a.attnum > 0 and not a.attisdropped)
      union
      select f.child from fk f join owned o on o.tbl = f.parent
    ),
    path(root, node, depth) as (
      select f.child, f.parent, 1 from fk f
      union all
      select p.root, f.parent, p.depth + 1
        from path p join fk f on f.child = p.node
       where p.depth < 30                        -- запобіжник від циклів у схемі
    )
    select o.tbl                                                as tbl,
           coalesce((select max(p.depth) from path p where p.node = o.tbl), 0) as lvl,
           exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = o.tbl and a.attname = 'tenant_id'
                      and a.attnum > 0 and not a.attisdropped)  as has_tenant
      from owned o
     where o.tbl <> 'public.audit_log'::regclass                -- журнал — в кінці, окремо
     order by lvl, o.tbl::regclass::text
  loop
    if r.has_tenant then
      execute format('delete from %s where tenant_id = $1', r.tbl::regclass) using p_tenant;
    else
      -- Таблиця без tenant_id: прив'язана до орендаря через батька.
      -- Беремо всі однопольні зовнішні ключі на таблиці, що мають tenant_id.
      select string_agg(
               format('exists (select 1 from %s p where p.%I = t.%I and p.tenant_id = $1)',
                      c.confrelid::regclass, pa.attname, ca.attname),
               ' or ')
        into v_pred
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_attribute ca on ca.attrelid = c.conrelid  and ca.attnum = c.conkey[1]
        join pg_catalog.pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
       where c.contype = 'f'
         and c.conrelid = r.tbl
         and pg_catalog.array_length(c.conkey, 1) = 1
         and exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = c.confrelid and a.attname = 'tenant_id'
                        and a.attnum > 0 and not a.attisdropped);

      if v_pred is null then
        raise exception 'таблиця % належить орендарю, але шляху до tenant_id не знайдено — допишіть правило в purge_tenant_rows()', r.tbl::regclass;
      end if;

      execute format('delete from %s t where %s', r.tbl::regclass, v_pred) using p_tenant;
    end if;
  end loop;
end;
$fn$;

revoke all on function public.purge_tenant_rows(uuid) from public;
revoke all on function public.purge_tenant_rows(uuid) from anon, authenticated;

comment on function public.purge_tenant_rows(uuid) is
  'Прибирає всі рядки орендаря в порядку від листя до кореня (порядок рахується з pg_constraint). Службова: працює лише під app.purging_account = ''on''.';


create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_files  bigint;
begin
  if v_uid is null then
    raise exception 'не автентифіковано';
  end if;

  -- Спершу перераховуємо файли по всіх закладах, які підуть разом із людиною.
  -- Розмежування — першим сегментом шляху <tenant_id>/… (правило 1).
  select count(*) into v_files
    from storage.objects o
   where exists (
     select 1
       from public.tenant_members tm
      where tm.user_id = v_uid
        and tm.role = 'owner'
        and o.name like tm.tenant_id::text || '/%'
        and (select count(*) from public.tenant_members x
              where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1);

  if v_files > 0 then
    raise exception 'спочатку видаліть файли закладу через Storage API: залишилось %', v_files
      using hint = 'Видалення рядків storage.objects із SQL заборонене захистом Supabase (protect_objects_delete). Файли прибирає застосунок, базу — ця функція.';
  end if;

  -- true = лише на поточну транзакцію. Це єдина законна шпарина в захисті
  -- незмінних журналів, і вона існує рівно заради видалення акаунта.
  perform set_config('app.purging_account', 'on', true);

  for v_tenant in
    select tm.tenant_id
      from public.tenant_members tm
     where tm.user_id = v_uid
       and tm.role = 'owner'
       and (select count(*) from public.tenant_members x
             where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1
  loop
    -- Обхід графа залежностей: діти раніше за батьків, інакше RESTRICT (див. шапку).
    perform public.purge_tenant_rows(v_tenant);
    delete from public.tenants where id = v_tenant;
    -- Аж тепер журнал: до цього рядка тригер audit_row() дописував у нього
    -- запис на кожне видалення, тож раніше чистити його не мало сенсу.
    delete from public.audit_log where tenant_id = v_tenant;
  end loop;

  delete from public.tenant_members where user_id = v_uid;
  delete from public.audit_log where actor_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$fn$;

comment on function public.delete_my_account() is
  'Видаляє акаунт і всі заклади, де людина — єдиний власник. Вимога Apple 5.1.1(v).';
