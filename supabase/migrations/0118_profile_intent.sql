-- 0118. Признак «кем зарегистрировался»: покупатель или продавец.
--
-- ── В чём была дыра ─────────────────────────────────────────────────────────
--
-- Найдено 19.08.2026 при разборе клиентского сценария. Регистрация
-- покупателя существует отдельным экраном (`/register`), покупательский
-- кабинет существует (`/account`), связи в базе есть (orders.buyer_user_id,
-- bookings.buyer_user_id, customers.user_id) — а приземление после входа
-- у всех одно: `lib/where.ts` при отсутствии членства вёл на создание
-- заклада. То есть человек, зарегистрировавшийся покупателем, при
-- следующем входе видел «створіть заклад», а свой кабинет мог открыть
-- только по прямой ссылке.
--
-- Починить это в коде было НЕЧЕМ: признака «я покупатель» у профиля
-- не существовало ни в каком виде. Различать по наличию заказов нельзя —
-- у только что зарегистрировавшегося их ноль, и он неотличим от продавца,
-- бросившего онбординг на шаге заклада.
--
-- ── Почему колонка, а не «нет членства → в кабинет покупателя» ──────────────
--
-- Потому что продавец, прервавший регистрацию на шаге заклада, — это
-- ровно то же состояние: сессия есть, членства нет. Без признака он
-- при возврате попадал бы в покупательский кабинет вместо продолжения
-- своего онбординга, и платящий клиент терял бы путь на пустом месте.
--
-- ── Почему признак НЕ меняется после регистрации ────────────────────────────
--
-- Он отвечает ровно на один вопрос: куда вести того, у кого ЕЩЁ НЕТ
-- заклада. Как только заклад появился, членство отвечает на этот вопрос
-- само, и признак перестаёт читаться вовсе. Покупатель, решивший завести
-- заклад, проходит `/register/seller` уже с сессией и получает членство —
-- переписывать признак не нужно, а возможность его переписать означала бы
-- вторую ось «кто я», расходящуюся с членством.

alter table public.profiles add column if not exists intent text;

-- Существующим строкам — 'seller', и это не умолчание, а сохранение
-- поведения: до сегодняшнего дня приземление у всех было одно, на
-- создание заклада. Проставить им 'buyer' значило бы увести из
-- незаконченного онбординга людей, которые в нём стоят.
update public.profiles set intent = 'seller' where intent is null;

alter table public.profiles alter column intent set default 'buyer';
alter table public.profiles alter column intent set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and conname = 'profiles_intent_chk'
  ) then
    alter table public.profiles
      add constraint profiles_intent_chk check (intent in ('buyer', 'seller'));
  end if;
end $$;

comment on column public.profiles.intent is
  'Кем человек зарегистрировался: buyer или seller. Читается ТОЛЬКО пока '
  'у него нет ни одного членства — дальше на вопрос «куда вести» отвечает '
  'членство. Ставится один раз триггером handle_new_user из метаданных '
  'регистрации, из кабинета не меняется (profiles_guard).';

-- ── handle_new_user: кладём признак из метаданных ───────────────────────────
--
-- Тело действующей функции (0026) прочитано и перенесено целиком:
-- `create or replace` стирает его без остатка, и ветка согласий здесь
-- не «не тронута», а переписана дословно. Это правило проекта, оплаченное
-- 0076, которая унесла из сторожа 0052 проверку ранга ролей.
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
  -- Незнакомое значение не роняет регистрацию, а становится 'buyer':
  -- потерять аккаунт из-за поля маршрутизации — худший из исходов,
  -- ровно как с датой рождения ниже.
  v_intent text := lower(coalesce(nullif(btrim(coalesce(new.raw_user_meta_data->>'intent', '')), ''), 'buyer'));
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

  if v_intent not in ('buyer', 'seller') then
    v_intent := 'buyer';
  end if;

  insert into public.profiles (id, email, full_name, first_name, last_name, phone, birth_date, intent)
  values (
    new.id,
    new.email,
    coalesce(v_full, nullif(btrim(concat_ws(' ', v_first, v_last)), '')),
    v_first,
    v_last,
    v_phone,
    v_birth,
    v_intent
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

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;

-- ── Сторож профиля: is_staff (0109) + почта (0116) + признак (эта) ──────────
--
-- Тело 0116 прочитано и перенесено дословно, включая обе прежние ветки.
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
  -- Признак регистрации ставится один раз и дальше не читается вовсе,
  -- как только появилось членство. Правка из кабинета завела бы вторую
  -- ось «кто я» рядом с членством — а две оси всегда разъезжаются.
  if new.intent is distinct from old.intent
     and current_user in ('authenticated', 'anon') then
    raise exception 'ознака реєстрації не змінюється';
  end if;
  return new;
end $fn$;

revoke execute on function public.profiles_guard() from public;
revoke execute on function public.profiles_guard() from anon;
revoke execute on function public.profiles_guard() from authenticated;
grant  execute on function public.profiles_guard() to service_role;
