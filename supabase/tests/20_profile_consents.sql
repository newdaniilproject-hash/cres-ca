-- 20_profile_consents.sql — личность и согласия (миграция 0026).
--
-- «Галочка в форме без записи о том, КОГДА и на КАКУЮ ВЕРСИЮ документа
-- человек согласился, — это не согласие, а картинка» (шапка 0026).
-- Поэтому проверяется не наличие таблицы, а то, что запись появляется
-- САМА при регистрации, содержит версию и дату, не видна чужому
-- и не переписывается задним числом.
--
-- Регистрация в бою — это вставка строки в auth.users самим Supabase.
-- Здесь она же: триггер on_auth_user_created зовёт handle_new_user, тот
-- разбирает raw_user_meta_data из options.data при signUp. Тест не
-- имитирует профиль руками — иначе проверялось бы то, чего в бою нет.

\set ON_ERROR_STOP on

\echo '--- 0026: регистрация раскладывает имя, фамилию, телефон и дату рождения'
insert into auth.users (id, email, raw_user_meta_data)
values ('aa200000-0000-0000-0000-000000000001','olena@test.ua',
        '{"first_name":"Олена","last_name":"Петренко-Коваль","phone":"+380631234567",
          "birth_date":"1994-03-17","terms_version":"2026-08-01","signup_source":"ios"}'::jsonb);

select first_name as імя_ожид_олена,
       last_name  as прізвище_ожид_петренко_коваль,
       full_name  as повне_імя_ожид_олена_петренко,
       phone      as телефон_ожид_380631234567,
       birth_date as дата_ожид_1994_03_17
  from public.profiles where id = 'aa200000-0000-0000-0000-000000000001';

\echo '--- 0026: галочка = три согласия, каждое с версией, датой и источником'
-- Отозвать cookie-согласие можно, не отзывая оферту, поэтому строки три,
-- а не одна.
select string_agg(document, ',' order by document) as документи_ожид_cookies_privacy_terms,
       count(distinct version)  as версій_ожид_1,
       max(version)             as версія_ожид_2026_08_01,
       count(*) filter (where accepted_at is null) as без_дати_ожид_0,
       max(source)              as джерело_ожид_ios
  from public.user_consents where user_id = 'aa200000-0000-0000-0000-000000000001';

\echo '--- 0026: кривая дата рождения НЕ роняет регистрацию'
-- «Потерять регистрацию из-за поля дата рождения — худший из исходов».
insert into auth.users (id, email, raw_user_meta_data)
values ('aa200000-0000-0000-0000-000000000002','krive@test.ua',
        '{"first_name":"Іван","birth_date":"17 березня","terms_version":"2026-08-01"}'::jsonb);

select (id is not null)      as профіль_створено_ожид_t,
       birth_date is null    as дата_відкинута_ожид_t,
       first_name            as імя_ожид_іван
  from public.profiles where id = 'aa200000-0000-0000-0000-000000000002';

\echo '--- 0026: дата рождения из будущего отбрасывается, а не сохраняется'
insert into auth.users (id, email, raw_user_meta_data)
values ('aa200000-0000-0000-0000-000000000003','future@test.ua',
        ('{"birth_date":"' || to_char(current_date + 30, 'YYYY-MM-DD') ||
         '","terms_version":"2026-08-01","signup_source":"марсіанський"}')::jsonb);

select birth_date is null as дата_з_майбутнього_ожид_t
  from public.profiles where id = 'aa200000-0000-0000-0000-000000000003';

\echo '--- 0026: неизвестный источник подписи сводится к web, а не ломает вставку'
select distinct source as джерело_ожид_web
  from public.user_consents where user_id = 'aa200000-0000-0000-0000-000000000003';

\echo '--- 0026: вход через Google даёт только имя — и это нормально'
-- У OAuth нет ни телефона, ни галочки; профиль обязан завестись,
-- а согласий быть не должно: человек их не давал.
insert into auth.users (id, email, raw_user_meta_data)
values ('aa200000-0000-0000-0000-000000000004','google@test.ua',
        '{"full_name":"Google Користувач"}'::jsonb);

select full_name as повне_імя_ожид_google_користувач,
       (select count(*) from public.user_consents
         where user_id = 'aa200000-0000-0000-0000-000000000004') as згод_ожид_0
  from public.profiles where id = 'aa200000-0000-0000-0000-000000000004';

\echo '--- 0026: дата рождения из XIX века — опечатка, а не данные'
-- Проверка стоит в базе, а не только в форме: форма не граница доверия.
do $$
begin
  update public.profiles set birth_date = date '1899-05-05'
   where id = 'aa200000-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: дату народження 1899 року прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
begin
  update public.profiles set birth_date = current_date + 1
   where id = 'aa200000-0000-0000-0000-000000000001';
  raise exception 'ПРОВАЛ: дату народження з майбутнього прийнято';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0026: документ вне перечня согласием не считается'
do $$
begin
  insert into public.user_consents (user_id, document, version)
  values ('aa200000-0000-0000-0000-000000000001','marketing','2026-08-01');
  raise exception 'ПРОВАЛ: згода на неописаний документ записана';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0026: своё согласие видно, чужое — нет'
\set QUIET on
select test.login('aa200000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select count(*) as своїх_згод_ожид_3 from public.user_consents;
reset role;

\set QUIET on
select test.login('aa200000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
select count(*) filter (where user_id = 'aa200000-0000-0000-0000-000000000001')
         as чужих_згод_ожид_0,
       count(*) as своїх_згод_ожид_3
  from public.user_consents;
reset role;

\echo '--- 0026: аноним не видит ни одного согласия'
-- Токен обнуляем ЯВНО: test.login кладёт claims в настройку сеанса,
-- и она переживает смену роли. Без этой строки «аноним» продолжал бы
-- смотреть глазами предыдущего пользователя, а проверка — врать.
\set QUIET on
select set_config('request.jwt.claims', '{}', false);
\set QUIET off
set role anon;
select count(*) as анониму_ожид_0 from public.user_consents;
reset role;

\echo '--- 0026: согласие за другого человека не запишешь'
\set QUIET on
select test.login('aa200000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
do $$
begin
  insert into public.user_consents (user_id, document, version)
  values ('aa200000-0000-0000-0000-000000000001','terms','2026-08-01');
  raise exception 'ПРОВАЛ: згоду записано за іншу людину';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0026: согласие — факт на дату: ни переписать, ни стереть'
-- Политик update и delete у таблицы нет вовсе. RLS на этом не бросает
-- исключение — она молча не находит строк, поэтому считаем изменённые.
do $$
declare v_rows int;
begin
  update public.user_consents set version = '2020-01-01'
   where user_id = 'aa200000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise exception 'ПРОВАЛ: версію згоди переписано, рядків: %', v_rows;
  end if;
  raise notice 'ok — жодного рядка не змінено';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

do $$
declare v_rows int;
begin
  delete from public.user_consents
   where user_id = 'aa200000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise exception 'ПРОВАЛ: згоду видалено, рядків: %', v_rows;
  end if;
  raise notice 'ok — жодного рядка не видалено';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

select count(*) as згоди_на_місці_ожид_3
  from public.user_consents where user_id = 'aa200000-0000-0000-0000-000000000002';

\echo '--- 0026: новая редакция документа даёт НОВУЮ строку, а не правит старую'
\set QUIET on
select test.login('aa200000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
insert into public.user_consents (user_id, document, version, source)
values ('aa200000-0000-0000-0000-000000000001','terms','2026-09-01','web');
select count(*) as редакцій_оферти_ожид_2,
       string_agg(version, ',' order by version) as версії_ожид_обидві
  from public.user_consents
 where user_id = 'aa200000-0000-0000-0000-000000000001' and document = 'terms';
reset role;
