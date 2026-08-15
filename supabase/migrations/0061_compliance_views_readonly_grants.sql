-- 0061. Закрыть дыру, которую открыла 0060.
--
-- ЧТО СЛУЧИЛОСЬ. 0060 пересоздала представления через drop/create.
-- В Supabase на схеме public висит alter default privileges, отдающий
-- ВСЕ права ролям anon и authenticated на каждый новый объект. В 0036
-- это уже ловили, но там лечили только anon. После 0060 роль
-- authenticated получила на compliance_materials и compliance_batches
-- не select, а INSERT, UPDATE, DELETE, TRUNCATE.
--
-- ЧЕМ ЭТО ОПАСНО. Оба представления простые (одна таблица + where),
-- то есть Postgres считает их автообновляемыми. Права по умолчанию
-- у представления — права ВЛАДЕЛЬЦА, а не вызывающего: запись пошла бы
-- мимо RLS исходной таблицы. Инспектор, у которого по ТЗ только чтение,
-- мог бы через представление править реестр косметики и партии.
--
-- ЛЕЧЕНИЕ. Явный revoke ALL со ВСЕХ ролей и обратный grant только select.
-- Проверять после каждого пересоздания представления надо обе роли —
-- и anon (грабли 0036), и authenticated (грабли 0060).
--
-- Здесь же был включён security_invoker — и это оказалось ошибкой,
-- она снята в 0062. Причина разобрана там.

revoke all on public.compliance_materials  from anon, authenticated, public;
revoke all on public.compliance_batches    from anon, authenticated, public;
revoke all on public.compliance_containers from anon, authenticated, public;

grant select on public.compliance_materials  to authenticated;
grant select on public.compliance_batches    to authenticated;
grant select on public.compliance_containers to authenticated;
