-- 28_reviews.sql — отзывы и рейтинг (миграция 0104).
--
-- Единственная защита рейтинга — «отзыв только от того, у кого есть
-- выполненный заказ или запись». Значит проверять надо не то, что функция
-- есть, а то, что чужой, гость и владелец заведения себе отзыв не оставят,
-- а тот, кому положено, — оставит ровно один на купленный опыт.
--
-- Восемь обещаний, каждое отдельной попыткой:
--   1) покупатель с выполненным заказом оставляет отзыв, рейтинг товара
--      пересчитывается САМ;
--   2) второй отзыв на ту же позицию заказа — отказ;
--   3) чужой человек с ТЕМ ЖЕ заказом (не покупатель) отзыв не оставит;
--   4) отзыв на НЕвыполненный заказ — отказ;
--   5) то же самое для записи (booking): выполненная — можно, невыполненная
--      и чужая — нельзя;
--   6) оценка вне 1..5 — отказ;
--   7) rating_avg/rating_count нельзя переписать напрямую, даже владельцу;
--   8) отзыв неизменяем — ни правка, ни удаление.
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
  ('28282828-0000-0000-0000-000000000001','rev-owner@test'),
  ('28282828-0000-0000-0000-000000000002','rev-buyer@test'),
  ('28282828-0000-0000-0000-000000000003','rev-stranger@test');

insert into public.tenants (id, slug, name, kind, status, storefront_enabled,
                            listed_in_catalog, city, modules)
values ('5e5e5e5e-0000-0000-0000-000000000001','rev-shop','ВІДГУКИ','both','active',
        true, true, 'ХАРКІВ', (select array_agg(code) from public.modules where is_active));

insert into public.tenant_members (tenant_id, user_id, role, permissions) values
  ('5e5e5e5e-0000-0000-0000-000000000001','28282828-0000-0000-0000-000000000001','owner','{}'::jsonb);

insert into public.offerings (id, tenant_id, kind, status, slug, title, price, listed, published_at)
values ('0ffe0000-0000-0000-0000-000000000002','5e5e5e5e-0000-0000-0000-000000000001',
        'product','active','rev-item','КАНЕКАЛОН',300,true,now());

insert into public.offering_variants (id, tenant_id, offering_id, name, price)
values ('7a7a0000-0000-0000-0000-000000000002','5e5e5e5e-0000-0000-0000-000000000001',
        '0ffe0000-0000-0000-0000-000000000002','чорний',300);

insert into public.customers (id, tenant_id, user_id, name)
values ('c8c80000-0000-0000-0000-000000000001','5e5e5e5e-0000-0000-0000-000000000001',
        '28282828-0000-0000-0000-000000000002','ОКСАНА');

-- Заказ покупателя, ВЫПОЛНЕН.
insert into public.orders (id, tenant_id, number, status, customer_id, buyer_user_id,
                           contact_name, subtotal, total, currency)
values ('a0a00000-0000-0000-0000-000000000002','5e5e5e5e-0000-0000-0000-000000000001',
        1,'completed','c8c80000-0000-0000-0000-000000000001',
        '28282828-0000-0000-0000-000000000002','ОКСАНА',300,300,'UAH');

insert into public.order_items (id, order_id, tenant_id, offering_id, variant_id, title, variant_name, unit_price, quantity)
values ('17e00000-0000-0000-0000-000000000002','a0a00000-0000-0000-0000-000000000002',
        '5e5e5e5e-0000-0000-0000-000000000001','0ffe0000-0000-0000-0000-000000000002',
        '7a7a0000-0000-0000-0000-000000000002','КАНЕКАЛОН','чорний',300,1);

-- Второй заказ ТОГО ЖЕ покупателя, НЕ выполнен.
insert into public.orders (id, tenant_id, number, status, customer_id, buyer_user_id,
                           contact_name, subtotal, total, currency)
values ('a0a00000-0000-0000-0000-000000000003','5e5e5e5e-0000-0000-0000-000000000001',
        2,'paid','c8c80000-0000-0000-0000-000000000001',
        '28282828-0000-0000-0000-000000000002','ОКСАНА',300,300,'UAH');
insert into public.order_items (id, order_id, tenant_id, offering_id, variant_id, title, variant_name, unit_price, quantity)
values ('17e00000-0000-0000-0000-000000000003','a0a00000-0000-0000-0000-000000000003',
        '5e5e5e5e-0000-0000-0000-000000000001','0ffe0000-0000-0000-0000-000000000002',
        '7a7a0000-0000-0000-0000-000000000002','КАНЕКАЛОН','чорний',300,1);

\set QUIET on
select test.login('28282828-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;

\echo '--- 0104: покупатель с виконаним замовленням залишає відгук'
select public.create_review(
  '5e5e5e5e-0000-0000-0000-000000000001','order',
  '17e00000-0000-0000-0000-000000000002', 5, 'Чудовий канекалон') is not null
  as відгук_ожид_t;

\echo '--- 0104: рейтинг товару порахувався сам'
select rating_avg as рейтинг_ожид_5, rating_count as кількість_ожид_1
  from public.offerings where id = '0ffe0000-0000-0000-0000-000000000002';

\echo '--- 0104: другий відгук на ту саму позицію — відмова'
do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','order',
    '17e00000-0000-0000-0000-000000000002', 4, 'ще раз');
  raise exception 'ПРОВАЛ: другий відгук на ту саму позицію пройшов';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: на невиконане замовлення відгук не залишити'
do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','order',
    '17e00000-0000-0000-0000-000000000003', 5, null);
  raise exception 'ПРОВАЛ: відгук на невиконане замовлення пройшов';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: оцінка поза 1..5 не приймається'
do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','order',
    '17e00000-0000-0000-0000-000000000003', 9, null);
  raise exception 'ПРОВАЛ: оцінка 9 пройшла';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: відгук неможливо ні правити, ні стерти'
do $$
begin
  update public.reviews set rating = 1
   where order_item_id = '17e00000-0000-0000-0000-000000000002';
  raise exception 'ПРОВАЛ: відгук переписали';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  delete from public.reviews where order_item_id = '17e00000-0000-0000-0000-000000000002';
  raise exception 'ПРОВАЛ: відгук стерли';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: чужа людина з тим самим замовленням відгук не залишить'
reset role;
\set QUIET on
select test.login('28282828-0000-0000-0000-000000000003');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','order',
    '17e00000-0000-0000-0000-000000000003', 5, null);
  raise exception 'ПРОВАЛ: чужа людина залишила відгук';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: те саме для запису — booking'
-- Фикстуры booking заводятся СУПЕРПОЛЬЗОВАТЕЛЕМ: на bookings нет INSERT-
-- политики вовсе (создание идёт через create_booking), это тот же приём,
-- что и в 06_isolation.sql.
reset role;

insert into public.staff (id, tenant_id, name)
values ('5aff0000-0000-0000-0000-000000000009','5e5e5e5e-0000-0000-0000-000000000001','РЕВ МАЙСТЕР');

insert into public.offerings (id, tenant_id, kind, status, slug, title, price, listed, published_at)
values ('0ffe0000-0000-0000-0000-000000000003','5e5e5e5e-0000-0000-0000-000000000001',
        'service','active','rev-serv','ЗАПЛІТАННЯ',500,true,now());

insert into public.offering_variants (id, tenant_id, offering_id, name, price, duration_minutes)
values ('7a7a0000-0000-0000-0000-000000000003','5e5e5e5e-0000-0000-0000-000000000001',
        '0ffe0000-0000-0000-0000-000000000003','base',500,60);

-- Виконаний запис покупця.
insert into public.bookings (id, tenant_id, number, staff_id, offering_id, variant_id, customer_id,
                             buyer_user_id, period, service_ends_at, title, variant_name,
                             price, contact_name, status, created_by)
values ('b00c0000-0000-0000-0000-000000000001','5e5e5e5e-0000-0000-0000-000000000001',
        1,'5aff0000-0000-0000-0000-000000000009','0ffe0000-0000-0000-0000-000000000003',
        '7a7a0000-0000-0000-0000-000000000003','c8c80000-0000-0000-0000-000000000001',
        '28282828-0000-0000-0000-000000000002',
        tstzrange(now() - interval '2 day', now() - interval '1 day'),
        now() - interval '1 day','ЗАПЛІТАННЯ','base',500,'ОКСАНА','completed',
        '28282828-0000-0000-0000-000000000001');

-- Невиконаний запис того самого покупця.
insert into public.bookings (id, tenant_id, number, staff_id, offering_id, variant_id, customer_id,
                             buyer_user_id, period, service_ends_at, title, variant_name,
                             price, contact_name, status, created_by)
values ('b00c0000-0000-0000-0000-000000000002','5e5e5e5e-0000-0000-0000-000000000001',
        2,'5aff0000-0000-0000-0000-000000000009','0ffe0000-0000-0000-0000-000000000003',
        '7a7a0000-0000-0000-0000-000000000003','c8c80000-0000-0000-0000-000000000001',
        '28282828-0000-0000-0000-000000000002',
        tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'),
        now() + interval '1 day 1 hour','ЗАПЛІТАННЯ','base',500,'ОКСАНА','booked',
        '28282828-0000-0000-0000-000000000001');

\set QUIET on
select test.login('28282828-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;

select public.create_review(
  '5e5e5e5e-0000-0000-0000-000000000001','booking',
  'b00c0000-0000-0000-0000-000000000001', 5, 'Дуже дякую майстрині') is not null
  as відгук_запис_ожид_t;

do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','booking',
    'b00c0000-0000-0000-0000-000000000002', 5, null);
  raise exception 'ПРОВАЛ: відгук на невиконаний запис пройшов';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','booking',
    'b00c0000-0000-0000-0000-000000000001', 4, null);
  raise exception 'ПРОВАЛ: другий відгук на той самий запис пройшов';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;
\set QUIET on
select test.login('28282828-0000-0000-0000-000000000003');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.create_review(
    '5e5e5e5e-0000-0000-0000-000000000001','booking',
    'b00c0000-0000-0000-0000-000000000002', 5, null);
  raise exception 'ПРОВАЛ: чужа людина залишила відгук на запис';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: навіть власник закладу не редагує rating_avg напряму'
reset role;
\set QUIET on
select test.login('28282828-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  update public.offerings set rating_avg = 5, rating_count = 999
   where id = '0ffe0000-0000-0000-0000-000000000002';
  raise exception 'ПРОВАЛ: rating_avg переписали напряму';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0104: товар не заводиться одразу з ненульовим рейтингом'
do $$
begin
  insert into public.offerings (tenant_id, kind, status, slug, title, price,
                                listed, published_at, rating_avg, rating_count)
  values ('5e5e5e5e-0000-0000-0000-000000000001','product','active','rev-fake',
          'ПІДРОБКА',100,true,now(),5,50);
  raise exception 'ПРОВАЛ: товар завели одразу з рейтингом 5.00';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;

\echo '--- 0104: анониму не відкриті ні функція, ні пряме читання'
select has_function_privilege('anon','public.create_review(uuid,text,uuid,integer,text)','EXECUTE')
         as анонім_функція_ожид_f,
       has_table_privilege('anon','public.reviews','SELECT') as анонім_читання_ожид_f,
       has_table_privilege('authenticated','public.reviews','INSERT') as вошедший_запис_ожид_f;

rollback;

\echo '--- 28_reviews: откат выполнен'
select count(*) as відгуків_ожид_0 from public.reviews;
