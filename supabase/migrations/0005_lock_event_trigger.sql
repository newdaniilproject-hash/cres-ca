-- 0005_lock_event_trigger.sql
-- Закрываем публичный доступ к rls_auto_enable().
--
-- Эта функция создана НЕ нашими миграциями — она уже была в проекте
-- при первом подключении. Что делает: событийный триггер, который
-- автоматически включает RLS на любой новой таблице в схеме public.
-- Полезная страховка, оставляем.
--
-- Проблема не в ней самой, а в правах: Postgres по умолчанию выдаёт
-- EXECUTE роли PUBLIC, и анализатор справедливо отмечает, что функция
-- с SECURITY DEFINER торчит наружу как /rest/v1/rpc/rls_auto_enable.
-- Вызов извне бессмыслен (pg_event_trigger_ddl_commands() работает только
-- внутри событийного триггера и снаружи падает), но открытая точка входа
-- с правами владельца базы — это то, что закрывают заранее, а не после.
--
-- На работу самого триггера это не влияет: право на выполнение функции
-- триггера проверяется в момент создания триггера, а не при срабатывании.

do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
