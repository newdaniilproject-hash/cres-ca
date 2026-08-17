-- ===========================================================================
-- 0094. Доделка шага 7: триггерные функции 0089 и 0093 висели на PostgREST.
-- ===========================================================================
--
-- КАК НАШЛОСЬ. Анализатором Supabase сразу после накатa 0093:
--   Function `public.platform_access_notify()` can be executed by the `anon`
--   role as a `SECURITY DEFINER` function via `/rest/v1/rpc/...`
--
-- ЧТО ПРОИЗОШЛО. `revoke all ... from public` в 0089 и 0093 недостаточно.
-- Supabase держит `alter default privileges` на схеме public и выдаёт
-- EXECUTE ролям anon и authenticated НА КАЖДУЮ НОВУЮ ФУНКЦИЮ отдельно
-- от PUBLIC. Ровно те же грабли уже ловились дважды: 0036 (тогда чинили
-- только anon) и 0061 (тогда выяснилось, что надо обе роли). Третий раз.
--
-- ЧЕМ ЭТО ГРОЗИЛО ИМЕННО ЗДЕСЬ. platform_access_notify — SECURITY DEFINER
-- и вызывалась бы по адресу /rest/v1/rpc/platform_access_notify кем угодно,
-- включая анонима. Триггерная функция без аргументов упала бы на обращении
-- к NEW, то есть утечки данных не было. Но право осталось бы висеть,
-- и следующая правка этой функции сделала бы его настоящей дырой.
--
-- ВЫВОД, КОТОРЫЙ СТОИТ ЗАПИСАТЬ В КОНСПЕКТЫ: у триггерной функции нет
-- ни одного законного вызывающего снаружи. Право на выполнение отбирается
-- у public, anon И authenticated — тремя строками, а не одной.
-- ===========================================================================

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.security_events_redact()',
    'public.notification_outbox_redact()',
    'public.platform_access_guard()',
    'public.platform_access_notify()'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon', v_fn);
    execute format('revoke all on function %s from authenticated', v_fn);
  end loop;
end $$;

-- Маскировщики остаются доступны authenticated намеренно: они не читают
-- ни одной таблицы, а только преобразуют переданную строку — то же
-- исключение, что у tenant_can и jwt_perms (правило 7). Аноним их
-- не получает: ему они не нужны ни в одном сценарии.
revoke all on function public.mask_phone(text) from anon;
revoke all on function public.mask_email(text) from anon;
revoke all on function public.mask_name(text) from anon;
revoke all on function public.mask_text_pii(text) from anon;
revoke all on function public.redact_pii(jsonb) from anon;
