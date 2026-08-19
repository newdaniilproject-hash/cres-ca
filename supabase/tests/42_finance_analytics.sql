-- 42. Финансовая аналитика (0121): P&L, деление расходов, маржа, изоляция.
-- Продолжает данные 01–03: арендатор aaaa…01 с владельцем 1111.

\set ON_ERROR_STOP on
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off

\echo '=== 42. Фінансова аналітика ==='

\echo '--- подготовка: категории, записи за два месяца'
do $$
declare v_fix uuid; v_var uuid;
begin
  set local role authenticated;
  insert into public.finance_categories (tenant_id, kind, name, is_fixed)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'expense', 'Оренда 42', true)
  returning id into v_fix;
  insert into public.finance_categories (tenant_id, kind, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'expense', 'Матеріали 42')
  returning id into v_var;

  insert into public.finance_records (tenant_id, kind, amount, category_id, occurred_on, created_by)
  values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'income',  1000, null,  date '2026-06-05', '11111111-1111-1111-1111-111111111111'),
    ('aaaaaaaa-0000-0000-0000-000000000001', 'income',   500, null,  date '2026-07-10', '11111111-1111-1111-1111-111111111111'),
    ('aaaaaaaa-0000-0000-0000-000000000001', 'expense',  300, v_fix, date '2026-06-07', '11111111-1111-1111-1111-111111111111'),
    ('aaaaaaaa-0000-0000-0000-000000000001', 'expense',  200, v_var, date '2026-06-20', '11111111-1111-1111-1111-111111111111');
end $$;

\echo '--- ГЛАВНОЕ: P&L делит месяцы и виды расходов'
do $$ declare r record; n int := 0; begin
  set local role authenticated;
  for r in select * from public.finance_pnl(
    'aaaaaaaa-0000-0000-0000-000000000001', date '2026-06-01', date '2026-07-31')
  loop
    n := n + 1;
    if r.bucket = date '2026-06-01' then
      if r.income <> 1000 or r.expense_fixed <> 300
         or r.expense_variable <> 200 or r.net <> 500 then
        raise exception 'ПРОВАЛ: червень %/%/%/%', r.income, r.expense_fixed, r.expense_variable, r.net;
      end if;
    elsif r.bucket = date '2026-07-01' then
      if r.income <> 500 or r.net <> 500 then
        raise exception 'ПРОВАЛ: липень %/%', r.income, r.net;
      end if;
    end if;
  end loop;
  if n < 2 then raise exception 'ПРОВАЛ: місяців %', n; end if;
  raise notice 'ок: P&L два місяці, види розділені';
end $$;

\echo '--- накопленный итог растёт по дням'
do $$ declare v numeric; begin
  set local role authenticated;
  select running into v from public.finance_running(
    'aaaaaaaa-0000-0000-0000-000000000001', date '2026-06-01', date '2026-07-31')
   order by day desc limit 1;
  if v = 1000 then raise notice 'ок: підсумок періоду 1000';
  else raise exception 'ПРОВАЛ: підсумок %', v; end if;
end $$;

\echo '--- ГЛАВНОЕ: маржа услуги = цена − рецептура − своя себестоимость'
do $$ declare r record; begin
  -- Расходник с себестоимостью и рецептура на служебный вариант.
  update public.materials set cost_per_unit = 10
   where id = 'dddddddd-0000-0000-0000-000000000001';
  insert into public.variant_materials (variant_id, material_id, quantity_per_unit)
  values ('cccccccc-0000-0000-0000-000000000002',
          'dddddddd-0000-0000-0000-000000000001', 2)
  on conflict do nothing;

  set local role authenticated;
  select * into r from public.variant_margin_view
   where variant_id = 'cccccccc-0000-0000-0000-000000000002';
  if not found then raise exception 'ПРОВАЛ: варіант не у поданні'; end if;
  if r.recipe_cost <> 20 then
    raise exception 'ПРОВАЛ: рецептура % (очік. 20)', r.recipe_cost;
  end if;
  if r.price is not null and r.margin <> r.price - r.unit_cost then
    raise exception 'ПРОВАЛ: маржа % при ціні % і собівартості %', r.margin, r.price, r.unit_cost;
  end if;
  raise notice 'ок: рецептура 20, маржа рахується';
end $$;

\echo '--- изоляция: чужой арендатор не видит ни P&L, ни маржи'
do $$ declare n int; begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '22222222-2222-2222-2222-222222222222',
    'app_metadata', json_build_object(
      'memberships', '{}'::json, 'perms', '{}'::json, 'modules', '{}'::json)
  )::text, true);
  select count(*) into n from public.finance_pnl(
    'aaaaaaaa-0000-0000-0000-000000000001', date '2026-01-01', date '2026-12-31');
  if n > 0 then raise exception 'ПРОВАЛ: чужий бачить P&L (%)', n; end if;
  select count(*) into n from public.variant_margin_view
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if n > 0 then raise exception 'ПРОВАЛ: чужий бачить маржу (%)', n; end if;
  raise notice 'ок: чужому порожньо';
end $$;

\echo '--- anon к аналитике не допущен вовсе'
do $$ begin
  set local role anon;
  perform * from public.finance_pnl(
    'aaaaaaaa-0000-0000-0000-000000000001', date '2026-01-01', date '2026-12-31');
  raise exception 'ПРОВАЛ: anon виконав finance_pnl';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ок — %', sqlerrm;
end $$;

\echo '=== 42 пройдено ==='
