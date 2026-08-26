-- 50. Видалення й архівація (0134).
--
-- Головне, що тут перевіряється, — НЕ «функція існує», а те, що вона
-- вибирає правильно: стерти можна лише те, за чим немає історії,
-- а решта прибирається з очей, залишаючи журнали цілими.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-000000000001', 'owner50@test'),
  ('50000000-0000-0000-0000-000000000002', 'chuzhyi50@test');

insert into public.profiles (id, email) values
  ('50000000-0000-0000-0000-000000000001', 'owner50@test'),
  ('50000000-0000-0000-0000-000000000002', 'chuzhyi50@test')
on conflict (id) do update set email = excluded.email;

insert into public.tenants (id, slug, name, status, kind) values
  ('50000000-0000-0000-0000-0000000000aa', 'rm-shop', 'Прибирання', 'active', 'services'),
  ('50000000-0000-0000-0000-0000000000bb', 'rm-other', 'Чужий', 'active', 'services');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('50000000-0000-0000-0000-0000000000aa', '50000000-0000-0000-0000-000000000001', 'owner'),
  ('50000000-0000-0000-0000-0000000000bb', '50000000-0000-0000-0000-000000000002', 'owner');

-- Засіб БЕЗ історії і засіб, яким уже щось рухали.
insert into public.materials (id, tenant_id, name, unit) values
  ('50000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000aa', 'Помилково заведений', 'шт'),
  ('50000000-0000-0000-0000-0000000000c2', '50000000-0000-0000-0000-0000000000aa', 'Канекалон', 'шт');

insert into public.offerings (id, tenant_id, kind, status, slug, title, price) values
  ('50000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000aa', 'service', 'draft', 'zayve', 'Зайва послуга', 100),
  ('50000000-0000-0000-0000-0000000000d2', '50000000-0000-0000-0000-0000000000aa', 'service', 'active', 'plet', 'Плетіння', 900);

insert into public.customers (id, tenant_id, name, phone) values
  ('50000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000aa', 'Випадковий', '+380670000001'),
  ('50000000-0000-0000-0000-0000000000e2', '50000000-0000-0000-0000-0000000000aa', 'Оксана Тимченко', '+380670000002');

\set QUIET on
select test.login('50000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0134: що без історії — стирається повністю'
do $$
declare v text;
begin
  v := public.remove_entity('material', '50000000-0000-0000-0000-0000000000c1');
  if v <> 'deleted' then raise exception 'ПРОВАЛ: засіб без історії дав % замість deleted', v; end if;
  if exists (select 1 from public.materials where id = '50000000-0000-0000-0000-0000000000c1') then
    raise exception 'ПРОВАЛ: сказано deleted, а рядок на місці';
  end if;
  raise notice 'ok — стерто повністю';
end $$;

\echo '--- 0134: клієнт без замовлень теж стирається'
do $$
declare v text;
begin
  v := public.remove_entity('customer', '50000000-0000-0000-0000-0000000000e1');
  if v <> 'deleted' then raise exception 'ПРОВАЛ: клієнт без історії дав %', v; end if;
  raise notice 'ok — клієнта стерто';
end $$;

\echo '--- 0134: чужий заклад прибрати не можна'
-- Найважливіша перевірка всього файлу. Функція `security definer`, тобто
-- RLS її не стримує; єдине, що стоїть між нею і чужими даними, —
-- перевірка права, і вона мусить впасти.
reset role;
insert into public.materials (id, tenant_id, name, unit)
values ('50000000-0000-0000-0000-0000000000c9', '50000000-0000-0000-0000-0000000000bb', 'Чужий засіб', 'шт');
set role authenticated;
do $$
begin
  perform public.remove_entity('material', '50000000-0000-0000-0000-0000000000c9');
  raise exception 'ПРОВАЛ: прибрано ЧУЖИЙ засіб';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
-- Перевіряти НАЯВНІСТЬ треба вже НЕ під `authenticated`: чужий рядок
-- йому не видно за політикою, і `not exists` сказало б «зник» про рядок,
-- який спокійно лежить на місці. Перша редакція цього тесту саме так
-- і збрехала — на користь дефекту, якого немає.
reset role;
do $$
begin
  if not exists (select 1 from public.materials where id = '50000000-0000-0000-0000-0000000000c9') then
    raise exception 'ПРОВАЛ: чужий засіб усе-таки зник';
  end if;
  raise notice 'ok — чужий засіб на місці';
end $$;
set role authenticated;

\echo '--- 0134: невідомий вид — відмова, а не мовчазне «нічого не сталось»'
do $$
begin
  perform public.remove_entity('vsyo_podryad', '50000000-0000-0000-0000-0000000000c2');
  raise exception 'ПРОВАЛ: невідомий вид прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

reset role;

\echo '--- 0134: засіб з рухом складу стерти НЕ МОЖНА — його прибирають з реєстру'
-- Рух робимо від імені власника через штатну функцію, а не INSERT:
-- журнал руху пишеться тільки нею (правило 5).
\set QUIET on
select test.login('50000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.record_stock_movement(
    '50000000-0000-0000-0000-0000000000aa', 'receipt', 10, null,
    '50000000-0000-0000-0000-0000000000c2');
end $$;

do $$
declare v text; n int;
begin
  v := public.remove_entity('material', '50000000-0000-0000-0000-0000000000c2');
  if v <> 'archived' then
    raise exception 'ПРОВАЛ: засіб з історією дав % замість archived', v;
  end if;
  if (select is_active from public.materials where id = '50000000-0000-0000-0000-0000000000c2') then
    raise exception 'ПРОВАЛ: сказано archived, а засіб лишився активним';
  end if;
  -- І головне: журнал не постраждав.
  select count(*) into n from public.stock_movements
   where material_id = '50000000-0000-0000-0000-0000000000c2';
  if n < 1 then raise exception 'ПРОВАЛ: разом із засобом зник рух складу'; end if;
  raise notice 'ok — прибрано з реєстру, журнал цілий (% рух)', n;
end $$;

\echo '--- 0134: засіб з ЄМНІСТЮ не стирається, хоча зовнішній ключ це дозволяє'
-- Найтихіший з можливих дефектів: `material_containers` привʼязані
-- каскадом, тобто DELETE забрав би банки разом із їхніми строками
-- придатності — тим, що показують перевірці, — і не сказав ні слова.
reset role;
insert into public.materials (id, tenant_id, name, unit, is_cosmetic, pao_months)
values ('50000000-0000-0000-0000-0000000000c3', '50000000-0000-0000-0000-0000000000aa',
        'Олія для кіс', 'мл', true, 12);
insert into public.material_batches (id, tenant_id, material_id, batch_number,
                                     expiry_date, created_by)
values ('50000000-0000-0000-0000-0000000000b3', '50000000-0000-0000-0000-0000000000aa',
        '50000000-0000-0000-0000-0000000000c3', 'L-2026-01', current_date + 200,
        '50000000-0000-0000-0000-000000000001');
insert into public.material_containers (tenant_id, material_id, batch_id, code,
                                        opened_at, volume, unit, created_by)
values ('50000000-0000-0000-0000-0000000000aa', '50000000-0000-0000-0000-0000000000c3',
        '50000000-0000-0000-0000-0000000000b3', 'C-1', now(), 500, 'мл',
        '50000000-0000-0000-0000-000000000001');
\set QUIET on
select test.login('50000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
declare v text; n int;
begin
  v := public.remove_entity('material', '50000000-0000-0000-0000-0000000000c3');
  if v <> 'archived' then
    raise exception 'ПРОВАЛ: засіб з ємністю дав % — банки стерто разом з ним', v;
  end if;
  select count(*) into n from public.material_containers
   where material_id = '50000000-0000-0000-0000-0000000000c3';
  if n < 1 then raise exception 'ПРОВАЛ: ємність зникла'; end if;
  raise notice 'ok — засіб в архіві, ємність ціла';
end $$;

\echo '--- 0134: повернути назад можна'
do $$
begin
  perform public.restore_entity('material', '50000000-0000-0000-0000-0000000000c2');
  if not (select is_active from public.materials where id = '50000000-0000-0000-0000-0000000000c2') then
    raise exception 'ПРОВАЛ: повернення не спрацювало';
  end if;
  raise notice 'ok — засіб повернувся в реєстр';
end $$;

reset role;

\echo '--- 0134: послуга із записом клієнта — в архів, запис цілий'
insert into public.staff (id, tenant_id, name) values
  ('50000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-0000000000aa', 'Ірина');
insert into public.offering_variants (id, tenant_id, offering_id, name, price, duration_minutes) values
  ('50000000-0000-0000-0000-0000000000d3', '50000000-0000-0000-0000-0000000000aa',
   '50000000-0000-0000-0000-0000000000d2', 'Базовий', 900, 60);
insert into public.bookings (tenant_id, number, offering_id, variant_id, staff_id, customer_id,
                             period, service_ends_at, title, variant_name,
                             contact_name, contact_phone, price)
values ('50000000-0000-0000-0000-0000000000aa', 1,
        '50000000-0000-0000-0000-0000000000d2', '50000000-0000-0000-0000-0000000000d3',
        '50000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-0000000000e2',
        tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour'),
        now() + interval '1 day 1 hour', 'Плетіння', 'Базовий',
        'Оксана Тимченко', '+380670000002', 900);

\set QUIET on
select test.login('50000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
declare v text;
begin
  v := public.remove_entity('offering', '50000000-0000-0000-0000-0000000000d2');
  if v <> 'archived' then raise exception 'ПРОВАЛ: послуга із записом дала %', v; end if;
  if (select status from public.offerings where id = '50000000-0000-0000-0000-0000000000d2')::text <> 'archived' then
    raise exception 'ПРОВАЛ: статус не став archived';
  end if;
  if not exists (select 1 from public.bookings
                  where offering_id = '50000000-0000-0000-0000-0000000000d2') then
    raise exception 'ПРОВАЛ: разом з послугою зник запис клієнта';
  end if;
  raise notice 'ok — послуга в архіві, запис цілий';
end $$;

\echo '--- 0134: послуга без записів стирається'
do $$
declare v text;
begin
  v := public.remove_entity('offering', '50000000-0000-0000-0000-0000000000d1');
  if v <> 'deleted' then raise exception 'ПРОВАЛ: порожня послуга дала %', v; end if;
  raise notice 'ok — порожню послугу стерто';
end $$;

\echo '--- 0134: клієнт із записом — контакти стираються, запис лишається'
do $$
declare v text;
begin
  v := public.remove_entity('customer', '50000000-0000-0000-0000-0000000000e2');
  if v <> 'forgotten' then raise exception 'ПРОВАЛ: клієнт з історією дав % замість forgotten', v; end if;
end $$;
-- Читати `customers` з-під `authenticated` не можна з 0099: прямий доступ
-- до телефону й пошти закритий, контакт віддає `customer_card` із журналом
-- доступу. Тому саму перевірку робимо привілейованою роллю — нас цікавить
-- стан рядка в базі, а не те, кому він видний.
reset role;
do $$
declare r record;
begin
  select name, phone, email, is_active into r
    from public.customers where id = '50000000-0000-0000-0000-0000000000e2';
  if r.phone is not null or r.email is not null then
    raise exception 'ПРОВАЛ: контакти лишились у базі';
  end if;
  if r.name = 'Оксана Тимченко' then
    raise exception 'ПРОВАЛ: імʼя не стерто';
  end if;
  if r.is_active then raise exception 'ПРОВАЛ: клієнт лишився в списку'; end if;
  if not exists (select 1 from public.bookings
                  where customer_id = '50000000-0000-0000-0000-0000000000e2') then
    raise exception 'ПРОВАЛ: разом із клієнтом зник його запис';
  end if;
  raise notice 'ok — клієнта забуто, запис цілий';
end $$;

\echo '--- 0134: без права прибрати не можна'
-- Найлегший спосіб перевірити — увійти чужим власником: у нього повні
-- права у СВОЄМУ закладі й жодних у цьому.
\set QUIET on
select test.login('50000000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
insert into public.materials (id, tenant_id, name, unit)
values ('50000000-0000-0000-0000-0000000000ca', '50000000-0000-0000-0000-0000000000bb', 'Свій засіб', 'шт');
do $$
begin
  perform public.remove_entity('material', '50000000-0000-0000-0000-0000000000c2');
  raise exception 'ПРОВАЛ: чужа людина прибрала засіб';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0134: анониму функція недоступна'
set role anon;
do $$
begin
  perform public.remove_entity('material', '50000000-0000-0000-0000-0000000000c2');
  raise exception 'ПРОВАЛ: анонім викликав видалення';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

rollback;
