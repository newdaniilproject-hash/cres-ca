-- ===========================================================================
-- 0076. Журнал изменения прав, активные сеансы и защита от самоблокировки
--       Шаг 4 плана, пункты Б (журнал), В (защита), Г (сеансы)
-- ===========================================================================
--
-- ── Что здесь НЕ делается ────────────────────────────────────────────────
--
-- Нет `staff_kind` и модели автономных мастеров — это шаг 21, и трогать
-- его здесь запрещено планом прямо. Нет столбцового ограничения телефонов,
-- шаблонов прав и потолка скидки — это следующая миграция: правило
-- «один модуль за раз» важнее желания закрыть шаг одним файлом.
--
-- ── А. ПОЧЕМУ ЖУРНАЛ ПИШЕТ ТРИГГЕР, А НЕ ПРИЛОЖЕНИЕ ──────────────────────
--
-- Права меняются обычным UPDATE по `tenant_members` через политики RLS —
-- отдельной функции для этого нет и заводить её незачем. Значит любой
-- журнал, который ведёт приложение, пропустит изменение, сделанное мимо
-- приложения: из панели Supabase, из скрипта, из будущего экрана, который
-- забудут дописать. Триггер не пропустит ничего.
--
-- Журнал НЕИЗМЕНЯЕМЫЙ, как санитарные: ни политики UPDATE/DELETE, ни права.
-- Запись о том, что кто-то выдал себе права, ценна ровно до тех пор, пока
-- её нельзя стереть.
--
-- ── Б. ПОЧЕМУ НЕТ ТАБЛИЦЫ staff_sessions ────────────────────────────────
--
-- План называет её новой таблицей. Здесь её НЕТ, и это осознанный отход.
--
-- Сеансы уже существуют — в `auth.sessions`, и это единственный источник
-- правды: именно по ним Supabase решает, пускать человека или нет. Своя
-- таблица была бы ВТОРОЙ копией того же, и она неминуемо разъедется:
-- сеанс истёк сам, человек вышел с телефона, платформа почистила своё —
-- наша копия об этом не узнает. Список «активных» сеансов, где половина
-- мертва, хуже отсутствующего: по нему принимают решение «выгнать».
--
-- Поэтому вместо таблицы — функция `team_sessions()`, читающая
-- `auth.sessions` напрямую и отдающая только сеансы сотрудников своего
-- заведения. Город по адресу НЕ ВЫДУМЫВАЕТСЯ: отдаётся сам адрес, а
-- определение города — задача экрана и внешнего справочника, и пока его
-- нет, честнее показать адрес, чем угадать город.
--
-- ── В. ЗАЩИТА ОТ САМОБЛОКИРОВКИ ─────────────────────────────────────────
--
-- Ломается у всех, поэтому проверяется в базе, а не на экране:
--   • владелец не понижает сам себя — сначала передай владение;
--   • последнего владельца нельзя лишить владения (уже есть
--     `assert_not_last_owner`, переиспользуется, а не переписывается);
--   • никто, кроме самого владельца, не меняет права владельца;
--   • никто не расширяет права сам себе.
--
-- ── Г. СЕАНСЫ ЗАВЕРШАЮТСЯ ПРИ СМЕНЕ ПРАВ ────────────────────────────────
--
-- `block_staff` уже удаляет сеансы (0043). Но смена роли и урезание прав
-- этого не делали: понижённый сотрудник продолжал работать со старым
-- токеном до его истечения, потому что права живут В ТОКЕНЕ (правило 3).
-- Теперь любое изменение роли или разрешений завершает сеансы человека,
-- и следующий вход выдаёт токен с новыми правами.
-- ===========================================================================

-- ── 1. Журнал изменения прав ──────────────────────────────────────────────

create table if not exists public.permission_audit (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  actor        uuid,                       -- кто изменил; null = система
  target       uuid not null,              -- кому изменили
  action       text not null check (action in ('added','changed','removed')),
  role_before   public.member_role,
  role_after    public.member_role,
  perms_before  jsonb,
  perms_after   jsonb,
  at           timestamptz not null default now()
);

create index if not exists permission_audit_tenant_idx on public.permission_audit (tenant_id, at desc);
create index if not exists permission_audit_target_idx on public.permission_audit (target);

alter table public.permission_audit enable row level security;

-- Читают те, кто вправе видеть команду. Пишет только триггер.
drop policy if exists permission_audit_read on public.permission_audit;
create policy permission_audit_read on public.permission_audit
  for select using (tenant_id in (select public.tenants_with('team.read')));

-- Политик insert/update/delete НЕТ намеренно: запись делает функция
-- триггера с правами владельца, обходя RLS. Ни один пользователь не может
-- ни дописать строку от чужого имени, ни стереть свою.

-- ⚠️ ПЯТЫЙ РАЗ ОДНО И ТО ЖЕ. Проверено сразу после применения на бою:
-- новая таблица получила SELECT для `anon` и INSERT для `authenticated`,
-- которых никто не выдавал. Это `alter default privileges` в облаке
-- Supabase — он живёт только там, и на стенде ловится не тестом,
-- а `scripts/check-grants.sh`, который смотрит на прод.
--
-- Утечки в этот раз не было: чтение отсекает политика, вставку — её
-- отсутствие. Но право, которого никто не выдавал, — это заряженное
-- ружьё: достаточно однажды добавить политику insert «для удобства»,
-- и журнал станет дописываемым снаружи.
--
-- Корень зла — тумблер «Automatically expose new tables» в Data API.
-- Пока он включён, ЛЮБАЯ новая таблица получает эти права. Выключать
-- его — отдельное решение: тогда каждая будущая миграция обязана
-- выдавать права явно, иначе экраны молча перестанут читать данные.
revoke all on table public.permission_audit from anon, authenticated;
grant select on table public.permission_audit to authenticated;

create or replace function public.permission_audit_immutable()
returns trigger language plpgsql as $fn$
begin
  raise exception 'журнал прав незмінний: % заборонено', tg_op;
end $fn$;

revoke all on function public.permission_audit_immutable() from public, anon, authenticated;

drop trigger if exists permission_audit_no_change on public.permission_audit;
create trigger permission_audit_no_change
  before update or delete on public.permission_audit
  for each row execute function public.permission_audit_immutable();

-- ── 2. Защита от самоблокировки ───────────────────────────────────────────

create or replace function public.tenant_members_guard()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_actor uuid := auth.uid();
begin
  -- Изменения без вошедшего пользователя — это миграции и фоновые задачи.
  -- Им запреты этого триггера не адресованы: он про людей.
  if v_actor is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    -- Владелец не понижает сам себя. Иначе заведение остаётся без хозяина
    -- одним неверным нажатием, а вернуть некому.
    if old.role = 'owner' and old.user_id = v_actor and new.role <> 'owner' then
      raise exception 'власник не може понизити себе сам — спершу передайте володіння';
    end if;

    -- Права владельца меняет только он сам. Администратор с team.write
    -- иначе получает возможность понизить того, кто его назначил.
    if old.role = 'owner' and old.user_id <> v_actor then
      raise exception 'права власника може змінювати лише він сам';
    end if;

    -- Никто не расширяет права сам себе. Смена своей роли или своих
    -- разрешений — это ровно тот путь, которым обычный сотрудник
    -- становится администратором.
    if old.user_id = v_actor and (old.role <> new.role or old.permissions is distinct from new.permissions) then
      raise exception 'змінювати власні права не можна';
    end if;

    -- Последний владелец остаётся владельцем.
    if old.role = 'owner' and new.role <> 'owner' then
      perform public.assert_not_last_owner(old.tenant_id, old.user_id, 'змінити його роль не можна');
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      perform public.assert_not_last_owner(old.tenant_id, old.user_id, 'видалити його з команди не можна');
    end if;
    if old.user_id = v_actor and old.role = 'owner' then
      raise exception 'власник не може видалити сам себе з команди';
    end if;
  end if;

  return coalesce(new, old);
end $fn$;

revoke all on function public.tenant_members_guard() from public, anon, authenticated;

drop trigger if exists tenant_members_guard on public.tenant_members;
create trigger tenant_members_guard
  before update or delete on public.tenant_members
  for each row execute function public.tenant_members_guard();

-- ── 3. Журнал + завершение сеансов ────────────────────────────────────────

create or replace function public.tenant_members_audit()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_actor  uuid := auth.uid();
  v_target uuid;
  v_tenant uuid;
begin
  if tg_op = 'DELETE' then
    v_target := old.user_id; v_tenant := old.tenant_id;
    insert into public.permission_audit (tenant_id, actor, target, action, role_before, perms_before)
      values (v_tenant, v_actor, v_target, 'removed', old.role, old.permissions);
  elsif tg_op = 'INSERT' then
    v_target := new.user_id; v_tenant := new.tenant_id;
    insert into public.permission_audit (tenant_id, actor, target, action, role_after, perms_after)
      values (v_tenant, v_actor, v_target, 'added', new.role, new.permissions);
  else
    v_target := new.user_id; v_tenant := new.tenant_id;
    -- Пишем только когда изменилось то, ради чего журнал заведён.
    -- Строка «ничего не поменялось» засоряет журнал и прячет настоящие.
    if old.role is not distinct from new.role
       and old.permissions is not distinct from new.permissions then
      return new;
    end if;
    insert into public.permission_audit (tenant_id, actor, target, action,
                                         role_before, role_after, perms_before, perms_after)
      values (v_tenant, v_actor, v_target, 'changed',
              old.role, new.role, old.permissions, new.permissions);
  end if;

  -- ── Сеансы ──
  -- Права живут в токене, поэтому урезание прав без завершения сеансов
  -- вступает в силу только к концу жизни токена. Для увольнения это
  -- слишком долго. Удаление строк из auth.sessions обрывает обновление
  -- токена немедленно.
  --
  -- При добавлении в команду сеансы НЕ рвём: человек ничего не терял,
  -- а выкидывать его из приложения в момент, когда ему дали доступ, —
  -- это выглядит как поломка.
  if tg_op in ('UPDATE','DELETE') and v_target is not null then
    delete from auth.sessions s where s.user_id = v_target;
  end if;

  return coalesce(new, old);
end $fn$;

revoke all on function public.tenant_members_audit() from public, anon, authenticated;

drop trigger if exists tenant_members_audit on public.tenant_members;
create trigger tenant_members_audit
  after insert or update or delete on public.tenant_members
  for each row execute function public.tenant_members_audit();

-- ── 4. Активные сеансы команды ────────────────────────────────────────────

create or replace function public.team_sessions(p_tenant_id uuid)
returns table (
  user_id     uuid,
  staff_name  text,
  session_id  uuid,
  device      text,
  ip          text,
  started_at  timestamptz,
  last_seen   timestamptz
)
language sql security definer set search_path to '' as $fn$
  select s.user_id,
         st.name,
         s.id,
         s.user_agent,
         host(s.ip),
         s.created_at,
         coalesce(s.refreshed_at at time zone 'UTC', s.updated_at)
    from auth.sessions s
    join public.tenant_members m on m.user_id = s.user_id and m.tenant_id = p_tenant_id
    left join public.staff st     on st.user_id = s.user_id and st.tenant_id = p_tenant_id
   where p_tenant_id in (select public.tenants_with('team.read'))
     and (s.not_after is null or s.not_after > now())
   order by coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) desc;
$fn$;

revoke all on function public.team_sessions(uuid) from public, anon;
grant execute on function public.team_sessions(uuid) to authenticated;

-- ── 5. Принудительный выход ───────────────────────────────────────────────

create or replace function public.end_sessions(p_tenant_id uuid, p_user_id uuid default null)
returns integer language plpgsql security definer set search_path to '' as $fn$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  -- Выход по всему заведению НЕ трогает того, кто его нажал: иначе
  -- владелец выкидывает сам себя и не может войти обратно, чтобы
  -- посмотреть, что случилось. Свой сеанс закрывается кнопкой «вийти».
  delete from auth.sessions s
   where s.user_id in (
           select m.user_id from public.tenant_members m
            where m.tenant_id = p_tenant_id
              and (p_user_id is null or m.user_id = p_user_id))
     and s.user_id <> auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function public.end_sessions(uuid, uuid) from public, anon;
grant execute on function public.end_sessions(uuid, uuid) to authenticated;

comment on table public.permission_audit is
  'Неизменяемый журнал изменения прав. Пишется триггером на tenant_members, чтобы поймать и правки мимо приложения.';
comment on function public.team_sessions(uuid) is
  'Активные сеансы сотрудников заведения. Источник — auth.sessions; своей копии сеансов намеренно нет.';
