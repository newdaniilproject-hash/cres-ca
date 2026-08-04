-- 0008_trigger_function_grants.sql
-- Отбираем публичное право выполнения у триггерных функций 0006–0007.
--
-- Третий случай одной и той же болезни: Postgres выдаёт EXECUTE роли
-- PUBLIC на каждую новую функцию, и в 0006–0007 я снова не отобрал его
-- явно — у customers_stats_refresh, order_items_recalc и
-- orders_income_record. Вызвать триггерную функцию через RPC нельзя
-- (Postgres откажет без триггерного контекста), поэтому дырой это
-- не является — но правило «функция закрыта, если не открыта осознанно»
-- должно выполняться без исключений, иначе оно не правило.
--
-- Вывод на будущее записан в CLAUDE.md: каждая новая функция в миграции
-- заканчивается явным revoke/grant. Без исключений для «безобидных».

revoke execute on function public.customers_stats_refresh() from public, anon, authenticated;
revoke execute on function public.order_items_recalc()      from public, anon, authenticated;
revoke execute on function public.orders_income_record()    from public, anon, authenticated;

-- Заодно закрываем и не-definer триггерные функции ранних миграций:
-- через RPC они выполняются с правами вызывающего и упали бы сами,
-- но пусть правило будет единым для всех.
revoke execute on function public.touch_updated_at()        from public, anon, authenticated;
revoke execute on function public.guard_stock_columns()     from public, anon, authenticated;
revoke execute on function public.guard_applied_document()  from public, anon, authenticated;
revoke execute on function public.orders_guard()            from public, anon, authenticated;
revoke execute on function public.finance_records_guard()   from public, anon, authenticated;
