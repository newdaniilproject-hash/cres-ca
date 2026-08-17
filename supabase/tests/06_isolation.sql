-- 06_isolation.sql — изоляция арендаторов. Проверяется попыткой, а не чтением политик:
-- заводятся два арендатора с полным набором данных, и от имени владельца первого
-- делается попытка увидеть и тронуть строки второго. Ноль строк — прошло.
--
-- Правило 1 CLAUDE.md («у каждой строки данных есть tenant_id») проверяется здесь
-- целиком: перебор идёт по КАЖДОЙ таблице с колонкой tenant_id, а не по списку,
-- записанному руками. Появится новая таблица — она попадёт в перебор сама.
--
-- Регрессии, которые этот файл держит закрытыми:
--   0029 — stock_low_view / stock_value_view отдавали чужие остатки;
--   0033 — tenant_domains отдавалась всем подряд, track_order отдавал заказ
--          арендатора, который ещё не опубликован.
--
-- Файл самодостаточен: сам выдаёт гранты, сам заводит пользователей и данные.
-- Весь тест обёрнут в транзакцию с откатом — после него в базе не остаётся
-- ни одной строки, и следующие тесты видят её такой же, какой она была.

\set ON_ERROR_STOP on

begin;

-- Гранты те же, что в 01_permissions.sql: 06 обязан работать и в одиночку.
-- Оговорка оттуда же — скопом выданные права затирают адресные revoke
-- из миграций, поэтому revoke переигрываем обратно.
grant usage on schema public to anon, authenticated;
revoke select on public.stock_low_view   from anon;
revoke select on public.stock_value_view from anon;

insert into auth.users (id, email) values
  ('16161616-0000-0000-0000-000000000001','iso-owner-a@test'),
  ('26262626-0000-0000-0000-000000000002','iso-owner-b@test');

-- A опубликован, B — нет. Это худший случай для B: если бы B был опубликован,
-- часть его строк была бы видна законно (общий каталог), и проверка размылась бы.
-- Неопубликованный арендатор не должен просвечивать НИГДЕ и НИКАК.
insert into public.tenants (id, slug, name, kind, status, storefront_enabled, listed_in_catalog,
                            city, lat, lng, legal_name, tax_id, contact_email, contact_phone, modules)
values ('a6a6a6a6-0000-0000-0000-000000000001','iso-a','ІЗОЛЯЦІЯ А','both','active',true,true,
        'ІЗОМІСТО',50.0,36.0,'ТОВ ІЗО А','1111111111','a@iso.test','+380990000001',
        enum_range(null::public.tenant_module)),
       ('b6b6b6b6-0000-0000-0000-000000000002','iso-b','ІЗОЛЯЦІЯ Б','both','draft',false,false,
        'ІЗОМІСТО',50.1,36.1,'ТОВ ІЗО Б','2222222222','b@iso.test','+380990000002',
        enum_range(null::public.tenant_module));

insert into public.tenant_members (tenant_id, user_id, role) values
  ('a6a6a6a6-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001','owner'),
  ('b6b6b6b6-0000-0000-0000-000000000002','26262626-0000-0000-0000-000000000002','owner');

-- Вход: токен собирает тот же хук, что и в бою. Claims руками не имитируем —
-- иначе тест проверял бы собственную выдумку о форме токена.
create or replace function test.iso_login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

-- Посев одного арендатора во все таблицы разом. Пустая таблица изоляцию
-- не проверяет: там нечему протечь, поэтому заводим строку везде, где можно.
create or replace function test.iso_seed(t uuid, u uuid, s text) returns void
language plpgsql as $$
declare
  v_off uuid; v_var uuid; v_mat uuid; v_cust uuid; v_staff uuid; v_ord uuid;
  v_col uuid; v_batch uuid; v_sup uuid; v_loc uuid; v_task uuid; v_int uuid;
  v_job uuid; v_rcpt uuid; v_cnt uuid; v_fc uuid;
begin
  insert into public.tenant_domains (tenant_id, hostname, is_primary, verified_at)
       values (t, 'iso-'||s||'.example', true, now());
  insert into public.suppliers (tenant_id, name) values (t,'ІЗО постачальник') returning id into v_sup;
  insert into public.storage_locations (tenant_id, name) values (t,'ІЗО склад') returning id into v_loc;

  -- Слаг и артикул нарочно ОДИНАКОВЫЕ у обоих арендаторов: уникальность
  -- обязана быть пер-арендаторной. Глобальная тут же уронила бы посев.
  insert into public.offerings (tenant_id, kind, status, slug, title, sku, price, listed, published_at)
       values (t,'product','active','iso-item','ІЗО товар','ISO-SKU-1',100,true,now()) returning id into v_off;
  insert into public.offering_variants (tenant_id, offering_id, name, sku, price, cost, min_stock_threshold)
       values (t, v_off,'ІЗО варіант','ISO-SKU-1',100,50,5) returning id into v_var;
  insert into public.offering_media (tenant_id, offering_id, path) values (t, v_off, t::text||'/media/iso.jpg');
  insert into public.collections (tenant_id, slug, name) values (t,'iso-col','ІЗО добірка') returning id into v_col;
  insert into public.collection_items (collection_id, offering_id, tenant_id) values (v_col, v_off, t);

  insert into public.materials (tenant_id, name, unit, min_stock_threshold, is_cosmetic, pao_months,
                                supplier_id, location_id, sku)
       values (t,'ІЗО матеріал','мл',5,true,6,v_sup,v_loc,'ISO-M-1') returning id into v_mat;
  insert into public.material_barcodes (material_id, barcode, tenant_id) values (v_mat,'ISO-'||s||'-BC', t);
  insert into public.variant_materials (variant_id, material_id, quantity_per_unit) values (v_var, v_mat, 2);
  insert into public.material_batches (tenant_id, material_id, batch_number, expiry_date, created_by, supplier_id)
       values (t, v_mat,'ISO-B1', current_date + 365, u, v_sup) returning id into v_batch;
  insert into public.material_containers (tenant_id, material_id, batch_id, code, status, created_by)
       values (t, v_mat, v_batch,'ISO-C1','opened', u);
  insert into public.material_documents (tenant_id, material_id, kind, title, path, uploaded_by)
       values (t, v_mat,'msds','ІЗО MSDS', t::text||'/docs/iso.pdf', u);

  -- Движение пишем прямой вставкой намеренно: предмет этого файла — изоляция,
  -- а сходимость кэша с журналом проверяет 02_stock.sql на своих данных.
  insert into public.stock_movements (tenant_id, material_id, movement_type, quantity, created_by)
       values (t, v_mat,'receipt',10, u);
  insert into public.stock_reservations (tenant_id, variant_id, quantity, reference_type, reference_id)
       values (t, v_var, 1,'order', gen_random_uuid());
  insert into public.stock_receipts (tenant_id, created_by, supplier_id) values (t, u, v_sup) returning id into v_rcpt;
  insert into public.stock_receipt_lines (receipt_id, material_id, quantity) values (v_rcpt, v_mat, 5);
  insert into public.stock_counts (tenant_id, started_by) values (t, u) returning id into v_cnt;
  insert into public.stock_count_lines (count_id, variant_id, expected_qty) values (v_cnt, v_var, 0);

  insert into public.customers (tenant_id, name, phone, email)
       values (t,'ІЗО клієнт','+38099000'||s||'11','k'||s||'@iso.test') returning id into v_cust;
  insert into public.order_counters (tenant_id, last_number) values (t, 1);
  insert into public.orders (tenant_id, number, customer_id, contact_name, contact_phone, created_by)
       values (t, 1, v_cust,'ІЗО контакт','+380991112233', u) returning id into v_ord;
  insert into public.order_items (order_id, tenant_id, offering_id, variant_id, title, variant_name,
                                  unit_price, quantity)
       values (v_ord, t, v_off, v_var,'ІЗО товар','ІЗО варіант',100,1);
  insert into public.order_events (order_id, tenant_id, to_status) values (v_ord, t,'new');
  insert into public.shipments (tenant_id, order_id, created_by) values (t, v_ord, u);

  insert into public.finance_categories (tenant_id, kind, name) values (t,'income','ІЗО категорія') returning id into v_fc;
  insert into public.finance_records (tenant_id, kind, amount, created_by, category_id)
       values (t,'income',100, u, v_fc);
  insert into public.reminders (tenant_id, title, due_at, created_by)
       values (t,'ІЗО нагадування', now() + interval '1 day', u);

  insert into public.staff (tenant_id, name) values (t,'ІЗО майстер') returning id into v_staff;
  insert into public.staff_services (staff_id, offering_id, tenant_id) values (v_staff, v_off, t);
  insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
       values (t, v_staff, 1,'09:00','18:00');
  insert into public.time_off (tenant_id, staff_id, kind, period)
       values (t, v_staff,'vacation', tstzrange(now() + interval '10 day', now() + interval '12 day'));
  insert into public.booking_counters (tenant_id, last_number) values (t, 1);
  insert into public.bookings (tenant_id, number, staff_id, offering_id, variant_id, customer_id,
                               period, service_ends_at, title, variant_name, price, contact_name, created_by)
       values (t, 1, v_staff, v_off, v_var, v_cust,
               tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'),
               now() + interval '1 day 1 hour','ІЗО послуга','ІЗО варіант',100,'ІЗО контакт', u);

  insert into public.notification_templates (tenant_id, event, channel, body)
       values (t,'iso.event','email','ІЗО тіло');
  insert into public.notification_outbox (tenant_id, event, channel, dedupe_key, user_id)
       values (t,'iso.event','email','iso-'||s, u);
  insert into public.integrations (tenant_id, provider, created_by) values (t,'nova_poshta', u) returning id into v_int;
  insert into public.integration_access_log (tenant_id, integration_id, purpose) values (t, v_int,'iso');
  insert into public.import_jobs (tenant_id, kind, created_by) values (t,'csv', u) returning id into v_job;
  insert into public.import_errors (job_id, row_number, message) values (v_job, 1,'ІЗО помилка');
  insert into public.ai_jobs (tenant_id, kind, created_by, offering_id) values (t,'offering_description', u, v_off);

  insert into public.sanitation_solutions (tenant_id, agent_name, concentration, volume, expires_at, prepared_by)
       values (t,'ІЗО засіб','1%',5, now() + interval '1 day', u);
  insert into public.cleaning_tasks (tenant_id, name) values (t,'ІЗО прибирання') returning id into v_task;
  insert into public.cleaning_entries (tenant_id, task_id, performed_by) values (t, v_task, u);
  insert into public.sterilization_cycles (tenant_id, device, temperature_c, duration_minutes,
                                           indicator_ok, performed_by)
       values (t,'ІЗО автоклав',180,60,true, u);
  insert into public.tech_cards (tenant_id, title, approved_by) values (t,'ІЗО техкарта', u);
  -- 0085. Журнал безопасности тоже с tenant_id, значит попадает в перебор
  -- ниже. Строку заводим прямой вставкой: писать в него разрешено только
  -- definer-функциям, а предмет проверки здесь — изоляция, а не то, кто
  -- вправе писать (это проверяет 22_security_perimeter.sql).
  insert into public.security_events (kind, tenant_id, actor_id, actor_email)
       values ('tenant.foreign_access', t, u, 'iso-'||s||'@test');
  -- audit_log наполняется сам, триггерами audit_row поверх вставок выше.
end $$;

select test.iso_seed('a6a6a6a6-0000-0000-0000-000000000001','16161616-0000-0000-0000-000000000001','a');
select test.iso_seed('b6b6b6b6-0000-0000-0000-000000000002','26262626-0000-0000-0000-000000000002','b');

-- Перебор всех таблиц с tenant_id. Считаем дважды: сколько строк у чужого
-- арендатора есть на самом деле (под postgres, RLS не применяется) и сколько
-- из них видно под ролью authenticated с токеном чужого владельца.
-- Третий вердикт, «посев пуст», нужен от самообмана: таблица, в которую
-- забыли завести строку, проходит проверку молча и ничего не доказывает.
create or replace function test.iso_leaks(p_foreign uuid)
returns table (таблица text, заведено int, видно int, вердикт text)
language plpgsql as $$
declare r record; всего int; видимо int;
begin
  for r in
    select c.relname::text as t
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
     where ns.nspname = 'public' and c.relkind = 'r'
     order by 1
  loop
    execute format('select count(*)::int from public.%I where tenant_id = %L', r.t, p_foreign) into всего;
    begin
      execute 'set local role authenticated';
      execute format('select count(*)::int from public.%I where tenant_id = %L', r.t, p_foreign) into видимо;
      execute 'reset role';
    exception when others then
      execute 'reset role';
      таблица := r.t; заведено := всего; видно := -1;
      вердикт := 'ПРОВАЛ: запрос упал — ' || sqlerrm;
      return next; continue;
    end;
    таблица := r.t; заведено := всего; видно := видимо;
    вердикт := case
                 when видимо > 0 then 'ПРОВАЛ'
                 when всего = 0  then 'посев пуст — проверка не значима'
                 else 'ok'
               end;
    return next;
  end loop;
end $$;

\echo '--- вход владельцем арендатора А'
select test.iso_login('16161616-0000-0000-0000-000000000001') is not null as вошли;

\echo '--- правило 1: ни одной строки чужого арендатора ни в одной таблице с tenant_id'
select * from test.iso_leaks('b6b6b6b6-0000-0000-0000-000000000002');

do $$ declare n int; m int; begin
  select count(*) filter (where вердикт like 'ПРОВАЛ%'),
         count(*) filter (where вердикт like 'посев%')
    into n, m
    from test.iso_leaks('b6b6b6b6-0000-0000-0000-000000000002');
  if n > 0 then raise exception 'ПРОВАЛ: чужие строки видны в % таблицах', n; end if;
  if m > 0 then
    raise notice 'внимание — % таблиц не покрыты посевом, изоляция по ним не доказана', m;
  end if;
  raise notice 'ok — чужих строк не видно ни в одной таблице с tenant_id';
end $$;

\echo '--- регрессия 0029: представления склада не отдают чужие остатки'
set role authenticated;
select (select count(*) from public.stock_low_view
         where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002') as низкий_остаток_чужого_ожид_0,
       (select count(*) from public.stock_value_view
         where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002') as стоимость_чужого_ожид_0,
       (select count(*) from public.stock_low_view
         where tenant_id = 'a6a6a6a6-0000-0000-0000-000000000001') as свой_ожид_больше_0;
reset role;

do $$ declare n int; begin
  execute 'set local role authenticated';
  select (select count(*) from public.stock_low_view   where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002')
       + (select count(*) from public.stock_value_view where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002')
    into n;
  execute 'reset role';
  if n > 0 then raise exception 'ПРОВАЛ: представления склада отдают чужого арендатора (% строк)', n; end if;
  raise notice 'ok — представления склада режут по tenants_with(''stock.read'')';
end $$;

\echo '--- регрессия 0033: tenant_domains не отдаётся ни анониму, ни чужому вошедшему'
do $$ declare чужие int; всего_анон int; begin
  execute 'set local role authenticated';                 -- токен владельца А
  select count(*) into чужие from public.tenant_domains
   where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002';
  execute 'reset role';
  if чужие > 0 then raise exception 'ПРОВАЛ: владелец А видит домены арендатора Б (% строк)', чужие; end if;

  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into всего_анон from public.tenant_domains;
  execute 'reset role';
  if всего_анон > 0 then raise exception 'ПРОВАЛ: аноним видит домены (% строк)', всего_анон; end if;

  raise notice 'ok — домены видит только тот, у кого settings.read в этом арендаторе';
end $$;

-- Возвращаем токен владельца А: предыдущая проверка подменяла claims на анонимные.
\set QUIET on
select test.iso_login('16161616-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- регрессия 0033: track_order молчит про неопубликованного арендатора'
do $$ declare б int; а int; а_чужой_тел int; begin
  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into б            from public.track_order('iso-b', 1, '+380991112233');
  select count(*) into а            from public.track_order('iso-a', 1, '+380991112233');
  select count(*) into а_чужой_тел  from public.track_order('iso-a', 1, '+380000000000');
  execute 'reset role';

  if б > 0 then
    raise exception 'ПРОВАЛ: track_order отдал заказ арендатора со статусом draft';
  end if;
  if а_чужой_тел > 0 then
    raise exception 'ПРОВАЛ: track_order отдал заказ по чужому телефону';
  end if;
  if а = 0 then
    raise exception 'ПРОВАЛ: track_order перестал отдавать заказ опубликованного арендатора';
  end if;
  raise notice 'ok — заказ отдаётся только по паре «активный магазин + верный телефон»';
end $$;

\set QUIET on
select test.iso_login('16161616-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- политик using(true) ровно три, и это общие справочники'
select tablename || '.' || policyname as политика
  from pg_policies where schemaname = 'public' and qual = 'true' order by 1;

do $$ declare лишние text; пропали text; with_check_true text; begin
  select string_agg(x, ', ') into лишние from (
    select tablename || '.' || policyname as x from pg_policies
     where schemaname = 'public' and qual = 'true'
    except select unnest(array[
      'role_grants.role_grants_read',
      'order_status_transitions.order_status_transitions_read',
      'booking_status_transitions.booking_status_transitions_read',
      -- Четвёртый справочник, добавлен 0077. Потолок скидки по роли —
      -- те же данные для всех заведений, ни одной строки арендатора.
      -- Фильтровать здесь не по чему, и это не нарушение правила 1,
      -- а признак справочника.
      'role_discount_caps.role_discount_caps_read'])) q;
  select string_agg(x, ', ') into пропали from (
    select unnest(array[
      'role_grants.role_grants_read',
      'order_status_transitions.order_status_transitions_read',
      'booking_status_transitions.booking_status_transitions_read',
      'role_discount_caps.role_discount_caps_read']) as x
    except select tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and qual = 'true') q;
  -- with_check(true) на INSERT — та же дыра с другой стороны: строку с чужим
  -- tenant_id принимает кто угодно. Законных случаев нет ни одного.
  select string_agg(tablename || '.' || policyname, ', ') into with_check_true
    from pg_policies where schemaname = 'public' and cmd = 'INSERT' and with_check = 'true';

  if лишние is not null then
    raise exception 'ПРОВАЛ: лишняя политика using(true) — %. Если фильтровать не по чему, значит нарушено правило 1', лишние;
  end if;
  if пропали is not null then
    raise exception 'ПРОВАЛ: пропала законная политика using(true) — %', пропали;
  end if;
  if with_check_true is not null then
    raise exception 'ПРОВАЛ: политика INSERT с with_check(true) — %', with_check_true;
  end if;
  raise notice 'ok — using(true) только на четырёх общих справочниках, with_check(true) нет';
end $$;

\echo '--- список функций, доступных анониму, закрыт: девятнадцать и ни одной больше'
-- Функции, принадлежащие расширениям, из перебора исключены. На проде
-- pgcrypto/citext/pg_trgm живут в схеме extensions и в public не попадают
-- вовсе; на голом стенде `create extension if not exists "pgcrypto"` из 0001
-- кладёт два десятка своих функций в public — это свойство стенда, а не
-- проекта, и правило 7 про них не говорит ничего. Признак — запись
-- в pg_depend с deptype = 'e'.
select p.proname as функция
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and has_function_privilege('anon', p.oid, 'EXECUTE')
   and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                      and d.deptype = 'e')
 order by 1;

do $$ declare лишние text; пропали text;
  -- Восемь точек входа из правила 7 CLAUDE.md: четыре действия и четыре чтения.
  -- Плюс пять названных там же хелперов, которые вызывают сами политики,
  -- применяемые к анониму: без EXECUTE анонимные чтения перестанут работать.
  -- Плюс шесть таких же хелперов, не попавших в текст правила. Признак
  -- допустимости у них тот же и выполняется: ни один не обращается к таблице —
  -- только к разобранному токену (is_platform_staff, is_tenant_member,
  -- jwt_memberships, tenant_has_module, tenant_role) или к переданной строке
  -- (variant_available). Список закрытый: ДВАДЦАТАЯ функция — ПРОВАЛ,
  -- и открывать её нужно отдельным решением, а не побочно в миграции.
  --
  -- Мерило — has_function_privilege, а не поиск anon в proacl: оно ловит
  -- и то, ради чего написано правило 7, — EXECUTE, доставшийся роли PUBLIC.
  ожидаемые text[] := array[
    'active_cities','available_slots','create_booking','create_order',
    'is_platform_staff','is_tenant_member','jwt_memberships','jwt_perms',
    'map_tenants','my_tenants','search_all','storage_tenant','storefront',
    'tenant_can','tenant_has_module','tenant_role','tenants_with',
    'track_order','variant_available'];
begin
  select string_agg(x, ', ') into лишние from (
    select p.proname::text as x from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                          and d.deptype = 'e')
    except select unnest(ожидаемые)) q;
  select string_agg(x, ', ') into пропали from (
    select unnest(ожидаемые) as x
    except select p.proname::text from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.classid = 'pg_proc'::regclass
                          and d.deptype = 'e')) q;

  if лишние is not null then
    raise exception 'ПРОВАЛ: анониму открыта лишняя функция — %', лишние;
  end if;
  if пропали is not null then
    raise exception 'ПРОВАЛ: анониму закрыта нужная функция — %', пропали;
  end if;
  raise notice 'ok — анониму доступны ровно девятнадцать функций из списка';
end $$;

\echo '--- правка чужого арендатора обязана задеть ноль строк'
do $$ declare n int; begin
  execute 'set local role authenticated';
  update public.tenants set name = 'ЗЛОМ' where id = 'b6b6b6b6-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  execute 'reset role';
  if n > 0 then raise exception 'ПРОВАЛ: переименование чужого арендатора задело % строк', n; end if;
  raise notice 'ok — переименование чужого арендатора задело 0 строк';
end $$;

do $$ declare n int; begin
  execute 'set local role authenticated';
  update public.materials set name = 'ЗЛОМ' where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  execute 'reset role';
  if n > 0 then raise exception 'ПРОВАЛ: правка чужого расходника задела % строк', n; end if;
  raise notice 'ok — правка чужого расходника задела 0 строк';
end $$;

\echo '--- удаление чужого клиента обязано задеть ноль строк'
do $$ declare n int; begin
  execute 'set local role authenticated';
  delete from public.customers where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  execute 'reset role';
  if n > 0 then raise exception 'ПРОВАЛ: удаление чужого клиента задело % строк', n; end if;
  raise notice 'ok — удаление чужого клиента задело 0 строк';
end $$;

\echo '--- вставка строки с чужим tenant_id обязана упасть'
do $$ begin
  execute 'set local role authenticated';
  insert into public.materials (tenant_id, name, unit)
       values ('b6b6b6b6-0000-0000-0000-000000000002','ЗЛОМ','шт');
  execute 'reset role';
  raise exception 'ПРОВАЛ: вставка в чужого арендатора прошла';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

\echo '--- движение по чужому складу обязано упасть, по своему — пройти'
do $$ declare m uuid; begin
  select id into m from public.materials where tenant_id = 'b6b6b6b6-0000-0000-0000-000000000002' limit 1;
  execute 'set local role authenticated';
  perform public.record_stock_movement('b6b6b6b6-0000-0000-0000-000000000002','receipt',5,null,m);
  execute 'reset role';
  raise exception 'ПРОВАЛ: движение по чужому складу прошло';
exception when others then
  execute 'reset role';
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm; end $$;

do $$ declare m uuid; begin
  select id into m from public.materials where tenant_id = 'a6a6a6a6-0000-0000-0000-000000000001' limit 1;
  execute 'set local role authenticated';
  perform public.record_stock_movement('a6a6a6a6-0000-0000-0000-000000000001','receipt',5,null,m);
  execute 'reset role';
  raise notice 'ok — по своему складу движение проходит: запрет не задевает штатный путь';
exception when others then
  execute 'reset role';
  raise exception 'ПРОВАЛ: сломан штатный путь, движение по своему складу не прошло — %', sqlerrm;
end $$;

\echo '--- строк с несуществующим арендатором нет ни в одной таблице'
do $$ declare r record; n int; сироты text := ''; begin
  for r in
    select c.relname::text as t
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
     where ns.nspname = 'public' and c.relkind = 'r'
     order by 1
  loop
    execute format('select count(*)::int from public.%I x where x.tenant_id is not null
                     and not exists (select 1 from public.tenants t where t.id = x.tenant_id)', r.t) into n;
    if n > 0 then сироты := сироты || r.t || '=' || n || '; '; end if;
  end loop;
  if сироты <> '' then
    raise exception 'ПРОВАЛ: строки с несуществующим tenant_id — %', сироты;
  end if;
  raise notice 'ok — сирот нет';
end $$;

\echo '--- глобально уникальны ровно пять ключей (четыре справочных + хеш токена), остальное — пер-арендаторно'
do $$ declare лишние text; begin
  -- Артикул и слаг товара уже проверены посевом: оба арендатора завели
  -- iso-item / ISO-SKU-1, и вставка прошла. Здесь ловим обратное — уникальный
  -- индекс, случайно заведённый без tenant_id и поэтому общий на всю платформу.
  select string_agg(c.relname || ': ' || i.indexrelid::regclass::text, ', ') into лишние
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and i.indisunique and not i.indisprimary
     and not exists (select 1 from pg_attribute a
                      where a.attrelid = i.indrelid and a.attname = 'tenant_id'
                        and a.attnum = any(i.indkey))
     and c.relname not in ('categories','specialities','tenants','tenant_domains',
                           'category_attributes','profiles','user_consents')
     -- invitations.token_hash (0050; 0054 выдаёт временный доступ инспектору
     -- через ту же таблицу) — НЕ пер-арендаторный ключ, а предъявительский
     -- секрет платформы, и глобальная уникальность здесь не оплошность,
     -- а требование.
     -- accept_invitation() ищет строку ровно по одному хешу:
     --   where i.token_hash = v_hash and status='pending' ...
     -- Арендатора в этом поиске нет и быть не может: приглашённый ещё не
     -- состоит нигде и на руках у него только сам токен. Добавь мы tenant_id
     -- в уникальный индекс — платформа начала бы РАЗРЕШАТЬ два одинаковых
     -- хеша у разных арендаторов, и та же выборка стала бы неоднозначной:
     -- один токен подходил бы к чужому приглашению. То есть tenant_id в
     -- индексе не усилил бы изоляцию, а проломил бы её.
     -- Оговорка адресная — по колонке token_hash, а не по всей таблице:
     -- любой ДРУГОЙ уникальный индекс без tenant_id на этих таблицах
     -- тест по-прежнему поймает (например, invitations_one_live_per_email
     -- обязан оставаться пер-арендаторным — и остаётся).
     and not (c.relname = 'invitations'
              and exists (select 1 from pg_attribute a
                           where a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                             and a.attname = 'token_hash'))
     -- Индексы по родителю, который сам тенантный, глобальными не являются.
     and not exists (select 1 from pg_attribute a
                      where a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                        and a.attname in ('collection_id','offering_id','staff_id','receipt_id',
                                          'count_id','variant_id','material_id','order_id'))
     and pg_get_indexdef(i.indexrelid) not like '%COALESCE(tenant_id%';
  if лишние is not null then
    raise exception 'ПРОВАЛ: уникальный индекс без tenant_id — %', лишние;
  end if;
  raise notice 'ok — глобально уникальны только slug арендатора, hostname домена, slug категории, slug специальности и хеши предъявительских токенов';
end $$;

rollback;

\echo '--- 06_isolation: данные откачены, база осталась прежней'
