-- 0055 — исправление собственной ошибки в 0050–0054.
--
-- ЧТО НЕ ТАК. Во всех четырёх миграциях после каждой функции стояло
-- `revoke all on function ... from public` + явный grant — как требует правило.
-- Проверка показала, что это не сработало: у всех новых функций в proacl стоят
-- anon=X/postgres, authenticated=X/postgres, service_role=X/postgres. Причина —
-- ALTER DEFAULT PRIVILEGES самой Supabase: на КАЖДУЮ новую функцию в public она
-- явно выдаёт EXECUTE ролям anon, authenticated и service_role. Это ЯВНЫЕ записи
-- ACL, а не PUBLIC, поэтому `revoke ... from public` их не снимает. Отзывать
-- нужно поимённо.
--
-- НАСКОЛЬКО БЫЛО ПЛОХО. Утечки данных не было: create_invitation, accept_invitation,
-- revoke_invitation, block_staff, unblock_staff, transfer_ownership первым делом
-- проверяют auth.uid() is null и падают, а у неавторизованного запроса uid всегда
-- null. То есть anon получал отказ, а не доступ. Но право на вызов у него было, и
-- это ровно то, что правило 5 запрещает. Чинится здесь.
--
-- ЧТО ДЕЛАЕМ.
--   * У anon отзывается EXECUTE на все функции доступа из 0050–0054.
--   * У триггерных функций tenant_members_guard и staff_no_delete EXECUTE
--     отзывается вообще у всех прикладных ролей: их вызывает только сам движок
--     триггеров, от имени владельца отношения, и ACL на это не влияет.
--     ПРОВЕРЕНО: после отзыва прав удаление staff по-прежнему отбивается
--     триггером, то есть триггеры продолжают срабатывать.
--   * member_access_ok сохраняет grant supabase_auth_admin — это роль, под которой
--     GoTrue дёргает custom_access_token_hook.
--
-- НЕ ТРОГАЕМ ничего чужого: правки касаются только объектов, созданных в 0050–0054.

revoke execute on function public.create_invitation(uuid, text, public.member_role, jsonb, int) from anon;
revoke execute on function public.accept_invitation(text) from anon;
revoke execute on function public.revoke_invitation(uuid) from anon;
revoke execute on function public.invitation_state(uuid) from anon;
revoke execute on function public.role_rank(public.member_role) from anon;
revoke execute on function public.block_staff(uuid, text) from anon;
revoke execute on function public.unblock_staff(uuid) from anon;
revoke execute on function public.transfer_ownership(uuid, uuid) from anon;
revoke execute on function public.assert_not_last_owner(uuid, uuid, text) from anon;
revoke execute on function public.member_access_ok(uuid, uuid) from anon;
revoke execute on function public.tenant_members_guard() from anon, authenticated, service_role;
revoke execute on function public.staff_no_delete() from anon, authenticated, service_role;
