-- 48. Запуск закладу (0131).
--
-- Перевіряється ПОПЫТКОЙ порушення, а не наявністю тригера: «функція
-- існує» показувало б зелене і тоді, коли тіло стерли `create or replace`
-- поверх (так уже було з 0076 і 0052).

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('48000000-0000-0000-0000-000000000001', 'owner48@test');

insert into public.profiles (id, email)
values ('48000000-0000-0000-0000-000000000001', 'owner48@test')
on conflict (id) do update set email = excluded.email;

insert into public.tenants (id, slug, name, status, kind) values
  ('48000000-0000-0000-0000-0000000000aa', 'run-shop', 'Чернетка', 'draft', 'services'),
  ('48000000-0000-0000-0000-0000000000bb', 'sus-shop', 'Призупинений', 'suspended', 'services');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('48000000-0000-0000-0000-0000000000aa', '48000000-0000-0000-0000-000000000001', 'owner'),
  ('48000000-0000-0000-0000-0000000000bb', '48000000-0000-0000-0000-000000000001', 'owner');

\set QUIET on
select test.login('48000000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;

\echo '--- 0131: власник запускає свою чернетку'
update public.tenants set status = 'active'
 where id = '48000000-0000-0000-0000-0000000000aa';
select status as запущено_ожид_active from public.tenants
 where id = '48000000-0000-0000-0000-0000000000aa';

\echo '--- 0131: назад у чернетку — не можна'
-- Заклад, який уже бачили покупці, не «розпубліковують» статусом:
-- для цього є `storefront_enabled`, і він саме для цього й заведений.
do $$
begin
  update public.tenants set status = 'draft'
   where id = '48000000-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: активний заклад повернули в чернетку';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0131: ПРИЗУПИНЕНИЙ заклад не знімає призупинення сам'
-- Головний сценарій цієї міграції. До неї політика `tenants_member_update`
-- дозволяла це звичайним UPDATE, і діра існувала незалежно від екрана.
do $$
begin
  update public.tenants set status = 'active'
   where id = '48000000-0000-0000-0000-0000000000bb';
  raise exception 'ПРОВАЛ: призупинений заклад активував себе сам';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0131: архівувати себе теж не можна'
do $$
begin
  update public.tenants set status = 'archived'
   where id = '48000000-0000-0000-0000-0000000000aa';
  raise exception 'ПРОВАЛ: заклад заархівував себе сам';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0131: решта колонок правиться як і раніше'
-- Сторож стоїть `before update of status` і не має чіпати нічого іншого.
-- Якби він спрацьовував на будь-який UPDATE, екран налаштувань перестав би
-- зберігати назву — і виявилось би це не тестом, а клієнтом.
update public.tenants set name = 'Нова назва', storefront_enabled = true
 where id = '48000000-0000-0000-0000-0000000000aa';
select name as назва_ожид_Нова_назва, storefront_enabled as вітрина_ожид_t
  from public.tenants where id = '48000000-0000-0000-0000-0000000000aa';

reset role;

\echo '--- 0131: службове підключення робить будь-який перехід'
-- Платформа призупиняє і повертає заклади саме звідси; `auth.uid()`
-- при цьому порожній.
--
-- ⚠️ `reset role` НЕ ЧИСТИТЬ КЛЕЙМИ: `test.login` кладе їх у
-- `request.jwt.claims` через `set_config`, і після зміни ролі вони
-- лишаються. Без цього рядка тест перевіряв би не службове підключення,
-- а того самого власника під іншою роллю — і падав, що й сталося
-- з першою редакцією.
--
-- Клейми ставляться СЕРВІСНІ, а не порожні: `auth.uid()` розбирає
-- `request.jwt.claims` як json, і порожній рядок валить його помилкою
-- «invalid input syntax for type json», а не дає null. У бою сервісний
-- ключ приходить із справжнім токеном без `sub` — саме це тут і
-- відтворюється.
\set QUIET on
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
\set QUIET off
update public.tenants set status = 'suspended'
 where id = '48000000-0000-0000-0000-0000000000aa';
update public.tenants set status = 'active'
 where id = '48000000-0000-0000-0000-0000000000bb';
select
  (select status from public.tenants where id = '48000000-0000-0000-0000-0000000000aa')
    as призупинено_ожид_suspended,
  (select status from public.tenants where id = '48000000-0000-0000-0000-0000000000bb')
    as повернуто_ожид_active;

rollback;
