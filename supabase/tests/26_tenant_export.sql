-- 26_tenant_export.sql — выгрузка заведения (миграция 0102).
--
-- Обещание: «данные клиента — его собственность с выгрузкой в любой момент».
-- Значит проверять надо не то, что функция есть, а то, что она отдаёт данные
-- ТОМУ, КОМУ ОНИ ВИДНЫ, и не отдаёт остальным.
--
-- Пять обещаний, каждое отдельной попыткой:
--   1) раздел отдаётся по праву СВОЕГО экрана, а не по общему «выгрузить всё»;
--   2) без права раздел не отдаётся вовсе;
--   3) контакты покупателя без `customers.contacts` уходят В МАСКЕ —
--      выгрузка не должна отдавать того, чего не отдаёт экран;
--   4) каждый вызов пишется в журнал доступа действием `exported`;
--   5) незнакомый раздел — ошибка, а не пустой файл.
--
-- Файл самодостаточен и обёрнут в транзакцию с откатом.

\set ON_ERROR_STOP on

begin;

grant usage on schema public to anon, authenticated;

create schema if not exists test;
create or replace function test.login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

insert into auth.users (id, email) values
  ('26262626-0000-0000-0000-000000000001','exp-owner@test'),
  ('26262626-0000-0000-0000-000000000002','exp-clerk@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('e6e6e6e6-0000-0000-0000-000000000001','exp-shop','ВИВАНТАЖЕННЯ','both','active',
        true, true, 'ХАРКІВ', (select array_agg(code) from public.modules where is_active));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('e6e6e6e6-0000-0000-0000-000000000001','26262626-0000-0000-0000-000000000001','owner','{}'::jsonb),
  -- Продавец без `customers.contacts`: заказы видит, телефон покупателя — нет.
  ('e6e6e6e6-0000-0000-0000-000000000001','26262626-0000-0000-0000-000000000002','operator',
   '{"orders.read": true}'::jsonb);

insert into public.customers (id, tenant_id, name, phone, email)
values ('c0c0c0c0-0000-0000-0000-000000000001','e6e6e6e6-0000-0000-0000-000000000001',
        'ОКСАНА','+380671234567','oksana@test');

insert into public.orders (id, tenant_id, number, status, customer_id,
                           contact_name, contact_phone, contact_email,
                           subtotal, total, currency)
values ('0d0d0d0d-0000-0000-0000-000000000001','e6e6e6e6-0000-0000-0000-000000000001',
        1, 'new', 'c0c0c0c0-0000-0000-0000-000000000001',
        'ОКСАНА','+380671234567','oksana@test', 500, 500, 'UAH');

\set QUIET on
select test.login('26262626-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0102: владелец выгружает заказы, контакт открыт'
select jsonb_array_length(public.tenant_export(
         'e6e6e6e6-0000-0000-0000-000000000001','orders')) as замовлень_ожид_1;

select (public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','orders')
        -> 0 ->> 'contact_phone') as телефон_ожид_повний;

\echo '--- 0102: раздел склада отдаётся, раздел журналов — объектом из трёх'
select jsonb_typeof(public.tenant_export(
         'e6e6e6e6-0000-0000-0000-000000000001','inventory')) as склад_ожид_array,
       (select count(*) from jsonb_object_keys(public.tenant_export(
         'e6e6e6e6-0000-0000-0000-000000000001','journals'))) as журналів_ожид_3;

\echo '--- 0102: незнакомый раздел — ошибка, а не пустой файл'
do $$
begin
  perform public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','всё');
  raise exception 'ПРОВАЛ: невідомий розділ віддав порожнечу замість помилки';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0102: каждый вызов попал в журнал доступа'
select count(*) > 0 as записано_ожид_t
  from public.audit_log a
 where a.tenant_id = 'e6e6e6e6-0000-0000-0000-000000000001'
   and a.action = 'exported' and a.entity = 'tenant.orders';

\echo '--- 0102: без customers.contacts телефон в выгрузке ЗАМАСКИРОВАН'
reset role;
\set QUIET on
select test.login('26262626-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;

select (public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','orders')
        -> 0 ->> 'contact_phone') <> '+380671234567' as замасковано_ожид_t,
       (public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','orders')
        -> 0 ->> 'contact_name') = 'ОКСАНА' as імʼя_ожид_t;

\echo '--- 0102: разделы, на которые права нет, не отдаются'
do $$
begin
  perform public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','finance');
  raise exception 'ПРОВАЛ: фінанси віддалися без права finances.read';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

-- Склад продавцу как раз ВИДЕН (`stock.read` есть у роли operator), и это
-- правильно: раздел отдаётся по праву своего экрана, а не по должности.
-- Проверяем на том, чего у него действительно нет.
do $$
begin
  perform public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','customers');
  raise exception 'ПРОВАЛ: база клієнтів віддалася без права customers.read';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  perform public.tenant_export('e6e6e6e6-0000-0000-0000-000000000001','tenant');
  raise exception 'ПРОВАЛ: картка закладу віддалася без права settings.read';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0102: а склад продавцу видно — право у роли есть'
select jsonb_typeof(public.tenant_export(
         'e6e6e6e6-0000-0000-0000-000000000001','inventory')) as склад_ожид_array;

\echo '--- 0102: чужое заведение не выгружается'
do $$
begin
  perform public.tenant_export('aaaaaaaa-0000-0000-0000-000000000001','orders');
  raise exception 'ПРОВАЛ: вивантажили чужий заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;

\echo '--- 0102: анониму выгрузка не открыта'
select has_function_privilege('anon','public.tenant_export(uuid,text)','EXECUTE')
         as анонім_ожид_f,
       has_function_privilege('authenticated','public.tenant_export(uuid,text)','EXECUTE')
         as вошедший_ожид_t;

rollback;

\echo '--- 26_tenant_export: откат выполнен'
select count(*) as орендарів_вивантаження_ожид_0 from public.tenants
 where id = 'e6e6e6e6-0000-0000-0000-000000000001';
