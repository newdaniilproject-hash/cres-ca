-- 31. Тема в профиле и запрет самоповышения до сотрудника платформы (0109).
--
-- Оба запрета проверяются ПОПЫТКОЙ их нарушить, а не наличием колонки
-- и триггера: «объект существует» показывало бы зелёное и на пустом теле
-- функции (см. CLAUDE.md → «Тесты», урок 0076).

begin;

\echo '=== 31. Тема профиля и сторож is_staff ==='

insert into auth.users (id, email)
values ('31000000-0000-0000-0000-000000000001', 'theme@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values ('31000000-0000-0000-0000-000000000001', 'theme@example.com', 'Тестова тема')
on conflict (id) do nothing;

\echo '--- умолчание светлое: оно же умолчание интерфейса'
select case when theme = 'light' then 'ок' else 'ПРОВАЛ: умолчание ' || theme end as проверка
  from public.profiles where id = '31000000-0000-0000-0000-000000000001';

\echo '--- чужого значения темы в колонке не бывает'
do $$
begin
  update public.profiles set theme = 'neon'
   where id = '31000000-0000-0000-0000-000000000001';
  raise warning 'ПРОВАЛ: приняли неизвестную тему';
exception when check_violation then
  raise notice 'ок: неизвестная тема отбита';
end $$;

\echo '--- человек меняет СВОЮ тему: должно проходить'
select test.login('31000000-0000-0000-0000-000000000001') is not null as вошли;
set role authenticated;
do $$
begin
  update public.profiles set theme = 'dark'
   where id = '31000000-0000-0000-0000-000000000001';
  if not found then
    raise warning 'ПРОВАЛ: своя тема не сохранилась';
  else
    raise notice 'ок: своя тема сохранена';
  end if;
end $$;
reset role;

\echo '--- ГЛАВНОЕ: is_staff себе не выдаётся из кабинета'
select test.login('31000000-0000-0000-0000-000000000001') is not null as вошли;
set role authenticated;
do $$
begin
  update public.profiles set is_staff = true
   where id = '31000000-0000-0000-0000-000000000001';
  raise warning 'ПРОВАЛ: сотрудник платформы выдаётся обычным UPDATE';
exception when others then
  raise notice 'ок: самоповышение отбито (%)', sqlerrm;
end $$;
reset role;

\echo '--- признак остался ложным'
select case when is_staff then 'ПРОВАЛ: is_staff = true' else 'ок' end as проверка
  from public.profiles where id = '31000000-0000-0000-0000-000000000001';

\echo '--- служебной ролью признак по-прежнему выдаётся'
update public.profiles set is_staff = true
 where id = '31000000-0000-0000-0000-000000000001';
select case when is_staff then 'ок' else 'ПРОВАЛ: миграции не могут выдать признак' end as проверка
  from public.profiles where id = '31000000-0000-0000-0000-000000000001';

rollback;
