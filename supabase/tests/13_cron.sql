-- 13_cron.sql — расписание уведомлений в базе (миграции 0018 и 0032).
--
-- Зачем это вообще в базе. Напоминание «за 2 часа» с суточным опозданием
-- бессмысленно, а собственный крон Vercel на бесплатном тарифе — один
-- запуск в сутки. Поэтому расписание держит pg_cron, а наружу стучит
-- pg_net. Значит правильность расписания — это правильность продукта,
-- а не деталь развёртывания.
--
-- Что здесь НЕ проверяется и почему: письмо никуда не летит. На стенде
-- net.http_get — заглушка (см. run.sh). Проверяется то, что от базы
-- и зависит: задание создано ровно одно, расписание то самое, адрес тот
-- самый, и — главное после 0032 — секрет берётся из Vault на каждом
-- вызове, а не лежит строкой в теле задания.

\set ON_ERROR_STOP on

\echo '--- 0018/0032: заданий ровно два и оба живые'
-- «Ровно одно» на каждое имя — это и есть проверка того, что повторный
-- накат не задваивает: 0018 создала задание, 0032 сняла его по имени
-- и завела заново. Если бы unschedule не сработал, здесь было бы два.
select jobname as завдання, count(*) as штук_ожид_1, bool_and(active) as живе_ожид_t
  from cron.job
 where jobname in ('notifications-dispatch','expiry-rescan')
 group by jobname order by jobname;

\echo '--- 0018: расписание разбирается и означает «каждые пять минут»'
select schedule as розклад_ожид_кожні_5_хв,
       array_length(string_to_array(schedule, ' '), 1) as полів_ожид_5,
       (schedule = '*/5 * * * *') as збіг_ожид_t
  from cron.job where jobname = 'notifications-dispatch';

select schedule as пересканування_ожид_6_ранку,
       (schedule = '0 6 * * *') as збіг_ожид_t
  from cron.job where jobname = 'expiry-rescan';

\echo '--- 0032: сожжённого токена в теле задания больше нет'
-- Токен из 0018 опубликован в git и в cron.job.command, то есть сожжён.
-- Строка ниже — не формальность: `select command from cron.job` читает
-- любой, кто вошёл в базу как postgres.
select (command like '%1cdf96f8ab05ed10477226ba87d4bda64978d36c75af30bb%') as старий_токен_у_тілі_ожид_f,
       (command like '%vault.decrypted_secrets%')                          as бере_з_vault_ожид_t,
       (command like '%https://cres-ca.com/api/cron/notifications%')       as адреса_ожид_t,
       (command like '%55000%')                                            as таймаут_ожид_t
  from cron.job where jobname = 'notifications-dispatch';

-- ─────────────────────────────────────────────────────────────────────────
-- Дальше — исполнение самого тела задания. Подменяем net.http_get на
-- записывающую: заглушка run.sh ничего не запоминает, а нам нужно увидеть
-- ЗАГОЛОВОК, который задание собрало. Это единственный способ проверить
-- обещание 0032 («секрет приезжает из Vault на каждом вызове»), не
-- переписывая текст задания в тест — исполняется ровно то, что в базе.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists test.http_calls (
  id serial primary key, url text, headers jsonb, at timestamptz default now());

create or replace function net.http_get(
  url                  text,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{}'::jsonb,
  timeout_milliseconds int   default 5000
) returns bigint language sql as $$
  insert into test.http_calls (url, headers) values (url, headers) returning id::bigint;
$$;

\echo '--- 0032: без секрета в Vault заголовок собирается из NULL'
-- Это не дефект, а задокументированное условие захода (шапка 0032):
-- миграция не применяется сама по себе, сначала секрет в Vault.
-- Проверка стоит здесь затем, чтобы «пусто в Vault» отличалось от
-- «секрет приехал»: снаружи оба случая выглядят как 401.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'notifications-dispatch';
  execute v_cmd;
end $$;

select (headers -> 'Authorization') = 'null'::jsonb as заголовок_без_секрету_ожид_t,
       url as адреса_ожид_cres_ca
  from test.http_calls order by id desc limit 1;

\echo '--- 0032: секрет положили в Vault — задание уносит именно его'
select vault.create_secret('secret-alpha-111', 'cron_secret', 'тест') is not null as секрет_покладено;

do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'notifications-dispatch';
  execute v_cmd;
end $$;

select (headers ->> 'Authorization') as заголовок_ожид_bearer_secret_alpha_111,
       ((headers ->> 'Authorization') = 'Bearer secret-alpha-111') as збіг_ожид_t
  from test.http_calls order by id desc limit 1;

\echo '--- 0032: ротация секрета не требует ни миграции, ни правки расписания'
-- Ради этого 0032 и написана. Меняем значение в Vault и повторяем ТО ЖЕ
-- задание: если бы токен по-прежнему сидел в теле, заголовок не изменился бы.
update vault.secrets set secret = 'secret-beta-222' where name = 'cron_secret';

do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'notifications-dispatch';
  execute v_cmd;
end $$;

select ((headers ->> 'Authorization') = 'Bearer secret-beta-222') as новий_секрет_ожид_t,
       (select count(*) from cron.job where jobname = 'notifications-dispatch') as завдань_ожид_1
  from test.http_calls order by id desc limit 1;

\echo '--- 0018: расписание не переписывается кем попало'
-- cron.job принадлежит расширению и роли postgres; ни anon, ни
-- authenticated не должны его ни читать, ни править — иначе секрет
-- (пока он там был) и адрес задания открыты пользователю.
set role authenticated;
do $$
begin
  perform 1 from cron.job limit 1;
  raise exception 'ПРОВАЛ: розклад крона читає звичайний користувач';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

-- Возвращаем заглушку run.sh: следующие наборы не должны зависеть
-- от подменённой функции.
create or replace function net.http_get(
  url                  text,
  params               jsonb default '{}'::jsonb,
  headers              jsonb default '{}'::jsonb,
  timeout_milliseconds int   default 5000
) returns bigint language sql as $$ select 1::bigint $$;
