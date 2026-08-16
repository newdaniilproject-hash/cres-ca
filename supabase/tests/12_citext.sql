-- 12_citext.sql — регистр букв в почте и слаге (миграции 0017, 0025).
--
-- 0017 перенесла расширение citext из public в extensions. Перенос дешёвый
-- на вид и дорогой на деле: 0025 чинила ровно его последствие — функция
-- с `set search_path = ''` и типом `public.citext` в подписи падала до
-- первой строки тела, и создание заклада не работало вовсе.
--
-- Проверяется не «расширение лежит в такой-то схеме» (это ничего не значит),
-- а ПОВЕДЕНИЕ, ради которого citext вообще взяли: «Worker@Test.ua» и
-- «worker@test.ua» — один и тот же человек, «CafeTest» и «cafetest» —
-- один и тот же адрес витрины. Каждая проверка пробует завести второго.
--
-- ⚠️ В ЭТОМ НАБОРЕ ЕСТЬ ДВЕ НАМЕРЕННО КРАСНЫЕ СТРОКИ. Они помечены
-- «ПРОВАЛ» через `raise warning` (а не `raise exception`), чтобы прогон
-- шёл дальше и показал всю картину: дефект настоящий, и лучше видеть
-- его красным, чем не видеть вовсе. Разбор — у самих проверок.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aa120000-0000-0000-0000-000000000001','boss@test.ua'),
  ('aa120000-0000-0000-0000-000000000002','nova@test.ua'),
  ('aa120000-0000-0000-0000-000000000003','mixed@Test.ua')
on conflict (id) do nothing;

\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select (r.name = 'Кавярня Ко') as заклад_створено_ожид_t
  from public.register_tenant('Кавярня Ко', 'goods', 'Полтава') r;
reset role;
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off

\echo '--- 0025: register_tenant принимает явный слаг типом extensions.citext'
-- Тот самый вызов, который падал до 0025 с «type public.citext does not
-- exist»: под пустым search_path тип из расширения обязан быть написан
-- со своей схемой. Ошибка здесь означает возврат того дефекта.
set role authenticated;
do $$
declare v public.tenants;
begin
  v := public.register_tenant('Кава Друга', 'goods', 'Полтава', 'CafeTest'::extensions.citext);
  if v.slug::text <> 'CafeTest' then
    raise exception 'ПРОВАЛ: явний слаг переписано на «%»', v.slug;
  end if;
  raise notice 'ok — слаг узято як передали: %', v.slug;
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise exception 'ПРОВАЛ: register_tenant з явним слагом впав — %', sqlerrm;
end $$;

\echo '--- 0017: слаг «CAFETEST» — тот же адрес, второго заклада на нём не будет'
-- Уникальный индекс по tenants.slug построен операторным классом citext,
-- и он регистр видит: попытка занять тот же адрес заглавными обязана
-- уйти в ветку с суффиксом, а не создать вторую витрину по тому же URL.
select (r.slug::text <> 'CAFETEST') as другий_слаг_отримав_суфікс_ожид_t
  from public.register_tenant('Кава Третя', 'goods', 'Полтава', 'CAFETEST'::extensions.citext) r;
reset role;

select count(*) as закладів_на_адресі_cafetest_ожид_1
  from public.tenants where lower(slug::text) = 'cafetest';

\echo '--- 0017: витрина по слагу в другом регистре — КРАСНАЯ, дефект ниже'
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
update public.tenants set status = 'active', storefront_enabled = true
 where slug::text = 'CafeTest';
reset role;

-- ДЕФЕКТ. storefront() объявлена `set search_path = ''` (правило проекта),
-- и внутри неё сравнение `t.slug = p_slug` — это НЕ оператор citext:
-- оператор citext живёт в схеме extensions, а её в пустом search_path нет.
-- Postgres молча приводит оба значения к text и сравнивает по регистру.
-- Проверено на бою (jobvstdwoyifspaiwazn):
--   set local search_path = '';
--   select 'CafeTest'::extensions.citext = 'cafetest'::extensions.citext; → false
-- Следствие: заклад со слагом «CafeTest» недостижим по адресу «cafetest»,
-- то есть citext в этих функциях не работает вообще — ни для слага,
-- ни для почты, ни для штрихкода.
set role anon;
do $$
declare v_low jsonb; v_exact jsonb;
begin
  v_low   := public.storefront('cafetest'::extensions.citext);
  v_exact := public.storefront('CafeTest'::extensions.citext);
  if v_exact is null then
    raise exception 'ПРОВАЛ: вітрина не віддає заклад навіть по точному слагу';
  end if;
  if v_low is null then
    raise warning 'ПРОВАЛ: вітрина «cafetest» не знайшла заклад зі слагом «CafeTest» — citext під search_path='''' порівнює за регістром';
  else
    raise notice 'ok — слаг нечутливий до регістру';
  end if;
end $$;
reset role;

-- ─────────────────────────────────────────────────────────────────────────
-- Почта. Приглашение выписывается через create_invitation, принимается
-- через accept_invitation — то же, что зовёт экран команды.
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0017: приглашение на «NOVA@TEST.UA» принимает владелец «nova@test.ua»'
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select token as inv_nova from public.create_invitation(
    (select id from public.tenants where name = 'Кавярня Ко'),
    'NOVA@TEST.UA', 'operator') \gset
reset role;
-- Токен кладём в настройку сеанса: внутри do-блока переменные psql
-- не подставляются — для psql это одна строка.
select set_config('test.inv_nova', :'inv_nova', false) is not null as токен_збережено;

\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
select public.accept_invitation(current_setting('test.inv_nova')) is not null as прийнято_ожид_t;
reset role;

select count(*) as учасників_ожид_1
  from public.tenant_members tm
 where tm.user_id = 'aa120000-0000-0000-0000-000000000002';

\echo '--- 0017: второй регистр той же почты НЕ заводит второго участника'
-- Главная проверка набора. create_invitation ищет уже заведённого по
-- profiles.email = v_email. Пока почта в profiles хранится строчными,
-- сравнение совпадает и запрет срабатывает.
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.create_invitation(
    (select id from public.tenants where name = 'Кавярня Ко'),
    'Nova@Test.ua', 'operator');
  raise exception 'ПРОВАЛ: другий регістр пошти виписав друге запрошення тій самій людині';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

select count(*) as учасників_після_спроби_ожид_1
  from public.tenant_members tm
 where tm.user_id = 'aa120000-0000-0000-0000-000000000002';

\echo '--- 0017: два живых приглашения на одну почту в разном регистре не уживаются'
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select token as inv_dup from public.create_invitation(
    (select id from public.tenants where name = 'Кавярня Ко'),
    'Dup@Test.ua', 'viewer') \gset
do $$
begin
  perform public.create_invitation(
    (select id from public.tenants where name = 'Кавярня Ко'),
    'DUP@TEST.UA', 'viewer');
  raise exception 'ПРОВАЛ: на одну пошту виписано два живих запрошення';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0017: почта с заглавной буквой — КРАСНАЯ, тот же дефект'
-- ДЕФЕКТ, вторая грань. accept_invitation сверяет `i.email = v_mail`,
-- тоже под пустым search_path. Приглашение всегда записано строчными
-- (create_invitation делает lower), а profiles.email хранит то, что
-- пришло из auth. Человек с почтой «mixed@Test.ua» приглашение принять
-- НЕ МОЖЕТ: строка сравнивается как text. Чинится он же — либо
-- `set search_path to extensions` у этих функций, либо явный
-- `lower()` с обеих сторон.
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000001');
\set QUIET off
set role authenticated;
select token as inv_mixed from public.create_invitation(
    (select id from public.tenants where name = 'Кавярня Ко'),
    'MIXED@TEST.UA', 'viewer') \gset
reset role;
select set_config('test.inv_mixed', :'inv_mixed', false) is not null as токен_збережено;

\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000003');
\set QUIET off
set role authenticated;
do $$
begin
  perform public.accept_invitation(current_setting('test.inv_mixed'));
  raise notice 'ok — запрошення прийняте, регістр пошти не завадив';
exception when others then
  raise warning 'ПРОВАЛ: людина з поштою «mixed@Test.ua» не змогла прийняти запрошення на «mixed@test.ua» — %', sqlerrm;
end $$;
reset role;

-- Следствие того же дефекта, и оно тоже КРАСНОЕ: пока приглашение
-- не принято, человека в закладе нет. Ноль в этой колонке — не забытая
-- проверка, а цена ошибки: приглашённый не может войти, и починить это
-- из интерфейса нельзя, потому что интерфейс за приглашением.
select count(*) as учасник_зі_змішаною_поштою_ожид_1
  from public.tenant_members tm
 where tm.user_id = 'aa120000-0000-0000-0000-000000000003';

\echo '--- 0017: приглашение на чужую почту не принимается'
-- Ловушка на случай, если сверку почты из accept_invitation уберут
-- «чтобы починить предыдущую строку»: приглашение выписано на dup@test.ua,
-- принимать его идёт nova@test.ua.
\set QUIET on
select test.login('aa120000-0000-0000-0000-000000000002');
\set QUIET off
set role authenticated;
select set_config('test.inv_dup', :'inv_dup', false) is not null as токен_збережено;
do $$
begin
  perform public.accept_invitation(current_setting('test.inv_dup'));
  raise exception 'ПРОВАЛ: запрошення прийняв не той, кому воно виписане';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;
