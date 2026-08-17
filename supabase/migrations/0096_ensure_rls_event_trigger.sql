-- ===========================================================================
-- 0096. Единственный объект боевой базы, которого не создаёт ни одна
--       миграция: событийный триггер ensure_rls и его функция.
-- ===========================================================================
--
-- КАК НАШЛОСЬ. Сверкой «база, собранная из репозитория с нуля» против боевой
-- по каталогу Postgres. Совпало всё: колонки 79 таблиц и представлений,
-- 160 политик, 83 триггера, 123 значения перечислений, 273 индекса,
-- 353 ограничения, определения 12 представлений, права на выполнение всех
-- функций для anon и authenticated, справочные строки (role_grants — 76,
-- переходы заказов — 16, переходы записей — 10, шаблоны писем — 25,
-- специальности — 20). Разошлась ровно одна строка: на бою есть функция
-- `public.rls_auto_enable()` и событийный триггер `ensure_rls`, а в
-- репозитории их не создаёт никто.
--
-- ОТКУДА ОНИ ВЗЯЛИСЬ. Из проекта Supabase, ещё до первой нашей миграции —
-- это прямо записано в шапке 0005: «Эта функция создана НЕ нашими
-- миграциями — она уже была в проекте при первом подключении». 0005 её
-- не заводит, а только отбирает у PUBLIC право на выполнение, и делает это
-- под `if exists` — то есть на пустой базе просто молча ничего не делает.
--
-- ЧТО ЭТО ЗНАЧИТ ПРАКТИЧЕСКИ. Развернув репозиторий с нуля, получаешь базу
-- БЕЗ страховки, которая на бою есть: новая таблица в схеме public здесь
-- не получит RLS автоматически. Сегодня это ничего не ломает — проверено:
-- ни одной таблицы без RLS нет ни на бою, ни в собранной из репозитория
-- базе, каждая миграция включает его сама. Но страховка ставится ровно
-- на тот случай, когда кто-то забудет, а «на бою есть, в репозитории нет»
-- — это то состояние, из-за которого забытое обнаруживают на бою.
--
-- ПОЧЕМУ ЧЕРЕЗ ИСКЛЮЧЕНИЕ. Событийный триггер создаёт не всякая роль.
-- На бою владелец функции — `postgres`, и там это проходит; на чужом
-- стенде или в окружении с урезанной ролью — может не пройти. Миграция,
-- которая роняет весь накат из-за необязательной страховки, хуже, чем
-- отсутствие страховки. Поэтому отказ здесь глотается и объясняется
-- в логе, а не останавливает цепочку.
--
-- ТЕЛО ФУНКЦИИ ПЕРЕНЕСЕНО С БОЯ ДОСЛОВНО, включая `search_path` и то, что
-- она глотает собственные ошибки: это не наш код, и переписывать его
-- «как лучше» здесь нельзя — сверка каталога сразу же разошлась бы снова.
-- ===========================================================================

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

comment on function public.rls_auto_enable() is
  'Страховка: новая таблица в схеме public получает RLS автоматически. Пришла из проекта Supabase, а не из наших миграций; в репозиторий положена в 0096, чтобы база из него совпадала с боевой.';

-- Правило 7. 0005 делает это же под `if exists` — то есть на пустой базе
-- не делает вовсе, потому что функции там ещё нет. Повторяем здесь, иначе
-- на развёрнутой с нуля базе функция осталась бы с EXECUTE для PUBLIC.
revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;

do $$
begin
  if exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    return;
  end if;
  begin
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
  exception when insufficient_privilege or feature_not_supported then
    raise warning 'ensure_rls не создан: роли % не хватает прав на событийный триггер. Страховки «RLS на новую таблицу» в этой базе не будет; сами таблицы включают RLS в своих миграциях.', current_user;
  end;
end $$;
