-- 0056 — pgcrypto переезжает в схему extensions.
--
-- ЧТО БЫЛО НЕ ТАК. Миграция 0001_tenancy.sql ставит расширение строкой
--     create extension if not exists "pgcrypto";
-- без `with schema extensions`. Postgres в таком случае кладёт расширение
-- в первую схему из search_path, то есть в public. На боевом Supabase этого
-- не видно: там pgcrypto ставится самой платформой в extensions ЕЩЁ ДО
-- первой нашей миграции, и `if not exists` просто ничего не делает.
-- А на пустом Postgres — том самом, на котором разворачивается набор с нуля, —
-- расширение реально создаётся, и создаётся в public.
--
-- ЧЕМ ГРОЗИЛО. Миграции 0050_invitations и 0054_inspector_time_limited_access
-- зовут pgcrypto по полному имени: extensions.gen_random_bytes(32) и
-- extensions.digest(..., 'sha256'). Это правильно (тела функций объявлены
-- с `set search_path = ''`, короткое имя там не разрешилось бы вовсе), но
-- на новой базе схемы extensions в этих именах нет — pgcrypto-то в public.
--
-- Дефект ЛАТЕНТНЫЙ: сами миграции применяются без единой ошибки. Postgres
-- не разрешает имена внутри тела plpgsql в момент CREATE FUNCTION — только
-- при первом фактическом выполнении. Поэтому «все 56 миграций применились»
-- ничего не доказывало: функции ложились в базу заведомо нерабочими.
-- Сломались бы они в первом же живом сценарии — create_invitation() и
-- accept_invitation(), то есть ПРИГЛАШЕНИЯ СОТРУДНИКОВ НЕ РАБОТАЛИ БЫ
-- ВООБЩЕ на любой развёрнутой с нуля базе (новый стенд, ветка Supabase,
-- восстановление из миграций, перенос к другому провайдеру), и ровно так же
-- лёг бы выпуск временного доступа инспектору из 0054.
--
-- КАК НАШЛОСЬ. Полным прогоном набора на чистом локальном PostgreSQL 16
-- (supabase/tests/run.sh): миграции проходили, а вызов create_invitation()
-- на этой же базе падал с «schema extensions does not exist» /
-- «function extensions.gen_random_bytes(integer) does not exist».
--
-- ЧТО ДЕЛАЕМ. Ровно то же, что 0017_citext_schema.sql сделала для citext:
-- переносим расширение в extensions. OID функций при переносе не меняются,
-- зависимые объекты продолжают работать.
--
-- БЕЗОПАСНОСТЬ ДЛЯ ПРОДА. Миграция сначала смотрит фактическое положение
-- расширения в pg_extension/pg_namespace и переносит ТОЛЬКО если оно сейчас
-- в public. На проде, где pgcrypto уже в extensions, миграция отрабатывает
-- вхолостую и не трогает ничего. Идемпотентна: повторный запуск на любой
-- из двух баз снова ничего не меняет.

-- Схему заводит ещё 0010_bookings.sql; строка ниже нужна на случай, если
-- 0056 когда-нибудь окажется применена в наборе раньше нужного (и чтобы
-- проверка ниже не зависела от порядка).
create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pgcrypto'
       and n.nspname = 'public'
  ) then
    execute 'alter extension pgcrypto set schema extensions';
    raise notice '0056: pgcrypto перенесён из public в extensions';
  else
    raise notice '0056: pgcrypto уже вне public — ничего не меняем';
  end if;
end $$;

-- Чтобы SECURITY DEFINER функции с `set search_path = ''` могли звать
-- extensions.* не только от суперпользователя. На Supabase эти права уже
-- выданы платформой, здесь — no-op.
grant usage on schema extensions to postgres, anon, authenticated, service_role;
