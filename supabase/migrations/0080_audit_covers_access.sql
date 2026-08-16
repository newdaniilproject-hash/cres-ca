-- ===========================================================================
-- 0080. Журнал прав перестаёт врать, и его становится видно. Шаг 4, хвосты
-- ===========================================================================
--
-- ── ЧТО БЫЛО СЛОМАНО, И СЛОМАЛ ЭТО 0079 ─────────────────────────────────
--
-- Найдено сверкой обещания с кодом сразу после 0079, до жалобы. В CLAUDE.md
-- записано: «ни одно действие экрана команды не пишет мимо триггеров,
-- поэтому всё попадает в неизменяемый журнал и рвёт сеансы». Это было
-- неправдой ровно с той минуты, как 0079 положила признак блокировки
-- в `tenant_members`.
--
-- Триггер `tenant_members_audit` (0076) на UPDATE выходит РАНЬШЕ времени:
--
--     if old.role is not distinct from new.role
--        and old.permissions is not distinct from new.permissions then
--       return new;                       -- <— выход
--     end if;
--
-- Тогда в строке участника менялись только эти две вещи, и выход был верен.
-- Потом появились `access_expires_at` (0054), `discount_cap_pct` (0077)
-- и `blocked_at` (0079) — и каждая из них теперь проходит МИМО журнала.
-- Хуже: за этим выходом стоит удаление сеансов, поэтому
--
--   ⚠️ ЗАБЛОКИРОВАННЫЙ СОТРУДНИК ПРОДОЛЖАЛ РАБОТАТЬ. Блокировка снимала
--   доступ только на следующей выдаче токена, то есть примерно через час.
--   Для увольнения «через час» — это не блокировка.
--
-- То же с укорачиванием срока доступа: поставили инспектору «до вчера» —
-- он работает до истечения токена.
--
-- Урок, ради которого этот абзац написан: РАННИЙ ВЫХОД ПО СПИСКУ КОЛОНОК
-- СТАРЕЕТ МОЛЧА. Он не ломается при добавлении колонки — он просто
-- перестаёт покрывать то, что добавили, и никакой тест этого не увидит,
-- пока его не написать именно на новую колонку. Поэтому ниже список
-- колонок вынесен в одно место с прямым указанием: добавляешь колонку,
-- влияющую на доступ, — дописываешь сюда.
--
-- ── ЧТО ДОБАВЛЯЕТСЯ ─────────────────────────────────────────────────────
--
-- 1. `note` в журнале: у блокировки есть причина, и без неё запись
--    «заблокирован» не отвечает на единственный вопрос, который к ней
--    задают, — за что.
-- 2. Два новых вида события: `blocked` и `unblocked`. Не «changed»
--    с разбором полей: блокировка — это не правка настройки, и в списке
--    она обязана читаться с одного взгляда.
-- 3. `permission_audit_log()` — журнал с именами вместо uuid. Таблица
--    писалась и читалась политикой с 0076, но показать её было негде
--    и нечем: экран получил бы шестнадцатеричные идентификаторы.
-- ===========================================================================

-- ── 1. Причина и новые виды событий ───────────────────────────────────────

alter table public.permission_audit add column if not exists note text;

comment on column public.permission_audit.note is
  'Человеческое пояснение к записи: причина блокировки, что именно изменилось в сроке или стеле.';

alter table public.permission_audit drop constraint if exists permission_audit_action_check;
alter table public.permission_audit add constraint permission_audit_action_check
  check (action in ('added','changed','removed','blocked','unblocked'));

-- ── 2. Триггер journal + сеансы, покрывающий ВСЕ признаки доступа ─────────

create or replace function public.tenant_members_audit()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_actor  uuid := auth.uid();
  v_target uuid;
  v_tenant uuid;
  v_action text;
  v_note   text;
  -- Изменилось ли что-то, ВЛИЯЮЩЕЕ НА ДОСТУП. Список ниже — единственное
  -- место, где он перечислен.
  --
  -- ⚠️ ДОБАВЛЯЕШЬ КОЛОНКУ, КОТОРАЯ РЕШАЕТ, ЧТО ЧЕЛОВЕКУ МОЖНО, —
  -- ДОПИСЫВАЕШЬ ЕЁ СЮДА. Иначе изменение уйдёт мимо журнала и мимо
  -- разрыва сеансов, и обнаружится это в день разбирательства.
  v_access_changed boolean;
  v_any_changed    boolean;
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

    v_access_changed :=
          old.role              is distinct from new.role
       or old.permissions       is distinct from new.permissions
       or old.blocked_at        is distinct from new.blocked_at
       or old.access_expires_at is distinct from new.access_expires_at;

    -- Стеля знижки в токене НЕ живёт: `discount_cap()` читает таблицу
    -- на каждый вызов. Поэтому её правка попадает в журнал, но сеансы
    -- не рвёт — выкидывать человека из приложения ради числа, которое
    -- уже действует, незачем.
    v_any_changed := v_access_changed
       or old.discount_cap_pct is distinct from new.discount_cap_pct;

    if not v_any_changed then
      return new;
    end if;

    if old.blocked_at is null and new.blocked_at is not null then
      v_action := 'blocked';  v_note := new.blocked_reason;
    elsif old.blocked_at is not null and new.blocked_at is null then
      v_action := 'unblocked'; v_note := null;
    else
      v_action := 'changed';
      v_note := nullif(concat_ws('; ',
        case when old.access_expires_at is distinct from new.access_expires_at then
          case when new.access_expires_at is null then 'доступ безстроковий'
               else 'доступ до ' || to_char(new.access_expires_at, 'DD.MM.YYYY') end
        end,
        case when old.discount_cap_pct is distinct from new.discount_cap_pct then
          case when new.discount_cap_pct is null then 'стеля знижки — за роллю'
               else 'стеля знижки ' || new.discount_cap_pct || '%' end
        end), '');
    end if;

    insert into public.permission_audit (tenant_id, actor, target, action,
                                         role_before, role_after,
                                         perms_before, perms_after, note)
      values (v_tenant, v_actor, v_target, v_action,
              old.role, new.role, old.permissions, new.permissions, v_note);
  end if;

  -- ── Сеансы ──
  -- Права живут в токене, поэтому изменение, которого токен не знает,
  -- вступает в силу только к следующей его выдаче. Для блокировки это
  -- час работы уволенного человека. Удаление строк из auth.sessions
  -- обрывает обновление токена немедленно.
  --
  -- При добавлении в команду сеансы НЕ рвём: человек ничего не терял.
  -- При правке одной лишь стели знижки — тоже: она действует сразу.
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and coalesce(v_access_changed, false)) then
    delete from auth.sessions s where s.user_id = v_target;
  end if;

  return coalesce(new, old);
end $fn$;

revoke all on function public.tenant_members_audit() from public, anon, authenticated;

drop trigger if exists tenant_members_audit on public.tenant_members;
create trigger tenant_members_audit
  after insert or update or delete on public.tenant_members
  for each row execute function public.tenant_members_audit();

-- ── 3. Журнал с именами ───────────────────────────────────────────────────
--
-- SECURITY DEFINER: читает `profiles` чужих людей, как и `team_overview`.
-- Изоляцию проверяет собственный WHERE по `team.read`.
create or replace function public.permission_audit_log(p_tenant_id uuid, p_limit int default 200)
returns table (
  id           uuid,
  at           timestamptz,
  actor        uuid,
  actor_name   text,
  target       uuid,
  target_name  text,
  action       text,
  role_before  public.member_role,
  role_after   public.member_role,
  perms_added  text[],
  perms_removed text[],
  note         text
)
language sql stable security definer set search_path to '' as $fn$
  select a.id,
         a.at,
         a.actor,
         coalesce(pa.full_name, pa.email::text),
         a.target,
         coalesce(pt.full_name, pt.email::text),
         a.action,
         a.role_before,
         a.role_after,
         -- Разбор точечных дозволов делает БАЗА, а не экран: одно место,
         -- один ответ. Ключ со значением `false` — это снятое право,
         -- поэтому «добавлено» и «снято» считаются по значению, а не по
         -- наличию ключа.
         (select coalesce(array_agg(k order by k), '{}')
            from jsonb_each_text(coalesce(a.perms_after, '{}'::jsonb)) as n(k, v)
           where v = 'true'
             and coalesce(a.perms_before, '{}'::jsonb) ->> k is distinct from 'true'),
         (select coalesce(array_agg(k order by k), '{}')
            from jsonb_each_text(coalesce(a.perms_before, '{}'::jsonb)) as o(k, v)
           where v = 'true'
             and coalesce(a.perms_after, '{}'::jsonb) ->> k is distinct from 'true'),
         a.note
    from public.permission_audit a
    left join public.profiles pa on pa.id = a.actor
    left join public.profiles pt on pt.id = a.target
   where a.tenant_id = p_tenant_id
     and p_tenant_id in (select public.tenants_with('team.read'))
   order by a.at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$fn$;

revoke all on function public.permission_audit_log(uuid, int) from public, anon;
grant execute on function public.permission_audit_log(uuid, int) to authenticated;

comment on function public.permission_audit_log(uuid, int) is
  'Журнал изменения прав с именами и разобранной разницей точечных дозволов. SECURITY DEFINER — изоляцию проверяет собственный WHERE по team.read.';
