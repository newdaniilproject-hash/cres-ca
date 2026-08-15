-- 0057 — удаление аккаунта не работало НИ РАЗУ с момента появления в 0024.
--
-- КАК НАШЛОСЬ. 15.08.2026 владелец попросил вычистить тестовые аккаунты перед
-- проверкой регистрации. Штатный вызов delete_my_account() упал:
--   42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
--   CONTEXT: PL/pgSQL function storage.protect_delete() … "delete from storage.objects"
--
-- ПРИЧИНА. Supabase защитил storage.objects от прямого удаления из SQL, и защита
-- эта — ТРИГГЕР УРОВНЯ ОПЕРАТОРА (protect_objects_delete, statement-level).
-- Он срабатывает на сам факт выполнения DELETE, независимо от того, попала ли
-- под условие хоть одна строка. Значит функция падала у КАЖДОГО пользователя,
-- и с файлами, и без них. На момент находки в хранилище 0 объектов — и всё равно
-- падало.
--
-- ЧЕМ ГРОЗИЛО. Это не косметика:
--   1. Apple App Store, правило 5.1.1(v): приложение, позволяющее завести
--      аккаунт, ОБЯЗАНО позволять его удалить. Ревью бы завернуло сборку.
--      Ровно ради этого правила функция и писалась в 0024.
--   2. «Данные клиента — его собственность» записано в условия сделки
--      с первым платящим клиентом. Право на удаление не исполнялось.
--   3. Дефект невидим до попытки: экран есть, кнопка есть, функция есть.
--      Очередное «готово» без единого исполнения.
--
-- ЧТО МЕНЯЕТСЯ. Из SQL файлы хранилища удалить нельзя в принципе — это решение
-- Supabase, и обходить его не нужно. Правильное разделение обязанностей:
-- файлы удаляет приложение через Storage API, базу чистит эта функция.
-- Чтобы разделение не превратилось в тихую утечку персональных данных
-- (аккаунт удалён, а документы человека остались лежать в бакете), функция
-- НЕ МОЛЧИТ: если файлы ещё на месте, она отказывается работать и прямо
-- говорит сколько их. Лучше внятный отказ, чем осиротевшие документы.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_files  bigint;
begin
  if v_uid is null then
    raise exception 'не автентифіковано';
  end if;

  -- Сначала пересчитываем файлы по всем заведениям, которые уйдут вместе
  -- с человеком. Разграничение — первым сегментом пути <tenant_id>/… (правило 1).
  select count(*) into v_files
    from storage.objects o
   where exists (
     select 1
       from public.tenant_members tm
      where tm.user_id = v_uid
        and tm.role = 'owner'
        and o.name like tm.tenant_id::text || '/%'
        and (select count(*) from public.tenant_members x
              where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1);

  if v_files > 0 then
    raise exception 'спочатку видаліть файли закладу через Storage API: залишилось %', v_files
      using hint = 'Видалення рядків storage.objects із SQL заборонене захистом Supabase (protect_objects_delete). Файли прибирає застосунок, базу — ця функція.';
  end if;

  -- true = только на текущую транзакцию. Это единственная законная лазейка
  -- в защите неизменяемых журналов, и она существует ровно ради удаления аккаунта.
  perform set_config('app.purging_account', 'on', true);

  for v_tenant in
    select tm.tenant_id
      from public.tenant_members tm
     where tm.user_id = v_uid
       and tm.role = 'owner'
       and (select count(*) from public.tenant_members x
             where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1
  loop
    delete from public.audit_log where tenant_id = v_tenant;
    delete from public.tenants where id = v_tenant;
  end loop;

  delete from public.audit_log where actor_id = v_uid;
  delete from public.tenant_members where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$function$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Помощник для экрана удаления: сколько файлов придётся убрать заранее.
-- Без него приложение узнаёт о проблеме только из текста исключения.
create or replace function public.my_account_files_count()
returns bigint
language sql
stable
security definer
set search_path to ''
as $function$
  select count(*)
    from storage.objects o
   where exists (
     select 1
       from public.tenant_members tm
      where tm.user_id = auth.uid()
        and tm.role = 'owner'
        and o.name like tm.tenant_id::text || '/%'
        and (select count(*) from public.tenant_members x
              where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1);
$function$;

revoke all on function public.my_account_files_count() from public;
grant execute on function public.my_account_files_count() to authenticated;

-- ЧТО ОСТАЁТСЯ СДЕЛАТЬ ВЫШЕ УРОВНЯ БАЗЫ. Экран «Видалити акаунт» обязан
-- перед вызовом delete_my_account() пройтись по бакетам media и documents
-- и удалить объекты арендатора через Storage API (supabase.storage.from(bucket)
-- .remove([...])). Иначе человек увидит отказ вместо удаления. Пока файлов
-- в проекте ноль, поэтому отказ не наступает — но наступит у первого же
-- клиента, загрузившего MSDS.
