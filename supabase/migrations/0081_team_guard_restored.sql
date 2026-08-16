-- ===========================================================================
-- 0081. Сторож команды собран заново. Регресс 0076 и всё, что он открыл
-- ===========================================================================
--
-- ── ЧТО СЛУЧИЛОСЬ ────────────────────────────────────────────────────────
--
-- 0052 завела `tenant_members_guard()` с четырьмя обязанностями: ветка
-- INSERT с проверкой ранга, ветка DELETE с последним владельцем и две
-- законные лазейки — флаги `app.ownership_transfer` и `app.purging_account`.
-- 0076 переписала функцию через `create or replace`, добавила свои запреты
-- и НЕ ВЕРНУЛА ничего из перечисленного. `create or replace` не жалуется:
-- он молча заменяет тело целиком, и потеря половины обязанностей выглядит
-- как удачное применение миграции.
--
-- Цена этой потери:
--   • ветки INSERT нет вовсе — участник с `team.write` вписывал строку
--     с любой ролью, до владельца включительно (уникальный индекс из 0001
--     ловил только второго владельца, всё остальное проходило);
--   • `transfer_ownership()` мёртв: он ставит `app.ownership_transfer='on'`,
--     а сторож флага не читал и ронял первый же UPDATE с текстом
--     «власник не може понизити себе сам». Передать владение было нельзя;
--   • `delete_my_account()` мёртв дважды: ветка DELETE звала
--     `assert_not_last_owner`, а флаг `app.purging_account` не читался; плюс
--     `permission_audit_immutable()` (0076) вообще не знал про этот флаг,
--     хотя у санитарных журналов (0066, 0069) исключение по нему есть с
--     самого начала. Удаление аккаунта падало на журнале прав.
--
-- Урок на будущее, ради которого этот абзац: `create or replace function`
-- поверх чужой функции — это ПЕРЕПИСЫВАНИЕ, а не дополнение. Прежде чем
-- писать `or replace`, читается действующее тело целиком; если в нём есть
-- ветка, которую вы не собирались трогать, её надо перенести руками.
-- Тест на это ставится не на «функция существует», а на попытку сделать
-- то, что она запрещала.
--
-- ── ДВА ТРИГГЕРА НА ОДНОЙ ТАБЛИЦЕ ────────────────────────────────────────
--
-- 0052 создала `tenant_members_guard_trg`, 0076 дропнула ДРУГОЕ имя
-- (`tenant_members_guard`, которого не было) и создала своё. На бою жили
-- оба и оба звали одну функцию: каждая правка участника проходила сторожа
-- дважды. Само по себе это не дыра, но оно объясняет, почему регресс не
-- бросался в глаза: INSERT формально «сторожился» триггером 0052, только
-- сторожить в теле было уже нечем. Оставляем ОДИН триггер.
--
-- ── ЧТО ЕЩЁ ЗАКРЫВАЕТСЯ ЗДЕСЬ, И ПОЧЕМУ ОДНОЙ МИГРАЦИЕЙ ──────────────────
--
-- Это один модуль — «Команда» — и все дыры ниже растут из одного корня:
-- проверок ранга и принадлежности прав не было ни в одном из путей, каким
-- меняется доступ. Чинить их порознь значит оставить открытым обход через
-- соседний путь; правило «один модуль за раз» тут работает ЗА объединение,
-- а не против него.
--
--   4.  Ключ `*` в точечных дозволах. Хук выдачи токена кладёт в токен
--       ЛЮБОЙ ключ со значением true, а `tenant_can` понимает `"*"` как
--       «всё». То есть `permissions = '{"*": true}'` — это права владельца,
--       выданные обычным UPDATE. Запрещаем ключ ограничением на всех трёх
--       таблицах, куда он мог попасть, и добавляем общее правило: нельзя
--       выдать то, чего нет у тебя самого.
--   5.  У `authenticated` были INSERT и UPDATE прямо на `invitations`,
--       а `accept_invitation` брала роль и права ИЗ СТРОКИ, ничего не
--       перепроверяя. То есть приглашение себе с ролью `admin` выписывалось
--       одним INSERT. Права отбираем, роль проверяем на момент ПРИЁМА:
--       выписавший мог за эти 72 часа лишиться `team.write`.
--   6.  Заблокированный разблокировал себя сам: токен живёт до часа после
--       разрыва сеанса, и `team.write` в нём остаётся. Значит запрет обязан
--       стоять в базе. Сторож теперь запрещает любое РАСШИРЕНИЕ своего
--       доступа: снятие своей блокировки, отдаление своего срока, подъём
--       своей стели скидки.
--   7.  Через `staff` отбирали доступ у владельца: политики 0010 не
--       ограничивают колонки, а `member_access_ok` смотрела на
--       `staff.blocked_at`. Админ вписывал строку staff с user_id владельца
--       и `blocked_at = now()` — владелец терял вход и починить не мог.
--   10. Рассинхрон блокировок. Разбирается ниже отдельным абзацем.
--   11. `end_sessions` без ранга — вечный разлогин владельца.
--   12. `member_access_ok` была открыта `authenticated` и работала оракулом
--       «заблокирован ли этот человек в этом заведении». Клиентский код её
--       не зовёт (проверено поиском по .ts/.tsx), значит право лишнее.
--
-- ── ОДИН ИСТОЧНИК ПРАВДЫ О БЛОКИРОВКЕ (пункт 10) ─────────────────────────
--
-- Было два признака и три функции, которые их по-разному сочетали:
-- `block_member` ставила блокировку и в `tenant_members`, и в `staff`;
-- `unblock_staff` снимала только в `staff`; `unblock_member` требовала
-- блокировки именно в `tenant_members`. Итог на экране: человека,
-- заблокированного старой `block_staff`, разблокировать было нечем —
-- кнопка звала `unblock_member`, а та не находила блокировки и падала.
--
-- Решение: ДОСТУП определяет только `tenant_members.blocked_at`.
-- `staff.blocked_at` остаётся признаком «не работает» — он виден в
-- расписании и в составе команды, — и ставится и снимается ВМЕСТЕ с
-- доступом, а не вместо него.
--
-- `block_staff`/`unblock_staff` УДАЛЕНЫ, а не переписаны обёртками.
-- Правило 8: выключено значит удалено. Обёртка выглядит дешевле, но она
-- сохраняет второе имя для одного действия, и через полгода половина
-- кода зовёт одно, половина другое — ровно то, из чего вырос этот пункт.
-- Клиентский код их не звал ни разу (проверено поиском), так что цена
-- удаления здесь нулевая; цена сохранения — повторение той же беды.
-- Карточка мастера без учётной записи блокировке не подлежит и не
-- подлежала: «не принимает записи» — это `staff.is_active`.
--
-- Признак блокировки в `staff` теперь правится ТОЛЬКО функциями. Способ
-- тот же, что у передачи владения, — транзакционный флаг `app.staff_block`.
-- Он не «защита от программиста», а единственный способ отличить правку
-- изнутри своей функции от правки снаружи: политики RLS колонок не
-- различают, а разделять `staff` на две таблицы ради трёх колонок дороже.
-- ===========================================================================

-- ── 1. Эффективный набор прав и правило «не выдать больше, чем есть» ──────
--
-- Тот же разбор, что делает `custom_access_token_hook`: набор роли из
-- `role_grants` минус точечно снятое (`false`) плюс точечно выданное
-- (`true`). У владельца набор — `*`. Логика повторена намеренно: хук
-- собирает набор ДЛЯ ТОКЕНА по пользователю, а сюда приходит ПАРА
-- «роль + дозволы», которой ещё нет ни в одной строке, — проверять надо
-- то, что собираются записать, а не то, что уже записано.

create or replace function public.effective_perm_set(
  p_role public.member_role, p_perms jsonb)
returns text[]
language sql stable security definer set search_path to '' as $fn$
  select case
    when p_role = 'owner' then array['*']
    else coalesce((
      select array_agg(distinct x.permission)
        from (
          select g.permission
            from public.role_grants g
           where g.role = p_role
             and coalesce(
                   (case when jsonb_typeof(p_perms) = 'object'
                         then p_perms ->> g.permission end), 'true') <> 'false'
          union
          select o.key
            from jsonb_each_text(case when jsonb_typeof(p_perms) = 'object'
                                      then p_perms else '{}'::jsonb end) as o(key, value)
           where o.value = 'true'
        ) x), '{}'::text[])
  end;
$fn$;

revoke all on function public.effective_perm_set(public.member_role, jsonb)
  from public, anon, authenticated;

comment on function public.effective_perm_set(public.member_role, jsonb) is
  'Действующий набор прав для пары «роль + точечные дозволы». У владельца — {*}. Служебная: зовут только сторожа и функции команды.';

-- Нельзя выдать право, которого нет у тебя самого. Считается РАЗНИЦА:
-- сравнивается не весь новый набор, а только то, что этой правкой
-- ДОБАВЛЯЕТСЯ. Иначе понизить человека, у которого прав больше, чем
-- у тебя, было бы нельзя, — а это законное действие.
create or replace function public.assert_grant_within(
  p_actor_role public.member_role, p_actor_perms jsonb,
  p_role_new   public.member_role, p_perms_new   jsonb,
  p_role_old   public.member_role, p_perms_old   jsonb)
returns void
language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_actor text[] := public.effective_perm_set(p_actor_role, p_actor_perms);
  v_extra text[];
begin
  if '*' = any(v_actor) then return; end if;

  select coalesce(array_agg(d.p order by d.p), '{}'::text[]) into v_extra
    from (
      select unnest(public.effective_perm_set(p_role_new, p_perms_new))
      except
      select unnest(public.effective_perm_set(p_role_old, p_perms_old))
      except
      select unnest(v_actor)
    ) as d(p);

  if array_length(v_extra, 1) is not null then
    raise exception 'не можна видати права, яких немає у вас самих: %',
      array_to_string(v_extra, ', ');
  end if;
end $fn$;

revoke all on function public.assert_grant_within(
  public.member_role, jsonb, public.member_role, jsonb, public.member_role, jsonb)
  from public, anon, authenticated;

-- ── 2. Ключ `*` запрещён во всех трёх местах, откуда он попадает в токен ──
--
-- Проверяется через `-> '*' is null`, а не через оператор `?`: ограничение
-- уходит в бой ещё и текстом через API, где `?` разбирается как метка
-- параметра. Одинаковое поведение важнее краткости.

update public.tenant_members       set permissions = permissions - '*' where (permissions -> '*') is not null;
update public.invitations          set permissions = permissions - '*' where (permissions -> '*') is not null;
update public.permission_templates set permissions = permissions - '*' where (permissions -> '*') is not null;

alter table public.tenant_members drop constraint if exists tenant_members_perms_no_star;
alter table public.tenant_members add constraint tenant_members_perms_no_star
  check ((permissions -> '*') is null);

alter table public.invitations drop constraint if exists invitations_perms_no_star;
alter table public.invitations add constraint invitations_perms_no_star
  check ((permissions -> '*') is null);

alter table public.permission_templates drop constraint if exists permission_templates_perms_no_star;
alter table public.permission_templates add constraint permission_templates_perms_no_star
  check ((permissions -> '*') is null);

-- ── 3. Сторож участников: 0052 и 0076 вместе, плюс запрет самораздачи ────

create or replace function public.tenant_members_guard()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_actor       uuid := auth.uid();
  v_actor_role  public.member_role;
  v_actor_perms jsonb;
  v_row         public.tenant_members%rowtype := coalesce(new, old);
  v_cap_old     smallint;
  v_cap_new     smallint;
begin
  -- Три законные лазейки, и все три транзакционные.
  --   • purging_account — удаление аккаунта (0024, 0058): единственный
  --     путь, которому позволено сносить членства и журналы;
  --   • ownership_transfer — transfer_ownership (0052): передача владения
  --     обязана понизить владельца, а это ровно то, что запрещено ниже;
  --   • пустой actor — миграции и фоновые задачи. Сторож про людей.
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on'
     or coalesce(current_setting('app.ownership_transfer', true), 'off') = 'on'
     or v_actor is null then
    return v_row;
  end if;

  select tm.role, tm.permissions into v_actor_role, v_actor_perms
    from public.tenant_members tm
   where tm.tenant_id = v_row.tenant_id and tm.user_id = v_actor;

  -- ── INSERT ──
  if tg_op = 'INSERT' then
    if new.role = 'owner' and exists (select 1 from public.tenant_members tm
         where tm.tenant_id = new.tenant_id and tm.role = 'owner') then
      raise exception 'у закладі може бути лише один власник; скористайтеся transfer_ownership';
    end if;
    -- Актор не участник этого заведения — это путь приглашения
    -- (accept_invitation вписывает САМ приглашённый) и путь регистрации
    -- (register_tenant вписывает первого владельца). Ранг там проверять
    -- не по чему, поэтому его проверяют сами эти функции.
    if v_actor_role is not null then
      if public.role_rank(new.role) > public.role_rank(v_actor_role) then
        raise exception 'не можна видати роль, вищу за власну (% > %)', new.role, v_actor_role;
      end if;
      perform public.assert_grant_within(v_actor_role, v_actor_perms,
                                         new.role, new.permissions, null, '{}'::jsonb);
    end if;
    return new;
  end if;

  -- ── DELETE ──
  if tg_op = 'DELETE' then
    perform public.assert_not_last_owner(old.tenant_id, old.user_id,
              'прибрати його із закладу не можна');
    if old.user_id = v_actor and old.role = 'owner' then
      raise exception 'власник не може видалити сам себе з команди';
    end if;
    return old;
  end if;

  -- ── UPDATE ──
  if old.role = 'owner' and old.user_id = v_actor and new.role <> 'owner' then
    raise exception 'власник не може понизити себе сам — спершу передайте володіння';
  end if;

  -- Строку владельца не трогает никто, кроме него самого. Иначе
  -- администратор с team.write понижает того, кто его назначил.
  if old.role = 'owner' and old.user_id <> v_actor then
    raise exception 'права власника може змінювати лише він сам';
  end if;

  if old.user_id = v_actor then
    if old.role <> new.role or old.permissions is distinct from new.permissions then
      raise exception 'змінювати власні права не можна';
    end if;

    -- Ниже — не «права», а признаки доступа, и раньше они уходили мимо
    -- любой проверки. Токен живёт до часа после блокировки, и `team.write`
    -- в нём остаётся, поэтому заблокированный успевал снять блокировку
    -- сам себе обычным UPDATE. Запрещено любое РАСШИРЕНИЕ своего доступа;
    -- сужение (заблокировать себя, укоротить срок, снизить стелю) остаётся
    -- разрешённым — оно никого не подставляет.
    if old.blocked_at is not null and new.blocked_at is null then
      raise exception 'зняти собі блокування не можна — це має зробити хтось інший';
    end if;
    if coalesce(new.access_expires_at, 'infinity'::timestamptz)
       > coalesce(old.access_expires_at, 'infinity'::timestamptz) then
      raise exception 'відсунути або зняти собі строк доступу не можна';
    end if;
    v_cap_old := coalesce(old.discount_cap_pct,
                   (select c.cap_pct from public.role_discount_caps c where c.role = old.role), 0);
    v_cap_new := coalesce(new.discount_cap_pct,
                   (select c.cap_pct from public.role_discount_caps c where c.role = new.role), 0);
    if v_cap_new > v_cap_old then
      raise exception 'підняти собі стелю знижки не можна (% > %)', v_cap_new, v_cap_old;
    end if;
  end if;

  -- Ранг проверяется у ЛЮБОЙ правки чужой строки, а не только у смены
  -- роли: тронуть строку того, кто выше тебя, нельзя вообще — иначе
  -- управляющий блокирует администратора и укорачивает ему срок доступа.
  if public.role_rank(new.role) > public.role_rank(coalesce(v_actor_role, 'viewer'))
     or public.role_rank(old.role) > public.role_rank(coalesce(v_actor_role, 'viewer')) then
    raise exception 'не можна змінювати того, чия роль вища за власну (% > %)',
      greatest(public.role_rank(old.role), public.role_rank(new.role)),
      public.role_rank(coalesce(v_actor_role, 'viewer'));
  end if;

  if v_actor_role is not null then
    perform public.assert_grant_within(v_actor_role, v_actor_perms,
                                       new.role, new.permissions, old.role, old.permissions);
  end if;

  if old.role = 'owner' and new.role <> 'owner' then
    perform public.assert_not_last_owner(old.tenant_id, old.user_id, 'змінити його роль не можна');
  end if;

  return new;
end $fn$;

revoke all on function public.tenant_members_guard() from public, anon, authenticated;

-- Один триггер на все три операции. Оба прежних имени дропаются явно:
-- на бою жили оба, и `drop ... if exists` по одному имени оставлял второй.
drop trigger if exists tenant_members_guard     on public.tenant_members;
drop trigger if exists tenant_members_guard_trg on public.tenant_members;
create trigger tenant_members_guard
  before insert or update or delete on public.tenant_members
  for each row execute function public.tenant_members_guard();

-- ── 4. Журнал прав пропускает удаление аккаунта ──────────────────────────
--
-- Исключение ровно такое же, как у санитарных журналов (0066) и у приёмок
-- (0069): флаг транзакционный, ставится только `delete_my_account`, и без
-- него удаление аккаунта спотыкается о собственный журнал. Неизменяемость
-- журнала от этого не страдает: снаружи флаг поставить некому — функции,
-- которые его ставят, все SECURITY DEFINER и все проверяют, кто зовёт.

create or replace function public.permission_audit_immutable()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'журнал прав незмінний: % заборонено', tg_op;
end $fn$;

revoke all on function public.permission_audit_immutable() from public, anon, authenticated;

drop trigger if exists permission_audit_no_change on public.permission_audit;
create trigger permission_audit_no_change
  before update or delete on public.permission_audit
  for each row execute function public.permission_audit_immutable();

-- ── 5. Приглашения: писать в таблицу руками нельзя ───────────────────────
--
-- `create_invitation` и `revoke_invitation` — SECURITY DEFINER и владеют
-- таблицей, поэтому RLS их не касается и права `authenticated` им не нужны.
-- Оставляем `select`: экран показывает список выписанных приглашений.

drop policy if exists invitations_insert on public.invitations;
drop policy if exists invitations_update on public.invitations;

revoke all on table public.invitations from anon, authenticated;
grant select on table public.invitations to authenticated;

-- Роль и права берутся из строки приглашения, а строка живёт 72 часа.
-- За это время выписавший может лишиться `team.write`, быть понижен или
-- заблокирован — а приглашение продолжало работать по правам, которых
-- у него уже нет. Проверяем НА МОМЕНТ ПРИЁМА.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path to '' as $fn$
declare
  v_uid   uuid := auth.uid();
  v_mail  extensions.citext;
  v_hash  text;
  v_inv   public.invitations%rowtype;
  v_rows  int;
  v_by_role  public.member_role;
  v_by_perms jsonb;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  select pr.email into v_mail from public.profiles pr where pr.id = v_uid;
  v_hash := encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');

  select i.* into v_inv from public.invitations i
   where i.token_hash = v_hash and i.status = 'pending'
     and i.expires_at > now() and i.email = v_mail
   for update;
  if v_inv.id is null then
    raise exception 'запрошення недійсне: не існує, вже використане, відкликане, протерміноване або виписане на іншу пошту';
  end if;

  select tm.role, tm.permissions into v_by_role, v_by_perms
    from public.tenant_members tm
   where tm.tenant_id = v_inv.tenant_id and tm.user_id = v_inv.invited_by;

  if v_by_role is null or not public.member_access_ok(v_inv.tenant_id, v_inv.invited_by) then
    raise exception 'той, хто виписав запрошення, більше не працює в закладі — попросіть нове';
  end if;
  if not ('team.write' = any(public.effective_perm_set(v_by_role, v_by_perms))
          or '*' = any(public.effective_perm_set(v_by_role, v_by_perms))) then
    raise exception 'той, хто виписав запрошення, більше не має права team.write — попросіть нове';
  end if;
  if public.role_rank(v_inv.role) > public.role_rank(v_by_role) then
    raise exception 'роль у запрошенні вища за роль того, хто його виписав — запрошення недійсне';
  end if;
  perform public.assert_grant_within(v_by_role, v_by_perms,
                                     v_inv.role, v_inv.permissions, null, '{}'::jsonb);

  update public.invitations i
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid
   where i.id = v_inv.id;

  insert into public.tenant_members (tenant_id, user_id, role, permissions, invited_by, access_expires_at)
  values (v_inv.tenant_id, v_uid, v_inv.role, v_inv.permissions, v_inv.invited_by,
          case when v_inv.access_days is null then null
               else now() + make_interval(days => v_inv.access_days) end)
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'ви вже учасник цього закладу'; end if;

  return v_inv.tenant_id;
end $fn$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ── 6. Один источник правды о блокировке ─────────────────────────────────
--
-- Сначала переносим блокировки, стоящие ТОЛЬКО в `staff`: если этого
-- не сделать, следующая же строка вернёт доступ всем, кого блокировали
-- старой `block_staff`. Правка идёт без вошедшего пользователя, поэтому
-- проходит сторожа и попадает в журнал прав с пустым автором — так и
-- надо: это сделала миграция, а не человек.

update public.tenant_members m
   set blocked_at     = s.blocked_at,
       blocked_by     = s.blocked_by,
       blocked_reason = coalesce(m.blocked_reason, s.blocked_reason)
  from public.staff s
 where s.tenant_id = m.tenant_id
   and s.user_id   = m.user_id
   and s.blocked_at is not null
   and m.blocked_at is null;

create or replace function public.member_access_ok(p_tenant uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $fn$
  select coalesce((select tm.blocked_at is null from public.tenant_members tm
                    where tm.tenant_id = p_tenant and tm.user_id = p_user), true)
     and coalesce((select tm.access_expires_at from public.tenant_members tm
                    where tm.tenant_id = p_tenant and tm.user_id = p_user),
                  'infinity'::timestamptz) > now();
$fn$;

-- Право `authenticated` отобрано: функция отвечала на вопрос «заблокирован
-- ли вот этот человек вот в этом заведении» кому угодно, а клиентский код
-- её не зовёт ни разу. Хук выдачи токена работает от `supabase_auth_admin`.
revoke all on function public.member_access_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_access_ok(uuid, uuid) to service_role, supabase_auth_admin;

comment on function public.member_access_ok(uuid, uuid) is
  'Доступ участника: не заблокирован и срок не истёк. Единственный источник правды — tenant_members; staff.blocked_at доступа больше не решает.';

-- Признак блокировки в карточке мастера правят только функции. Флаг
-- транзакционный — тот же приём, что у передачи владения.
create or replace function public.staff_access_guard()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_touched boolean;
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return new;
  end if;

  v_touched := case when tg_op = 'INSERT' then new.blocked_at is not null
                    else new.blocked_at     is distinct from old.blocked_at
                      or new.blocked_by     is distinct from old.blocked_by
                      or new.blocked_reason is distinct from old.blocked_reason
               end;

  if v_touched
     and auth.uid() is not null
     and coalesce(current_setting('app.staff_block', true), 'off') <> 'on' then
    raise exception 'блокування картки майстра ставлять і знімають лише block_member()/unblock_member()';
  end if;

  -- Проверка последнего владельца стоит ВНЕ зависимости от того, кто
  -- блокирует: заведение без владельца не чинится ничьими руками.
  if v_touched and new.blocked_at is not null and new.user_id is not null then
    perform public.assert_not_last_owner(new.tenant_id, new.user_id,
              'заблокувати його картку майстра не можна');
  end if;

  return new;
end $fn$;

revoke all on function public.staff_access_guard() from public, anon, authenticated;

drop trigger if exists staff_access_guard_trg on public.staff;
create trigger staff_access_guard_trg
  before insert or update on public.staff
  for each row execute function public.staff_access_guard();

create or replace function public.block_member(
  p_tenant_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_uid uuid := auth.uid(); v_rows int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;
  if p_user_id = v_uid then
    raise exception 'себе заблокувати не можна';
  end if;
  perform public.assert_not_last_owner(p_tenant_id, p_user_id, 'заблокувати його не можна');

  update public.tenant_members m
     set blocked_at = now(), blocked_by = v_uid, blocked_reason = p_reason
   where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.blocked_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'учасника не знайдено або він уже заблокований'; end if;

  -- Карточка мастера гасится вместе с доступом: иначе человек пропадает
  -- из кабинета, но остаётся в списке, на которого можно записать клиента.
  perform set_config('app.staff_block', 'on', true);
  update public.staff s
     set blocked_at = now(), blocked_by = v_uid, blocked_reason = p_reason
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.blocked_at is null;
  perform set_config('app.staff_block', 'off', true);
end $fn$;

revoke all on function public.block_member(uuid, uuid, text) from public, anon;
grant execute on function public.block_member(uuid, uuid, text) to authenticated;

-- Снимает блокировку в ОБЕИХ таблицах и не требует, чтобы она стояла
-- именно в `tenant_members`: людей, заблокированных старой `block_staff`,
-- иначе разблокировать было бы нечем.
create or replace function public.unblock_member(p_tenant_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_uid uuid := auth.uid(); v_member int; v_staff int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  -- Явный отказ раньше проверки права: у заблокированного `team.write`
  -- в токене ещё живёт, и без этой строки он снимает блокировку сам себе.
  if p_user_id = v_uid then
    raise exception 'зняти блокування самому собі не можна — це має зробити хтось інший';
  end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  update public.tenant_members m
     set blocked_at = null, blocked_by = null, blocked_reason = null
   where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.blocked_at is not null;
  get diagnostics v_member = row_count;

  perform set_config('app.staff_block', 'on', true);
  update public.staff s
     set blocked_at = null, blocked_by = null, blocked_reason = null
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.blocked_at is not null;
  get diagnostics v_staff = row_count;
  perform set_config('app.staff_block', 'off', true);

  if v_member + v_staff = 0 then
    raise exception 'учасника не знайдено або він не заблокований';
  end if;
end $fn$;

revoke all on function public.unblock_member(uuid, uuid) from public, anon;
grant execute on function public.unblock_member(uuid, uuid) to authenticated;

-- Второе имя одного действия удалено, а не обёрнуто (правило 8).
drop function if exists public.block_staff(uuid, text);
drop function if exists public.unblock_staff(uuid);

-- Сообщение указывало на функцию, которой больше нет.
create or replace function public.staff_no_delete() returns trigger
language plpgsql security definer set search_path to '' as $fn$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return old;
  end if;
  raise exception 'співробітника не видаляють — його підпис стоїть у незмінних журналах; використайте block_member()';
end $fn$;

revoke all on function public.staff_no_delete() from public, anon, authenticated;

-- ── 7. Шаблон прав не обходит ранг ───────────────────────────────────────
--
-- Шаблон меняет участника обычным UPDATE, значит сторож его и так поймает.
-- Проверки продублированы в самой функции ради сообщения: «шаблон видає
-- роль, вищу за власну» объясняет, что делать, а сообщение сторожа про
-- строку участника в этом месте выглядит случайным.

create or replace function public.apply_permission_template(
  p_tenant_id uuid, p_user_id uuid, p_template_id uuid)
returns void language plpgsql security definer set search_path to '' as $fn$
declare
  v_t      public.permission_templates%rowtype;
  v_uid    uuid := auth.uid();
  v_role   public.member_role; v_perms  jsonb;
  v_trole  public.member_role; v_tperms jsonb;
  v_rows   int;
begin
  if v_uid is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  select * into v_t from public.permission_templates
   where id = p_template_id and tenant_id = p_tenant_id;
  if v_t.id is null then raise exception 'шаблон не знайдено'; end if;

  select tm.role, tm.permissions into v_role, v_perms from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = v_uid;
  if v_role is null then raise exception 'ви не учасник цього закладу'; end if;

  if public.role_rank(v_t.role) > public.role_rank(v_role) then
    raise exception 'шаблон видає роль, вищу за власну (% > %)', v_t.role, v_role;
  end if;

  select tm.role, tm.permissions into v_trole, v_tperms from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;
  if v_trole is null then raise exception 'учасника не знайдено'; end if;

  perform public.assert_grant_within(v_role, v_perms, v_t.role, v_t.permissions, v_trole, v_tperms);

  update public.tenant_members m
     set role = v_t.role,
         permissions = v_t.permissions,
         discount_cap_pct = v_t.cap_pct
   where m.tenant_id = p_tenant_id and m.user_id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'учасника не знайдено'; end if;
end $fn$;

revoke all on function public.apply_permission_template(uuid, uuid, uuid) from public, anon;
grant execute on function public.apply_permission_template(uuid, uuid, uuid) to authenticated;

-- ── 8. Принудительный выход не работает вверх по лестнице ────────────────
--
-- Без ранга любой с `team.write` держал владельца в вечном разлогине:
-- сеанс рвётся мгновенно, а вернуть его владелец может только войдя.
-- Массовый выход по заведению теперь тоже не задевает тех, кто выше:
-- молча пропустить их честнее, чем отказать во всей операции.

create or replace function public.end_sessions(p_tenant_id uuid, p_user_id uuid default null)
returns integer language plpgsql security definer set search_path to '' as $fn$
declare v_n integer; v_actor_role public.member_role; v_target_role public.member_role;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  select tm.role into v_actor_role from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid();
  if v_actor_role is null then raise exception 'ви не учасник цього закладу'; end if;

  if p_user_id is not null then
    select tm.role into v_target_role from public.tenant_members tm
     where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;
    if v_target_role is null then raise exception 'учасника не знайдено'; end if;
    if public.role_rank(v_target_role) > public.role_rank(v_actor_role) then
      raise exception 'не можна завершити сеанси того, чия роль вища за власну (% > %)',
        v_target_role, v_actor_role;
    end if;
  end if;

  -- Выход по всему заведению НЕ трогает того, кто его нажал: иначе
  -- владелец выкидывает сам себя и не может войти обратно, чтобы
  -- посмотреть, что случилось. Свой сеанс закрывается кнопкой «вийти».
  delete from auth.sessions s
   where s.user_id in (
           select m.user_id from public.tenant_members m
            where m.tenant_id = p_tenant_id
              and (p_user_id is null or m.user_id = p_user_id)
              and public.role_rank(m.role) <= public.role_rank(v_actor_role))
     and s.user_id <> auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function public.end_sessions(uuid, uuid) from public, anon;
grant execute on function public.end_sessions(uuid, uuid) to authenticated;

comment on function public.tenant_members_guard() is
  'Сторож членств: ранг, принадлежность прав, последний владелец и запрет расширять доступ самому себе. Лазейки — app.ownership_transfer и app.purging_account.';
comment on function public.staff_access_guard() is
  'Блокировку в карточке мастера ставят только block_member/unblock_member — через транзакционный флаг app.staff_block.';
