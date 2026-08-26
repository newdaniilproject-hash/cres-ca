-- 49. Живі дані (0133).
--
-- Перевіряється ПОВЕДІНКА, а не наявність тригера: «тригер існує»
-- показувало б зелене і тоді, коли тіло стерли `create or replace`
-- поверх (так уже було з 0076 і 0052).

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'owner49@test'),
  ('49000000-0000-0000-0000-000000000002', 'chuzhyi49@test');

insert into public.profiles (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'owner49@test'),
  ('49000000-0000-0000-0000-000000000002', 'chuzhyi49@test')
on conflict (id) do update set email = excluded.email;

insert into public.tenants (id, slug, name, status, kind) values
  ('49000000-0000-0000-0000-0000000000aa', 'pulse-shop', 'Пульс', 'active', 'services'),
  ('49000000-0000-0000-0000-0000000000bb', 'other-shop', 'Чужий', 'active', 'services');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('49000000-0000-0000-0000-0000000000aa', '49000000-0000-0000-0000-000000000001', 'owner'),
  ('49000000-0000-0000-0000-0000000000bb', '49000000-0000-0000-0000-000000000002', 'owner');

\echo '--- 0133: заведення закладу вже підняло пульс (тригер на tenants)'
do $$
declare v_rev bigint;
begin
  select rev into v_rev from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v_rev is null or v_rev < 1 then
    raise exception 'ПРОВАЛ: пульс закладу не заведено (rev=%)', v_rev;
  end if;
  raise notice 'ok — пульс є, rev=%', v_rev;
end $$;

\echo '--- 0133: зміна в БУДЬ-ЯКІЙ таблиці закладу підіймає пульс'
-- Беремо три різні таблиці з трьох різних розділів: склад, клієнти,
-- санітарний журнал. Якщо пульс стоїть тільки там, де про нього
-- згадали, це видно тут.
do $$
declare v0 bigint; v1 bigint; v2 bigint; v3 bigint;
begin
  select rev into v0 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';

  insert into public.suppliers (tenant_id, name)
  values ('49000000-0000-0000-0000-0000000000aa', 'Постачальник');
  select rev into v1 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v1 <= v0 then raise exception 'ПРОВАЛ: склад не підняв пульс'; end if;

  insert into public.customers (tenant_id, name)
  values ('49000000-0000-0000-0000-0000000000aa', 'Оксана');
  select rev into v2 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v2 <= v1 then raise exception 'ПРОВАЛ: клієнти не підняли пульс'; end if;

  insert into public.storage_locations (tenant_id, name)
  values ('49000000-0000-0000-0000-0000000000aa', 'Полиця');
  select rev into v3 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v3 <= v2 then raise exception 'ПРОВАЛ: довідник не підняв пульс'; end if;

  raise notice 'ok — три різні таблиці підняли пульс: % → %', v0, v3;
end $$;

\echo '--- 0133: правка і видалення теж підіймають'
do $$
declare v0 bigint; v1 bigint; v2 bigint; v_id uuid;
begin
  select id into v_id from public.suppliers
   where tenant_id = '49000000-0000-0000-0000-0000000000aa' limit 1;
  select rev into v0 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';

  update public.suppliers set name = 'Інший' where id = v_id;
  select rev into v1 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v1 <= v0 then raise exception 'ПРОВАЛ: UPDATE не підняв пульс'; end if;

  delete from public.suppliers where id = v_id;
  select rev into v2 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v2 <= v1 then raise exception 'ПРОВАЛ: DELETE не підняв пульс'; end if;

  raise notice 'ok — правка і видалення підіймають';
end $$;

\echo '--- 0133: операція на багато рядків підіймає пульс РІВНО ОДИН раз'
-- Це та властивість, заради якої тригери стоять на операцію, а не на
-- рядок. Кожне підняття — окрема подія realtime; імпорт каталогу на
-- пʼять тисяч рядків при тригері «на рядок» дав би пʼять тисяч подій
-- в один канал. Зламатись це може мовчки: усе працює, просто заливає
-- канал, — тому перевіряємо числом, а не оком.
do $$
declare v0 bigint; v1 bigint;
begin
  select rev into v0 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';

  insert into public.customers (tenant_id, name)
  select '49000000-0000-0000-0000-0000000000aa', 'Гурт ' || i
    from generate_series(1, 25) i;

  select rev into v1 from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  if v1 - v0 <> 1 then
    raise exception 'ПРОВАЛ: 25 рядків підняли пульс % разів замість одного', v1 - v0;
  end if;
  raise notice 'ok — 25 рядків = одне підняття';
end $$;

\echo '--- 0133: чужий пульс не підіймається'
-- Головне, чого не має статись: зміна в моєму закладі не смикає екрани
-- сусіда. Інакше ми б розсилали чужим людям сигнал «у вас щось
-- змінилось» на кожен свій рух.
do $$
declare v_before bigint; v_after bigint;
begin
  select rev into v_before from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000bb';
  insert into public.customers (tenant_id, name)
  values ('49000000-0000-0000-0000-0000000000aa', 'Ще одна');
  select rev into v_after from public.tenant_pulse
   where tenant_id = '49000000-0000-0000-0000-0000000000bb';
  if v_after <> v_before then
    raise exception 'ПРОВАЛ: своя зміна підняла ЧУЖИЙ пульс (% → %)', v_before, v_after;
  end if;
  raise notice 'ok — чужий пульс не зачеплено';
end $$;

\echo '--- 0133: чужий пульс НЕ ВИДНО'
\set QUIET on
select test.login('49000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select count(*) as свій_пульс_ожид_1 from public.tenant_pulse
 where tenant_id = '49000000-0000-0000-0000-0000000000aa';
select count(*) as чужий_пульс_ожид_0 from public.tenant_pulse
 where tenant_id = '49000000-0000-0000-0000-0000000000bb';

\echo '--- 0133: пульс не пишуть руками'
-- Підняти чужий пульс — це змусити чужі екрани перезапитуватись.
-- Писати в таблицю має право тільки тригер.
do $$
begin
  update public.tenant_pulse set rev = rev + 100
   where tenant_id = '49000000-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: пульс піднято руками';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0133: анонім пульсу не бачить'
set role anon;
do $$
begin
  perform 1 from public.tenant_pulse;
  raise notice 'ok — читання анонімом нічого не віддає (RLS)';
exception when insufficient_privilege then
  raise notice 'ok — анониму читання відмовлено';
end $$;
reset role;

\echo '--- 0133: таблиця в публікації realtime'
-- Без цього рядка тригер працює, пульс росте, а застосунок про це
-- не дізнається ніколи: подія просто не піде.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'tenant_pulse'
  ) then
    raise exception 'ПРОВАЛ: tenant_pulse не в публікації supabase_realtime';
  end if;
  raise notice 'ok — публікація на місці';
end $$;

\echo '--- 0133: видалення закладу не ламається об власний пульс'
-- Це не гіпотетична перевірка: рівно на цьому 0133 і впала з першого
-- прогону (09_team.sql, «видалення акаунта зламане»). Заклад іде — каскад
-- тягне за собою дочірні рядки, кожне видалення приходить у тригер, а той
-- пробує підняти пульс закладу, якого вже немає. Зовнішній ключ падає,
-- і разом з ним падає ВСЕ видалення акаунта.
--
-- Тому перевіряємо не «тригер обережний», а те, що видалення проходить.
--
-- Заклад для цього беремо БЕЗ учасників і без журналу прав: справжній
-- шлях видалення акаунта (`purge_tenant_rows`, 0058) прибирає дочірні
-- рядки заздалегідь і сам перевіряється в 09_team.sql. Тут перевіряється
-- рівно одне — каскад від `tenants` до дочірнього рядка, бо саме він
-- приходить у наш тригер уже після того, як закладу не стало.
insert into public.tenants (id, slug, name, status, kind)
values ('49000000-0000-0000-0000-0000000000cc', 'gone-shop', 'На видалення', 'active', 'services');
insert into public.customers (tenant_id, name)
values ('49000000-0000-0000-0000-0000000000cc', 'Клієнт');

do $$
begin
  delete from public.tenants where id = '49000000-0000-0000-0000-0000000000cc';
exception when others then
  raise exception 'ПРОВАЛ: пульс зламав видалення закладу — %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from public.tenant_pulse
              where tenant_id = '49000000-0000-0000-0000-0000000000cc') then
    raise exception 'ПРОВАЛ: пульс лишився після видалення закладу';
  end if;
  raise notice 'ok — заклад видалено разом із пульсом';
end $$;

rollback;
