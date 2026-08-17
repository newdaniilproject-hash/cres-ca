-- ===========================================================================
-- 0093. Шаг 7, пункт Г: доступ сотрудников платформы — по обращению, на срок,
--       с записью и с письмом владельцу.
-- ===========================================================================
--
-- ЧТО БЫЛО. is_platform_staff() читает один признак из токена и отдаёт доступ
-- БЕССРОЧНО, БЕЗ ПРИЧИНЫ И БЕЗ СЛЕДА. Проверено запросом: признак висит
-- ровно в трёх политиках — profiles_self_read, tenant_members_read,
-- tenants_read, — и этого достаточно, чтобы прочитать профили ВСЕХ людей
-- платформы (почта, телефон, имя, дата рождения), состав всех команд
-- и карточки всех заведений вместе с ИНН и юрназванием.
--
-- ЧЕМ ЭТО ОПАСНО. Ровно тем же, чем доступ инспектора без срока, который
-- уже закрыт в 0054: пока «сотрудник платформы» — это владелец продукта
-- в одном лице, признак кажется безобидным. Как только появится первый
-- помощник на поддержке, он получит вечный ключ от данных всех клиентов,
-- и ни один клиент об этом не узнает. Обещание «данные клиента — его
-- собственность» в этот момент перестаёт быть правдой.
--
-- ЧТО СТАЛО. Признак остаётся необходимым условием, но перестаёт быть
-- достаточным: нужен ещё действующий грант на конкретное заведение,
-- с причиной и сроком. Форма срока и хранение взяты из 0054 — там это уже
-- построено и проверено для инспектора; второй способ делать то же самое
-- в одном проекте не заводится.
--
-- ПОЧЕМУ ГРАНТ ВЫДАЁТСЯ СЕРВИСНЫМ КЛЮЧОМ, А НЕ ВЛАДЕЛЬЦЕМ ЗАВЕДЕНИЯ.
-- Обращение в поддержку приходит владельцу платформы, а не в базу клиента.
-- Просить клиента «нажмите кнопку выдачи доступа» — значит гарантированно
-- получить либо отказ, либо привычку нажимать не глядя. Клиент не выдаёт
-- доступ, но УЗНАЁТ о нём письмом и видит его в журнале — этого достаточно,
-- чтобы поймать злоупотребление.
--
-- ПОЧЕМУ ПОТОЛОК 30 ДНЕЙ. Разбор обращения занимает часы, а не месяцы.
-- Грант «до конца года» — это тот же вечный ключ, только с датой.
-- ===========================================================================

-- ── 1. Таблица ──────────────────────────────────────────────────────────────

create table if not exists public.platform_access_grants (
  id             uuid primary key default gen_random_uuid(),
  staff_user_id  uuid not null references auth.users(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  reason         text not null,
  granted_by     uuid references auth.users(id) on delete set null,
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  constraint platform_access_reason_len  check (length(btrim(reason)) >= 10),
  constraint platform_access_period      check (expires_at > granted_at),
  constraint platform_access_max_30_days check (expires_at <= granted_at + interval '30 days')
);

comment on table public.platform_access_grants is
  'Доступ сотрудника платформы к данным заведения: кому, к какому, почему, до какого времени. Без действующей строки признак is_staff не даёт ничего.';
comment on column public.platform_access_grants.reason is
  'Причина обращения человеческим текстом. Уходит владельцу заведения письмом, поэтому «тех. работы» здесь не годится.';

create index if not exists platform_access_grants_active_idx
  on public.platform_access_grants (staff_user_id, tenant_id, expires_at)
  where revoked_at is null;

-- ── 2. Неизменяемость: грант можно только отозвать ──────────────────────────
--
-- Иначе выданный на час грант правится на год той же рукой, и запись
-- перестаёт быть доказательством.

create or replace function public.platform_access_guard()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
      return old;
    end if;
    raise exception 'виданий доступ не видаляється — його відкликають';
  end if;

  if new.staff_user_id is distinct from old.staff_user_id
     or new.tenant_id  is distinct from old.tenant_id
     or new.reason     is distinct from old.reason
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'у виданому доступі можна змінити тільки відкликання';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'доступ уже відкликано';
  end if;

  return new;
end;
$fn$;

drop trigger if exists platform_access_guard on public.platform_access_grants;
create trigger platform_access_guard
  before update or delete on public.platform_access_grants
  for each row execute function public.platform_access_guard();

-- ── 3. Проверка доступа ─────────────────────────────────────────────────────
--
-- definer, потому что читает таблицу, на которой стоит RLS. Правило 3
-- («политика не ходит в таблицы») здесь соблюдено ровно так же, как в 0054:
-- в политиках стоит вызов функции, а не подзапрос к таблице, и функция
-- отсекает по разобранному токену прежде, чем что-то читать.

create or replace function public.has_platform_access(p_tenant uuid default null)
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  select public.is_platform_staff()
     and exists (
       select 1
         from public.platform_access_grants g
        where g.staff_user_id = auth.uid()
          and g.revoked_at is null
          and g.expires_at > now()
          and (p_tenant is null or g.tenant_id = p_tenant));
$fn$;

comment on function public.has_platform_access(uuid) is
  'Сотрудник платформы плюс действующий грант. Без гранта признак is_staff не открывает ничего.';

-- ── 4. Политики: признак заменяется на признак + грант ──────────────────────
--
-- Ветки обычного пользователя не тронуты ни в одной из трёх политик:
-- владелец и сотрудник заведения продолжают видеть ровно то же, что видели.

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.has_platform_access(null)));

drop policy if exists tenant_members_read on public.tenant_members;
create policy tenant_members_read on public.tenant_members
  for select to authenticated
  using (tenant_id in (select public.my_tenants())
         or (select public.has_platform_access(tenant_members.tenant_id)));

drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants
  for select to authenticated
  using ((status = 'active'::public.tenant_status and storefront_enabled)
         or id in (select public.my_tenants())
         or (select public.has_platform_access(tenants.id)));

-- ── 5. Кто видит сами гранты ────────────────────────────────────────────────
--
-- Владелец заведения — свои: иначе письмо не с чем сверить.
-- Сотрудник платформы — выданные ему: иначе он не знает, что уже истекло.
-- Выдаёт и отзывает только сервисный ключ: политик на insert и update нет,
-- и это не упущение, а решение — см. шапку.

alter table public.platform_access_grants enable row level security;

drop policy if exists platform_access_read on public.platform_access_grants;
create policy platform_access_read on public.platform_access_grants
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read'))
         or staff_user_id = (select auth.uid()));

-- ── 6. Письмо владельцу заведения ───────────────────────────────────────────

insert into public.notification_templates (tenant_id, event, channel, locale, subject, body, is_active)
values (null, 'platform.access_granted', 'email', 'uk',
        'Співробітник платформи отримав доступ до ваших даних',
        E'Доступ відкрито: {{granted_at}}\nДіє до: {{expires_at}}\nПричина звернення: {{reason}}\n\nЯкщо ви не зверталися до підтримки — напишіть нам одразу, доступ буде відкликано.',
        true)
on conflict do nothing;

create or replace function public.platform_access_notify()
returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  perform public.enqueue_staff_alert(
    new.tenant_id,
    'platform.access_granted',
    'platform-access:' || new.id::text,
    jsonb_build_object(
      'granted_at', to_char(new.granted_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI'),
      'expires_at', to_char(new.expires_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI'),
      'reason',     new.reason),
    'settings.read',
    'platform_access_grants',
    new.id);
  return null;
end;
$fn$;

drop trigger if exists platform_access_notify on public.platform_access_grants;
create trigger platform_access_notify
  after insert on public.platform_access_grants
  for each row execute function public.platform_access_notify();

comment on function public.platform_access_notify() is
  'Владелец заведения узнаёт о доступе сотрудника платформы письмом. Без этого любая наша поддержка выглядит как несанкционированный доступ.';

-- ── 7. Права ────────────────────────────────────────────────────────────────

revoke all on public.platform_access_grants from public;
revoke all on public.platform_access_grants from anon;
grant select on public.platform_access_grants to authenticated;

revoke all on function public.has_platform_access(uuid) from public;
revoke all on function public.has_platform_access(uuid) from anon;
grant execute on function public.has_platform_access(uuid) to authenticated;

revoke all on function public.platform_access_guard() from public;
revoke all on function public.platform_access_notify() from public;
