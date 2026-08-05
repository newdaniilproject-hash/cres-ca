-- 0026 — кто человек и на что он согласился.
--
-- Зачем: регистрация продавца спрашивает имя, фамилию, телефон и дату
-- рождения, а в profiles до сих пор было одно поле full_name. Сшивать
-- имя и фамилию в одну строку и потом разбирать по пробелу — способ
-- получить «Анна Марія Петренко-Коваль» в фамилии.
--
-- И вторая, более важная часть: согласие на обработку данных с журналом.
-- Оно записано в DOMAIN.md в списке «что платформа обязана уметь
-- с первого дня» и не было сделано вовсе. Галочка в форме без записи
-- о том, КОГДА и на КАКУЮ ВЕРСИЮ документа человек согласился, —
-- это не согласие, а картинка. Здесь появляется журнал.

-- ── 1. Личность ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists birth_date date;

-- Дата рождения из будущего или из XIX века — это опечатка, а не данные.
-- Проверка в базе, а не только в форме: форма — не граница доверия.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_birth_date_sane'
  ) then
    alter table public.profiles
      add constraint profiles_birth_date_sane
      check (birth_date is null or (birth_date > date '1900-01-01' and birth_date < current_date));
  end if;
end $$;

-- ── 2. Журнал согласий ─────────────────────────────────────────
-- Строка неизменяема по устройству: политик update и delete нет вовсе.
-- Согласие — это факт на дату, а не текущее состояние. Новая редакция
-- документа даёт новую строку; старая остаётся доказательством того,
-- на что человек соглашался тогда.
create table if not exists public.user_consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy', 'cookies')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  source      text not null default 'web' check (source in ('web', 'ios', 'android'))
);

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, document, accepted_at desc);

alter table public.user_consents enable row level security;

drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents
  for select using (user_id = (select auth.uid()));

drop policy if exists user_consents_insert_own on public.user_consents;
create policy user_consents_insert_own on public.user_consents
  for insert with check (user_id = (select auth.uid()));

-- Никаких update/delete: журнал. Правило проекта — «санитарные журналы
-- защищены дважды», здесь достаточно отсутствия политик, потому что
-- сервисный ключ к этой таблице не ходит.

-- ── 3. Заполнение при регистрации ──────────────────────────────
-- Метаданные приходят из options.data при signUp. Функция терпима
-- к их отсутствию: вход через Google даёт только full_name, и это
-- нормально.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := nullif(btrim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_last  text := nullif(btrim(coalesce(new.raw_user_meta_data->>'last_name',  '')), '');
  v_full  text := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name',  '')), '');
  v_phone text := nullif(btrim(coalesce(new.raw_user_meta_data->>'phone',      '')), '');
  v_birth date;
  v_terms text := nullif(btrim(coalesce(new.raw_user_meta_data->>'terms_version', '')), '');
  v_src   text := coalesce(nullif(new.raw_user_meta_data->>'signup_source', ''), 'web');
  d text;
begin
  -- Дата приходит строкой из формы. Кривую строку не роняем в исключение:
  -- потерять регистрацию из-за поля «дата рождения» — худший из исходов.
  begin
    v_birth := (nullif(btrim(coalesce(new.raw_user_meta_data->>'birth_date', '')), ''))::date;
  exception when others then
    v_birth := null;
  end;
  if v_birth is not null and (v_birth <= date '1900-01-01' or v_birth >= current_date) then
    v_birth := null;
  end if;

  insert into public.profiles (id, email, full_name, first_name, last_name, phone, birth_date)
  values (
    new.id,
    new.email,
    coalesce(v_full, nullif(btrim(concat_ws(' ', v_first, v_last)), '')),
    v_first,
    v_last,
    v_phone,
    v_birth
  )
  on conflict (id) do nothing;

  -- Галочка в форме = три согласия одной строкой. Пишем их отдельно:
  -- отозвать cookie-согласие можно, не отзывая оферту.
  if v_terms is not null then
    if v_src not in ('web', 'ios', 'android') then
      v_src := 'web';
    end if;
    foreach d in array array['terms', 'privacy', 'cookies'] loop
      insert into public.user_consents (user_id, document, version, source)
      values (new.id, d, v_terms, v_src);
    end loop;
  end if;

  return new;
end;
$$;

-- Postgres выдаёт EXECUTE роли PUBLIC на каждую новую функцию.
-- Правило проекта: каждая функция в миграции заканчивается явным
-- revoke/grant. Триггерную функцию не должен вызывать никто.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;
