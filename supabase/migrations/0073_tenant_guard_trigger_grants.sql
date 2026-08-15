-- ===========================================================================
-- 0073. Ещё шесть триггерных функций, доступных анониму
-- ===========================================================================
--
-- Найдено новой проверкой `scripts/check-grants.sh` СРАЗУ ПОСЛЕ 0072 —
-- в тот же час, тем же запросом, но по полному списку, а не по замечаниям
-- анализатора.
--
-- Почему их не было видно раньше. Анализатор Supabase отмечает функции
-- с признаком SECURITY DEFINER: у такой лишнее право опаснее, потому что
-- тело выполняется правами владельца. Эти шесть — обычные триггерные,
-- без DEFINER, и в его список не попали. А право EXECUTE у роли anon
-- у них при этом есть, и досталось оно тем же умолчанием Supabase.
--
-- То есть анализатор показывает не «все нарушения правила 7», а «нарушения,
-- которые он считает опасными». Правило 7 написано строже: явный revoke
-- нужен КАЖДОЙ функции, независимо от того, как её оценил чужой линтер.
-- Отсюда и собственная проверка со своим закрытым списком.
--
-- Практический риск: как и в 0072, близок к нулю — триггерную функцию,
-- вызванную напрямую, Postgres роняет. Но право, которое никто не выдавал
-- и никто не отзывал, живёт до первой ошибки в теле функции, и разбираться
-- в этом в день инцидента дороже, чем снять его сейчас.
--
-- Триггеры не пострадают: EXECUTE при срабатывании триггера не проверяется,
-- функция выполняется правами владельца таблицы.
-- ===========================================================================

revoke all on function public.material_batches_tenant_guard()    from public, anon, authenticated;
revoke all on function public.material_containers_tenant_guard() from public, anon, authenticated;
revoke all on function public.material_documents_tenant_guard()  from public, anon, authenticated;
revoke all on function public.material_barcodes_tenant_guard()   from public, anon, authenticated;
revoke all on function public.variant_materials_tenant_guard()   from public, anon, authenticated;
revoke all on function public.stock_receipt_lines_tenant_guard() from public, anon, authenticated;
