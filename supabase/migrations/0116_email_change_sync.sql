-- 0116. Смена почты доводится до конца: profiles.email синхронизируется.
--
-- ── В чём была дыра ─────────────────────────────────────────────────────────
--
-- Найдено аудитом юзер-потоков 19.08.2026. Экран смены почты существует
-- (кабинет и /account/security), тексты честно обещают «листи пішли на
-- стару і нову адресу» — но после подтверждения обеих ссылок GoTrue
-- обновляет ТОЛЬКО auth.users.email. Триггер синхронизации стоял лишь
-- `after insert` (0001): profiles.email оставался старым НАВСЕГДА.
--
-- А profiles.email — рабочее поле, по нему живут: сверка приглашений
-- (0050), доступ инспектора (0054), сторож команды (0081), журнал
-- аудита (0021), письма покупателю (0028). После смены почты всё это
-- продолжало работать по СТАРОМУ адресу — молча.
--
-- ── Что делает ──────────────────────────────────────────────────────────────
--
-- 1. `after update of email on auth.users` → копия в profiles. Definer:
--    триггер срабатывает под ролью GoTrue, у которой прав на public нет.
-- 2. Прямая правка `profiles.email` из кабинета ЗАКРЫВАЕТСЯ сторожем:
--    почта меняется только через процедуру GoTrue с подтверждением обеих
--    сторон — UPDATE в обход неё рассинхронизировал бы вход и профиль.
--    Дописано в существующий profiles_guard (0109): тело действующей
--    функции прочитано, ветка is_staff перенесена дословно.

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

revoke execute on function public.handle_user_email_change() from public;
revoke execute on function public.handle_user_email_change() from anon;
revoke execute on function public.handle_user_email_change() from authenticated;

-- Сторож профиля: is_staff (0109) + почта (эта миграция).
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if new.is_staff is distinct from old.is_staff
     and current_user in ('authenticated', 'anon') then
    raise exception 'ознака співробітника платформи не змінюється з кабінету';
  end if;
  -- Почта профиля — копия auth.users.email и меняется только процедурой
  -- GoTrue (подтверждение на обеих адресах). Прямой UPDATE рассинхронизировал
  -- бы вход и профиль: входишь по одной почте, письма едут на другую.
  if new.email is distinct from old.email
     and current_user in ('authenticated', 'anon') then
    raise exception 'пошта змінюється через підтвердження, а не прямою правкою';
  end if;
  return new;
end $fn$;

revoke execute on function public.profiles_guard() from public;
revoke execute on function public.profiles_guard() from anon;
revoke execute on function public.profiles_guard() from authenticated;
grant  execute on function public.profiles_guard() to service_role;
