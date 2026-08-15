-- 01_permissions.sql — контрактный тест матрицы прав.
-- Требование CLAUDE.md: перебор «роль × ресурс × действие × ожидание».

\set ON_ERROR_STOP on

grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- Оговорка про строку выше. В Supabase роли anon/authenticated получают
-- права на новые объекты через default privileges — по одному объекту,
-- в момент его создания. Здесь мы выдаём их скопом ПОСЛЕ всех миграций,
-- и этот «скоп» затирает адресные revoke, сделанные внутри миграций
-- (например, 0013 закрывает анониму представления склада).
-- Поэтому такие revoke переигрываем обратно: иначе тест проверял бы
-- не боевое состояние прав, а собственную подготовку.
revoke select on public.stock_low_view   from anon;
revoke select on public.stock_value_view from anon;
revoke execute on function public.variant_available(public.offering_variants) from anon;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@test'),
  ('22222222-2222-2222-2222-222222222222','operator@test'),
  ('33333333-3333-3333-3333-333333333333','stranger@test');

insert into public.tenants (id, slug, name, status)
values ('aaaaaaaa-0000-0000-0000-000000000001','shop-one','Магазин 1','active');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','operator');

insert into public.offerings (id, tenant_id, kind, status, slug, title, price)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'product','active','palto','Пальто', 3000);

insert into public.offering_variants (id, tenant_id, offering_id, name, price)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001','M', 3000);

insert into public.materials (id, tenant_id, name, unit)
values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Нитки','катушка');

insert into public.variant_materials (variant_id, material_id, quantity_per_unit)
values ('cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001', 3);

-- Вход под конкретным пользователем: токен собирается тем же хуком,
-- что и в бою, — тест не имитирует claims руками.
create or replace function test.login(p_user uuid) returns text
language sql as $$
  select set_config('request.jwt.claims',
    (public.custom_access_token_hook(
       jsonb_build_object('user_id', p_user,
                          'claims', jsonb_build_object('sub', p_user))
     ) -> 'claims')::text, false);
$$;

-- Главная проверка проекта: кэш остатка обязан совпадать с суммой журнала.
create or replace function test.check_ledger(p_label text) returns table (
  проверка text, кэш int, журнал numeric, сходится boolean
) language sql as $$
  select p_label, v.stock_qty,
         (select coalesce(sum(x.quantity),0) from public.stock_movements x where x.variant_id = v.id),
         v.stock_qty = (select coalesce(sum(x.quantity),0) from public.stock_movements x where x.variant_id = v.id)
    from public.offering_variants v
   where v.id = 'cccccccc-0000-0000-0000-000000000001';
$$;

\echo '--- владелец получает "*", а не перечень'
select test.login('11111111-1111-1111-1111-111111111111') is not null as вошли;
select public.jwt_perms() -> 'aaaaaaaa-0000-0000-0000-000000000001' as owner_perms;

\echo '--- оператор после 0039: расход можно, приёмка нельзя, финансы нельзя, чужой арендатор нельзя'
-- 0039_operator_scope_split забрала у оператора stock.write и compliance.write
-- и оставила stock.consume и compliance.journal.write. До этой правки строка
-- ниже ждала stock.write = t и продолжала так подписывать колонку даже после
-- миграции — то есть контрактный тест матрицы прав описывал матрицу,
-- которой уже нет. Ожидания приведены к действующей модели.
select test.login('22222222-2222-2222-2222-222222222222') is not null as вошли;
select public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','stock.consume') as stock_consume_ожид_t,
       public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','stock.read')    as stock_read_ожид_t,
       public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','stock.write')   as stock_write_ожид_f,
       public.tenant_can('aaaaaaaa-0000-0000-0000-000000000001','finances.read') as finances_read_ожид_f,
       public.tenant_can('aaaaaaaa-0000-0000-0000-000000000002','stock.consume') as чужой_ожид_f;

\echo '--- план запроса: проверка прав один раз на запрос (hashed SubPlan / InitPlan), а не на строку'
set role authenticated;
explain (costs off) select id from public.offerings;
reset role;

\echo '--- посторонний не видит ничего: витрина не опубликована'
select test.login('33333333-3333-3333-3333-333333333333') is not null as вошли;
set role authenticated;
select (select count(*) from public.offerings)       as позиций_ожид_0,
       (select count(*) from public.stock_movements) as движений_ожид_0,
       (select count(*) from public.materials)       as расходников_ожид_0;
reset role;
