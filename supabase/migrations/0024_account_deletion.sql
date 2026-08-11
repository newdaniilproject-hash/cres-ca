-- 0024_account_deletion.sql
-- Восстановлено из боевой базы 11.08.2026 — файла не было в репозитории,
-- хотя миграция применена (version 20260805041730). См. КОНСПЕКТЫ.md
-- о необходимости сверки git с продом перед следующей миграцией.
--
-- Правило Apple 5.1.1(v): приложение с регистрацией обязано давать удалить
-- аккаунт ИЗНУТРИ, иначе ревью разворачивает. Страница /privacy/delete есть,
-- а самого удаления не было.
--
-- Механика: удаляет ровно свой аккаунт (auth.uid()), заведения — только те,
-- где он единственный владелец. Иначе остался бы магазин без хозяина,
-- к данным которого не имеет доступа никто.
--
-- Неизменяемые журналы (санитарные, финансы, техкарты, применённые
-- документы) защищены триггерами, и каскад от tenants об них спотыкался бы.
-- Даём триггерам ровно одну лазейку: транзакционный флаг app.purging_account,
-- который выставляет только delete_my_account. Снаружи он недостижим —
-- PostgREST не даёт вызвать set_config, а RLS всё равно не разрешает
-- authenticated удалять эти строки напрямую.

create or replace function public.journal_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.purging_account', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'запись санитарного журнала неизменяема — ошибка исправляется новой записью';
end;
$$;

create or replace function public.finance_records_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.purging_account', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'финансовая запись не удаляется — ошибка исправляется встречной записью';
  end if;
  if new.amount is distinct from old.amount
     or new.kind is distinct from old.kind
     or new.order_id is distinct from old.order_id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by then
    raise exception 'сумма, вид и принадлежность записи не правятся — только заметка и категория';
  end if;
  return new;
end;
$$;

create or replace function public.tech_cards_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.purging_account', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'техкарта не удаляется: снимите флаг is_active';
  end if;
  if new.steps is distinct from old.steps
     or new.title is distinct from old.title
     or new.version is distinct from old.version then
    raise exception 'утверждённая версия техкарты неизменна — заведите следующую версию';
  end if;
  return new;
end;
$$;

create or replace function public.guard_applied_document()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if coalesce(current_setting('app.purging_account', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  if tg_table_name = 'stock_receipt_lines' then
    select status into v_status from public.stock_receipts
     where id = coalesce(new.receipt_id, old.receipt_id);
  elsif tg_table_name = 'stock_count_lines' then
    select status into v_status from public.stock_counts
     where id = coalesce(new.count_id, old.count_id);
  end if;
  if v_status = 'applied' then
    raise exception 'документ уже применён — правки задним числом запрещены';
  end if;
  return coalesce(new, old);
end;
$$;

-- Заодно: у audit_log_guard не было SET search_path — на это ругался
-- линтер безопасности Supabase.
create or replace function public.audit_log_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.purging_account', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'журнал дій не редагується і не видаляється';
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'не автентифіковано';
  end if;

  -- true = только на текущую транзакцию.
  perform set_config('app.purging_account', 'on', true);

  for v_tenant in
    select tm.tenant_id
      from public.tenant_members tm
     where tm.user_id = v_uid
       and tm.role = 'owner'
       and (select count(*) from public.tenant_members x
             where x.tenant_id = tm.tenant_id and x.role = 'owner') = 1
  loop
    -- Файлы: строки в реестре хранилища уходят вместе с заведением,
    -- разграничение — первым сегментом пути <tenant_id>/...
    delete from storage.objects where name like v_tenant::text || '/%';
    delete from public.audit_log where tenant_id = v_tenant;
    delete from public.tenants where id = v_tenant;
  end loop;

  delete from public.audit_log where actor_id = v_uid;
  delete from public.tenant_members where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant  execute on function public.delete_my_account() to authenticated;
