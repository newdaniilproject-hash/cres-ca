-- 24_step7.sql — шаг 7: журнал доступа к данным, маскировка контактов,
-- доступ сотрудников платформы и срок хранения (миграции 0089–0097).
--
-- Почему эти сценарии, а не «покрытие». Каждый из них — обещание, данное
-- клиенту словами, а не строкой кода:
--   • «мы знаем, кто смотрел ваши данные» — 0090;
--   • «контакты видит не всякий сотрудник» — 0078 и 0090;
--   • «наша поддержка не ходит в вашу базу без спроса» — 0093;
--   • «мы не держим ваши данные дольше, чем нужно» — 0091, 0092, 0097;
--   • «журнал доступа нельзя подделать» — 0095.
-- Обещание без падающего теста — это намерение, а не свойство.
--
-- Файл заводит СВОИХ людей и СВОЙ заклад и после себя базу не чистит:
-- он стоит после 22 и 23 по тому же правилу, что и они.

\set ON_ERROR_STOP on

-- ── Фикстуры ────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('f7f70000-0000-0000-0000-0000000000a1','step7-owner@test'),
  ('f7f70000-0000-0000-0000-0000000000a2','step7-viewer@test'),
  ('f7f70000-0000-0000-0000-0000000000a3','step7-staff@test'),
  ('f7f70000-0000-0000-0000-0000000000a4','step7-outsider@test');

insert into public.tenants (id, slug, name, status, storefront_enabled)
values ('f7f70000-0000-0000-0000-0000000000b1','step7-shop','Крок 7','active', false);

insert into public.tenant_members (tenant_id, user_id, role) values
  ('f7f70000-0000-0000-0000-0000000000b1','f7f70000-0000-0000-0000-0000000000a1','owner'),
  ('f7f70000-0000-0000-0000-0000000000b1','f7f70000-0000-0000-0000-0000000000a2','viewer');

insert into public.customers (id, tenant_id, name, phone, email)
values ('f7f70000-0000-0000-0000-0000000000c1','f7f70000-0000-0000-0000-0000000000b1',
        'Оксана Клієнт','+380671112233','oksana@test');

insert into public.materials (id, tenant_id, name, unit)
values ('f7f70000-0000-0000-0000-0000000000e1','f7f70000-0000-0000-0000-0000000000b1','Канекалон','пачка');

insert into public.material_documents (id, tenant_id, material_id, kind, title, path, uploaded_by)
values ('f7f70000-0000-0000-0000-0000000000e2','f7f70000-0000-0000-0000-0000000000b1',
        'f7f70000-0000-0000-0000-0000000000e1','msds','MSDS канекалон',
        'f7f70000-0000-0000-0000-0000000000b1/msds.pdf',
        'f7f70000-0000-0000-0000-0000000000a1');

-- ── 0090/А: открыл карточку — строка в журнале доступа ──────────────────────

\echo '--- 0090/А: карточка клиента пишется в журнал доступа'
\set QUIET on
select test.login('f7f70000-0000-0000-0000-0000000000a1');
\set QUIET off
set role authenticated;
select count(*) as картка_ожид_1
  from public.customer_card('f7f70000-0000-0000-0000-0000000000b1',
                            'f7f70000-0000-0000-0000-0000000000c1');
reset role;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.audit_log
   where tenant_id = 'f7f70000-0000-0000-0000-0000000000b1'
     and action = 'viewed' and entity = 'customers'
     and entity_id = 'f7f70000-0000-0000-0000-0000000000c1';
  if v_n <> 1 then
    raise exception 'ПРОВАЛ: відкриття картки не потрапило до журналу доступу (рядків %)', v_n;
  end if;
  raise notice 'ok — відкриття картки записано';
end $$;

\echo '--- 0090/Б: выгрузка базы пишется отдельным действием и с числом строк'
\set QUIET on
select test.login('f7f70000-0000-0000-0000-0000000000a1');
\set QUIET off
set role authenticated;
select count(*) as вивантажено_ожид_1
  from public.customers_export('f7f70000-0000-0000-0000-0000000000b1');
reset role;

do $$
declare v_label text;
begin
  select label into v_label from public.audit_log
   where tenant_id = 'f7f70000-0000-0000-0000-0000000000b1'
     and action = 'exported' and entity = 'customers'
   order by at desc limit 1;
  if v_label is null then
    raise exception 'ПРОВАЛ: вивантаження бази клієнтів не потрапило до журналу';
  end if;
  if v_label not like '1 записів%' then
    raise exception 'ПРОВАЛ: у підписі немає числа рядків — по журналу не видно, вивантажили картку чи всю базу (підпис: %)', v_label;
  end if;
  raise notice 'ok — вивантаження записано з числом рядків: %', v_label;
end $$;

\echo '--- 0090/В: скачивание документа пишется и отдаёт путь'
\set QUIET on
select test.login('f7f70000-0000-0000-0000-0000000000a1');
\set QUIET off
set role authenticated;
select public.document_access('f7f70000-0000-0000-0000-0000000000b1',
                              'f7f70000-0000-0000-0000-0000000000e2') as шлях;
reset role;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.audit_log
   where tenant_id = 'f7f70000-0000-0000-0000-0000000000b1'
     and action = 'downloaded' and entity = 'material_documents';
  if v_n <> 1 then
    raise exception 'ПРОВАЛ: скачування документа не потрапило до журналу (рядків %)', v_n;
  end if;
  raise notice 'ok — скачування документа записано';
end $$;

-- ── 0090/Г: контакты в карточке видит не всякий ─────────────────────────────
--
-- viewer имеет customers.read и НЕ имеет customers.contacts. Карточка ему
-- открывается, но телефон и почта в ней замаскированы. Это не косметика:
-- именно так «мастер видит клиента, но не может унести базу».

\echo '--- 0090/Г: без customers.contacts телефон и почта замаскированы'
\set QUIET on
select test.login('f7f70000-0000-0000-0000-0000000000a2');
\set QUIET off
set role authenticated;
do $$
declare r record;
begin
  select * into r from public.customer_card('f7f70000-0000-0000-0000-0000000000b1',
                                            'f7f70000-0000-0000-0000-0000000000c1');
  if r.name is null then
    raise exception 'ПРОВАЛ: картка не відкрилась тому, у кого є customers.read';
  end if;
  if r.phone = '+380671112233' then
    raise exception 'ПРОВАЛ: телефон відданий тому, у кого немає customers.contacts';
  end if;
  if right(r.phone, 2) <> '33' then
    raise exception 'ПРОВАЛ: телефон не замаскований, а знищений — рядок % не звести зі зверненням клієнта', r.phone;
  end if;
  if r.email::text = 'oksana@test' then
    raise exception 'ПРОВАЛ: пошта віддана тому, у кого немає customers.contacts';
  end if;
  raise notice 'ok — контакти замасковані: % / %', r.phone, r.email;
end $$;
reset role;

do $$
declare v_label text;
begin
  select label into v_label from public.audit_log
   where tenant_id = 'f7f70000-0000-0000-0000-0000000000b1'
     and action = 'viewed' and actor_id = 'f7f70000-0000-0000-0000-0000000000a2'
   order by at desc limit 1;
  if v_label is distinct from 'картка без контактів' then
    raise exception 'ПРОВАЛ: у журналі не видно, з контактами відкрито картку чи без (підпис: %)', coalesce(v_label,'нема рядка');
  end if;
  raise notice 'ok — у журналі видно, що картку відкрито без контактів';
end $$;

-- ── 0095: журнал доступа нельзя подделать ──────────────────────────────────
--
-- Представление data_access_log — автоматически обновляемое и НЕ
-- security_invoker, значит запись через него шла бы правами владельца
-- мимо RLS таблицы audit_log. 0090 отобрала право у public и anon и
-- забыла authenticated; 0095 это закрыла. Проверка — на праве, а не на
-- попытке записи: удавшаяся попытка оставила бы в журнале подделку,
-- которую этот же файл потом не отличит от настоящей строки.

\echo '--- 0095: представление журнала доступа не отдано на запись'
do $$
declare v_bad text;
begin
  select string_agg(distinct g.table_name || ' (' || g.grantee || ': ' || g.privilege_type || ')', ', ')
    into v_bad
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name in ('data_access_log','platform_access_grants')
     and g.grantee in ('anon','authenticated','PUBLIC')
     and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_bad is not null then
    raise exception 'ПРОВАЛ: журнал доступу можна підробити — %', v_bad;
  end if;
  raise notice 'ok — журнал доступу і гранти платформи лише читаються';
end $$;

\echo '--- 0099: контакты клиента не читаются прямым запросом к таблице'
-- Дыра, ради которой написана 0099: маскировка в customer_card обходилась
-- одним GET /rest/v1/customers?select=phone. Проверяется ПРАВО, а не попытка:
-- под ролью postgres в стенде запрос прошёл бы в любом случае.
do $$
declare v_bad text;
begin
  select string_agg(g.grantee || ':' || g.column_name, ', ')
    into v_bad
    from information_schema.column_privileges g
   where g.table_schema = 'public' and g.table_name = 'customers'
     and g.column_name in ('phone','email')
     and g.grantee in ('anon','authenticated','PUBLIC')
     and g.privilege_type = 'SELECT';
  if v_bad is not null then
    raise exception 'ПРОВАЛ: контакти клієнта читаються напряму — %', v_bad;
  end if;
  raise notice 'ok — контакти клієнта віддають лише customer_card і customers_export';
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from information_schema.column_privileges g
   where g.table_schema = 'public' and g.table_name = 'customers'
     and g.column_name = 'name' and g.grantee = 'authenticated'
     and g.privilege_type = 'SELECT';
  if v_n <> 1 then
    raise exception 'ПРОВАЛ: разом з контактами закрито і ім''я — список клієнтів перестав працювати';
  end if;
  raise notice 'ok — решта колонок відкрита, список клієнтів працює';
end $$;

-- ── 0093: сотрудник платформы без гранта не видит ничего ───────────────────

\echo '--- 0093: признак is_staff сам по себе не открывает чужие данные'
update public.profiles set is_staff = true
 where id = 'f7f70000-0000-0000-0000-0000000000a3';

\set QUIET on
select test.login('f7f70000-0000-0000-0000-0000000000a3');
\set QUIET off
set role authenticated;
select count(*) as чужий_профіль_ожид_0
  from public.profiles where id = 'f7f70000-0000-0000-0000-0000000000a4';
select public.has_platform_access('f7f70000-0000-0000-0000-0000000000b1') as доступ_ожид_f;
reset role;

do $$
declare v_n integer;
begin
  perform test.login('f7f70000-0000-0000-0000-0000000000a3');
  set local role authenticated;
  select count(*) into v_n from public.profiles where id = 'f7f70000-0000-0000-0000-0000000000a4';
  reset role;
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: співробітник платформи без гранта читає чужі профілі';
  end if;
  raise notice 'ok — без гранта чужі профілі закриті';
end $$;

\echo '--- 0093: с действующим грантом — открывается, письмо владельцу поставлено'
insert into public.platform_access_grants (staff_user_id, tenant_id, reason, expires_at)
values ('f7f70000-0000-0000-0000-0000000000a3','f7f70000-0000-0000-0000-0000000000b1',
        'звернення до підтримки: не друкуються наліпки', now() + interval '2 days');

do $$
declare v_n integer;
begin
  perform test.login('f7f70000-0000-0000-0000-0000000000a3');
  set local role authenticated;
  select count(*) into v_n from public.profiles where id = 'f7f70000-0000-0000-0000-0000000000a4';
  reset role;
  if v_n <> 1 then
    raise exception 'ПРОВАЛ: діючий грант не відкрив доступ (рядків %)', v_n;
  end if;
  raise notice 'ok — з грантом доступ є';
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.notification_outbox
   where tenant_id = 'f7f70000-0000-0000-0000-0000000000b1'
     and event = 'platform.access_granted';
  if v_n = 0 then
    raise exception 'ПРОВАЛ: власник закладу не дізнається про доступ співробітника платформи';
  end if;
  raise notice 'ok — лист власнику поставлено в чергу (% шт.)', v_n;
end $$;

\echo '--- 0093: отозванный грант доступа не даёт'
update public.platform_access_grants set revoked_at = now()
 where staff_user_id = 'f7f70000-0000-0000-0000-0000000000a3';

do $$
declare v_n integer;
begin
  perform test.login('f7f70000-0000-0000-0000-0000000000a3');
  set local role authenticated;
  select count(*) into v_n from public.profiles where id = 'f7f70000-0000-0000-0000-0000000000a4';
  reset role;
  if v_n <> 0 then
    raise exception 'ПРОВАЛ: відкликаний грант усе ще відкриває доступ';
  end if;
  raise notice 'ok — відкликаний грант доступу не дає';
end $$;

\echo '--- 0093: грант правится только отзывом, срок больше 30 дней не берётся'
do $$
begin
  begin
    update public.platform_access_grants set expires_at = now() + interval '365 days'
     where staff_user_id = 'f7f70000-0000-0000-0000-0000000000a3';
    raise exception 'ПРОВАЛ: строк виданого доступу переписали';
  exception when others then
    if sqlerrm like 'ПРОВАЛ%' then raise; end if;
    raise notice 'ok — %', sqlerrm;
  end;

  begin
    insert into public.platform_access_grants (staff_user_id, tenant_id, reason, expires_at)
    values ('f7f70000-0000-0000-0000-0000000000a3','f7f70000-0000-0000-0000-0000000000b1',
            'дуже довге звернення', now() + interval '365 days');
    raise exception 'ПРОВАЛ: грант на рік прийнято';
  exception when others then
    if sqlerrm like 'ПРОВАЛ%' then raise; end if;
    raise notice 'ok — %', sqlerrm;
  end;
end $$;

-- ── 0091/0092/0097: срок хранения ──────────────────────────────────────────

\echo '--- 0097: заказ старше 1095 дней обезличивается, свежий — нет'
insert into public.orders (id, tenant_id, number, customer_id, status,
                           contact_name, contact_phone, contact_email,
                           delivery_address, delivery_branch, delivery_city,
                           comment, tracking_number, created_at)
values ('f7f70000-0000-0000-0000-0000000000f1','f7f70000-0000-0000-0000-0000000000b1',
        7001,'f7f70000-0000-0000-0000-0000000000c1','new',
        'Оксана Клієнт','+380671112233','oksana@test',
        'вул. Шевченка 1','Відділення №5','Київ','подарунок','59000123456789',
        now() - interval '4 years'),
       ('f7f70000-0000-0000-0000-0000000000f2','f7f70000-0000-0000-0000-0000000000b1',
        7002,'f7f70000-0000-0000-0000-0000000000c1','new',
        'Ірина Клієнт','+380672223344','iryna@test',
        'вул. Лесі 2','Відділення №7','Львів','швидше','59000987654321',
        now() - interval '10 days');

-- Санитарный журнал той же давности: уборка не имеет права его трогать.
insert into public.sanitation_solutions
  (id, tenant_id, agent_name, concentration, volume, unit,
   prepared_at, expires_at, prepared_by)
values ('f7f70000-0000-0000-0000-0000000000f3','f7f70000-0000-0000-0000-0000000000b1',
        'Дезінфектант','2%', 5, 'л',
        now() - interval '4 years', now() - interval '4 years' + interval '1 day',
        'f7f70000-0000-0000-0000-0000000000a1');

select public.retention_anonymize_contacts(1095, 5000) as прибрано;

do $$
declare o_old record; o_new record; v_san integer;
begin
  select * into o_old from public.orders where id = 'f7f70000-0000-0000-0000-0000000000f1';
  select * into o_new from public.orders where id = 'f7f70000-0000-0000-0000-0000000000f2';

  if o_old.contact_phone is not null or o_old.contact_email is not null
     or o_old.delivery_address is not null or o_old.delivery_branch is not null
     or o_old.comment is not null or o_old.tracking_number is not null
     or o_old.contact_name <> 'вилучено' then
    raise exception 'ПРОВАЛ: контакти в замовленні старше трьох років не прибрані';
  end if;
  if o_old.number is null or o_old.status is null or o_old.customer_id is null
     or o_old.delivery_city is null then
    raise exception 'ПРОВАЛ: знеособлення знесло облікові поля, а не тільки контакт';
  end if;
  if o_new.contact_phone is null or o_new.contact_name <> 'Ірина Клієнт' then
    raise exception 'ПРОВАЛ: знеособлено свіже замовлення';
  end if;

  select count(*) into v_san from public.sanitation_solutions
   where id = 'f7f70000-0000-0000-0000-0000000000f3';
  if v_san <> 1 then
    raise exception 'ПРОВАЛ: прибирання за строком знесло санітарний журнал — доказ відповідності Техрегламенту';
  end if;

  raise notice 'ok — контакт прибрано, облік і санітарний журнал цілі';
end $$;

\echo '--- 0097: повторный проход ничего не находит, срок меньше года не берётся'
do $$
declare v jsonb;
begin
  v := public.retention_anonymize_contacts(1095, 5000);
  if (v ->> 'orders')::int <> 0 or (v ->> 'bookings')::int <> 0 then
    raise exception 'ПРОВАЛ: повторний прохід знову переписує вже знеособлені рядки: %', v;
  end if;
  raise notice 'ok — повторний прохід порожній';

  begin
    perform public.retention_anonymize_contacts(10, 100);
    raise exception 'ПРОВАЛ: строк зберігання менший за рік прийнято';
  exception when others then
    if sqlerrm like 'ПРОВАЛ%' then raise; end if;
    raise notice 'ok — %', sqlerrm;
  end;
end $$;

\echo '--- 0092: уборка по сроку умеет чистить неизменяемый журнал безопасности'
-- Без щели 0092 первое же правило падало о security_events_immutable
-- и роняло весь проход: функция не удаляла НИЧЕГО.
insert into public.security_events (kind, at, ip)
values ('login.failed', now() - interval '200 days', '203.0.113.9');

do $$
declare v jsonb; v_left integer;
begin
  v := public.retention_sweep(5000);
  select count(*) into v_left from public.security_events
   where at < now() - interval '90 days';
  if v_left <> 0 then
    raise exception 'ПРОВАЛ: строк зберігання не застосувався до журналу безпеки (лишилось %)', v_left;
  end if;
  if v ? 'failed' and v -> 'failed' <> '{}'::jsonb then
    raise exception 'ПРОВАЛ: правило прибирання впало — %', v -> 'failed';
  end if;
  raise notice 'ok — прибирання пройшло цілком: %', v;
end $$;

\echo '--- 0091: итог каждого запуска попадает в журнал безопасности'
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.security_events where kind = 'retention.sweep';
  if v_n = 0 then
    raise exception 'ПРОВАЛ: прибирання за строком нічого про себе не записало — сбій від тиші не відрізнити';
  end if;
  raise notice 'ok — запуск прибирання записаний';
end $$;
