-- 29_attribution.sql — атрибуция заказов и записей (миграция 0105).
--
-- Атрибуция — не отчётность ради отчётности, а то, из чего в будущем
-- считается счёт («0% с заказов, которые продавец привёл сам, комиссия
-- только с приведённых нами»). Значит проверять надо, что «свой» и «наш»
-- источники расходятся правильно, а испорченный вход НИКОГДА не роняет
-- оформление — ни заказ, ни запись не имеют права упасть из-за атрибуции.
--
-- Семь обещаний, каждое отдельной попыткой:
--   1) валидный и свежий источник (`ig`) сохраняется на заказе И на записи,
--      событие попадает в attribution_events;
--   2) неизвестное значение источника не роняет заказ — атрибуция молча null;
--   3) источник старше 30 дней игнорируется (окно истекло);
--   4) источник из будущего игнорируется (испорченные часы клиента);
--   5) без атрибуции вовсе — источник null, заказ проходит как обычно
--      (это и есть «свой» по умолчанию);
--   6) сотруднику, оформляющему заказ вручную, атрибуция не считается —
--      ручной заказ это и есть «привёл продавец сам»;
--   7) прямая вставка в attribution_events невозможна, анониму таблица
--      не видна.
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
  ('29292929-0000-0000-0000-000000000001','attr-owner@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('a7710000-0000-0000-0000-000000000001','attr-shop','АТРИБУЦІЯ','both','active',
        true, true, 'ХАРКІВ', (select array_agg(code) from public.modules where is_active));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('a7710000-0000-0000-0000-000000000001','29292929-0000-0000-0000-000000000001','owner','{}'::jsonb);

insert into public.offerings (id, tenant_id, kind, status, slug, title, price, listed, published_at)
values ('0ffe0000-0000-0000-0000-000000000004','a7710000-0000-0000-0000-000000000001',
        'product','active','attr-item','КАНЕКАЛОН',300,true,now());
insert into public.offering_variants (id, tenant_id, offering_id, name, price, track_stock)
values ('7a7a0000-0000-0000-0000-000000000004','a7710000-0000-0000-0000-000000000001',
        '0ffe0000-0000-0000-0000-000000000004','чорний',300,false);

insert into public.offerings (id, tenant_id, kind, status, slug, title, price, listed, published_at)
values ('0ffe0000-0000-0000-0000-000000000005','a7710000-0000-0000-0000-000000000001',
        'service','active','attr-serv','ЗАПЛІТАННЯ',500,true,now());
insert into public.offering_variants (id, tenant_id, offering_id, name, price, duration_minutes)
values ('7a7a0000-0000-0000-0000-000000000005','a7710000-0000-0000-0000-000000000001',
        '0ffe0000-0000-0000-0000-000000000005','база',500,60);
insert into public.staff (id, tenant_id, name)
values ('5aff0000-0000-0000-0000-000000000099','a7710000-0000-0000-0000-000000000001','МАЙСТРИНЯ');
insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
select 'a7710000-0000-0000-0000-000000000001','5aff0000-0000-0000-0000-000000000099',
       d, '09:00','19:00' from generate_series(0,6) d;

\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;

\echo '--- 0105: свіжий валідний "ig" зберігається на замовленні'
select o.attribution_source::text as джерело_ожид_ig
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Оксана', '+380671234567', null, '{}'::jsonb, null, 'storefront', 72,
    'ig', 'bio-link', now() - interval '2 hour') o;

-- Проверка события — суперпользователем: анониму читать attribution_events
-- не положено (это внутренняя бухгалтерия платформы), поэтому подсматриваем
-- как postgres и тут же возвращаемся к гостевой роли, как в 03_orders.sql.
reset role;
select source::text as подія_джерело_ожид_ig, label as мітка_ожид_bio_link
  from public.attribution_events
 where tenant_id = 'a7710000-0000-0000-0000-000000000001'
 order by created_at desc limit 1;
set role anon;

\echo '--- 0105: те саме для запису'
select b.attribution_source::text as джерело_ожид_ig
  from public.create_booking(
    'a7710000-0000-0000-0000-000000000001','7a7a0000-0000-0000-0000-000000000005',
    '5aff0000-0000-0000-0000-000000000099',
    (current_date + 1 + time '10:00') at time zone 'Europe/Kyiv',
    'Оксана', '+380671234567', null,
    'ig', null, now() - interval '1 hour') b;

\echo '--- 0105: невідоме значення джерела НЕ РОНЯЄ замовлення — атрибуція просто null'
select o.number is not null as замовлення_пройшло_ожид_t,
       o.attribution_source is null as джерело_ожид_null
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Ірина', '+380671234568', null, '{}'::jsonb, null, 'storefront', 72,
    'tiktok-щось-вигадане', null, now()) o;

\echo '--- 0105: джерело старше 30 днів ігнорується — вікно вичерпане'
select o.attribution_source is null as джерело_ожид_null
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Марина', '+380671234569', null, '{}'::jsonb, null, 'storefront', 72,
    'ig', null, now() - interval '31 day') o;

\echo '--- 0105: джерело з майбутнього ігнорується — зіпсований годинник клієнта'
select o.attribution_source is null as джерело_ожид_null
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Ганна', '+380671234570', null, '{}'::jsonb, null, 'storefront', 72,
    'ig', null, now() + interval '1 day') o;

\echo '--- 0105: без атрибуції взагалі — джерело null, замовлення проходить як завжди'
select o.number is not null as замовлення_пройшло_ожид_t,
       o.attribution_source is null as джерело_ожид_null
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Софія', '+380671234571') o;

\echo '--- 0105: продавцю, що оформлює замовлення вручну, атрибуція не рахується'
reset role;
\set QUIET on
select test.login('29292929-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select o.attribution_source is null as джерело_ожид_null, o.source as джерело_поле_ожид_manual
  from public.create_order(
    'a7710000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('variant_id','7a7a0000-0000-0000-0000-000000000004','quantity',1)),
    'Ручний покупець', null, null, '{}'::jsonb, null, 'storefront', 72,
    'ig', null, now()) o;

\echo '--- 0105: навіть власник не заведе подію атрибуції напряму, повз функції'
-- Роль ещё authenticated (владелец из предыдущего блока): прямая вставка
-- проверяется от роли, которой запрет действительно адресован, — иначе
-- отказ superuser'а ничего не доказывает (тот же приём, что в 27_returns).
do $$
begin
  insert into public.attribution_events (tenant_id, source, order_id, occurred_at)
  values ('a7710000-0000-0000-0000-000000000001','ig',
          (select id from public.orders where tenant_id = 'a7710000-0000-0000-0000-000000000001' limit 1),
          now());
  raise exception 'ПРОВАЛ: подію атрибуції завели повз create_order/create_booking';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;

\echo '--- 0105: анониму attribution_events не видно зовсім'
select has_table_privilege('anon','public.attribution_events','SELECT') as анонім_читання_ожид_f,
       has_table_privilege('authenticated','public.attribution_events','INSERT') as вошедший_запис_ожид_f;

rollback;

\echo '--- 29_attribution: откат выполнен'
select count(*) as орендарів_атрибуції_ожид_0 from public.tenants
 where id = 'a7710000-0000-0000-0000-000000000001';
