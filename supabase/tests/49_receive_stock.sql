-- 49. Надходження без документа (0133).
--
-- Перевіряється ПОПЫТКОЙ порушення і ЗВІРКОЮ ЧИСЛА, а не наявністю
-- функції: `create or replace` поверх стирає тіло цілком, і «функція
-- існує» світилося б зеленим (так уже було з 0076 і 0052).
--
-- Головне тут — не сам прихід, а СОБІВАРТІСТЬ: формула переїхала
-- з `apply_stock_receipt` (0112), і якщо вона переїхала неправильно,
-- зламається не склад, а маржа й P&L у фінансах — тобто помітять
-- це через місяць, у звіті, за яким призначають ціни.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'owner49@test'),
  ('49000000-0000-0000-0000-000000000002', 'stranger49@test');

insert into public.profiles (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'owner49@test'),
  ('49000000-0000-0000-0000-000000000002', 'stranger49@test')
on conflict (id) do update set email = excluded.email;

insert into public.tenants (id, slug, name, status, kind) values
  ('49000000-0000-0000-0000-0000000000aa', 'recv-shop', 'Салон', 'active', 'services'),
  ('49000000-0000-0000-0000-0000000000bb', 'other-shop', 'Чужий', 'active', 'services');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('49000000-0000-0000-0000-0000000000aa', '49000000-0000-0000-0000-000000000001', 'owner'),
  ('49000000-0000-0000-0000-0000000000bb', '49000000-0000-0000-0000-000000000002', 'owner');

insert into public.materials (id, tenant_id, name, unit) values
  ('49000000-0000-0000-0000-000000000a01', '49000000-0000-0000-0000-0000000000aa', 'Гель', 'мл');

insert into public.materials (id, tenant_id, name, unit) values
  ('49000000-0000-0000-0000-000000000b02', '49000000-0000-0000-0000-0000000000bb', 'Чужий гель', 'мл');

\set QUIET on
select test.login('49000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0133: перше надходження з ціною — собівартість береться цілком'
-- Оговорка 2 з 0112: старої собівартості немає, усереднювати з невідомим
-- нечесно. 100 од. по 5 → собівартість рівно 5, а не половина від чогось.
select (public.receive_stock(
  p_tenant_id   => '49000000-0000-0000-0000-0000000000aa',
  p_quantity    => 100,
  p_material_id => '49000000-0000-0000-0000-000000000a01',
  p_unit_cost   => 5
)).id is not null as надходження_ожид_t;

select current_stock as залишок_ожид_100, cost_per_unit as собівартість_ожид_5
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

\echo '--- 0133: друге надходження дорожче — середньозважена, а не остання ціна'
-- 100 по 5 плюс 100 по 15 дають 10, а не 15. Саме це відрізняє формулу
-- від «остання ціна перемогла».
select (public.receive_stock(
  p_tenant_id   => '49000000-0000-0000-0000-0000000000aa',
  p_quantity    => 100,
  p_material_id => '49000000-0000-0000-0000-000000000a01',
  p_unit_cost   => 15
)).id is not null as надходження2_ожид_t;

select current_stock as залишок_ожид_200, cost_per_unit as собівартість_ожид_10
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

\echo '--- 0133: надходження БЕЗ ціни собівартість не чіпає'
-- Оговорка 1: «немає ціни» означає «не знаю», а не «нуль».
select (public.receive_stock(
  p_tenant_id   => '49000000-0000-0000-0000-0000000000aa',
  p_quantity    => 50,
  p_material_id => '49000000-0000-0000-0000-000000000a01'
)).id is not null as надходження3_ожид_t;

select current_stock as залишок_ожид_250, cost_per_unit as собівартість_ожид_10
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

\echo '--- 0133: ПОВТОР ЗА ТИМ САМИМ КЛЮЧЕМ не рухає ні залишок, ні ціну'
-- Найтонше місце міграції. Ключ ідемпотентності перевіряється ДО
-- перерахунку; якби він стояв після, повтор не зрушив би залишок,
-- але провів би ціну через усереднення вдруге — і собівартість поїхала б
-- від операції, якої не було.
select (public.receive_stock(
  p_tenant_id       => '49000000-0000-0000-0000-0000000000aa',
  p_quantity        => 100,
  p_material_id     => '49000000-0000-0000-0000-000000000a01',
  p_unit_cost       => 30,
  p_idempotency_key => 'dup-49'
)).id is not null as перший_ожид_t;

select current_stock as залишок_ожид_350, cost_per_unit as собівартість_ожид_15_7143
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

select (public.receive_stock(
  p_tenant_id       => '49000000-0000-0000-0000-0000000000aa',
  p_quantity        => 100,
  p_material_id     => '49000000-0000-0000-0000-000000000a01',
  p_unit_cost       => 30,
  p_idempotency_key => 'dup-49'
)).id is not null as повтор_ожид_t;

select current_stock as залишок_ожид_350_знову, cost_per_unit as собівартість_ожид_15_7143_знову
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

\echo '--- 0133: нуль і відʼємне — відмова'
do $$
begin
  perform public.receive_stock(
    p_tenant_id => '49000000-0000-0000-0000-0000000000aa',
    p_quantity => 0,
    p_material_id => '49000000-0000-0000-0000-000000000a01');
  raise exception 'ПРОВАЛ: прийняли нульове надходження';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: нуль відхилено (%)', sqlerrm;
end $$;

do $$
begin
  perform public.receive_stock(
    p_tenant_id => '49000000-0000-0000-0000-0000000000aa',
    p_quantity => -5,
    p_material_id => '49000000-0000-0000-0000-000000000a01');
  raise exception 'ПРОВАЛ: прийняли відʼємне надходження';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: відʼємне відхилено (%)', sqlerrm;
end $$;

\echo '--- 0133: обидва ідентифікатори разом — відмова'
do $$
begin
  perform public.receive_stock(
    p_tenant_id => '49000000-0000-0000-0000-0000000000aa',
    p_quantity => 5,
    p_material_id => '49000000-0000-0000-0000-000000000a01',
    p_variant_id => '49000000-0000-0000-0000-000000000a01');
  raise exception 'ПРОВАЛ: прийняли і засіб, і товар одночасно';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: подвійний ідентифікатор відхилено (%)', sqlerrm;
end $$;

\echo '--- 0133: ЧУЖИЙ засіб — відмова, і собівартість його не зрушена'
-- Та сама діра, заради якої писалася 0030: чужий id приносив чужу
-- рецептуру. Тут він приніс би чужу собівартість.
do $$
begin
  perform public.receive_stock(
    p_tenant_id => '49000000-0000-0000-0000-0000000000aa',
    p_quantity => 10,
    p_material_id => '49000000-0000-0000-0000-000000000b02',
    p_unit_cost => 999);
  raise exception 'ПРОВАЛ: прийняли надходження на чужий засіб';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: чужий засіб відхилено (%)', sqlerrm;
end $$;

reset role;
select cost_per_unit as чужа_собівартість_ожид_null
  from public.materials where id = '49000000-0000-0000-0000-000000000b02';
set role authenticated;

\echo '--- 0133: сторонній без прав — відмова'
reset role;
\set QUIET on
select test.login('49000000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;

do $$
begin
  perform public.receive_stock(
    p_tenant_id => '49000000-0000-0000-0000-0000000000aa',
    p_quantity => 10,
    p_material_id => '49000000-0000-0000-0000-000000000a01',
    p_unit_cost => 999);
  raise exception 'ПРОВАЛ: сторонній провів надходження в чужому закладі';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok: сторонній відхилений (%)', sqlerrm;
end $$;

reset role;
select cost_per_unit as собівартість_після_чужого_ожид_15_7143
  from public.materials where id = '49000000-0000-0000-0000-000000000a01';

rollback;
