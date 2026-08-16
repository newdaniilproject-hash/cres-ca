-- ===========================================================================
-- 0082. Два разных «заблоковано» — и права на представлениях, которых
--       никто не выдавал
-- ===========================================================================
--
-- ── А. ЭКРАН ЧИТАЛ ОДИН ПРИЗНАК ТАМ, ГДЕ ИХ ДВА ──────────────────────────
--
-- После 0081 доступ определяет ТОЛЬКО `tenant_members.blocked_at`, а
-- `staff.blocked_at` означает «не працює» — это про расписание, а не про
-- вход. `team_overview` (0079) собирала их в одно поле:
--
--     coalesce(m.blocked_at, s.blocked_at)  as blocked_at
--     coalesce(m.blocked_reason, s.blocked_reason)
--
-- Экран подписывает это поле «заблоковано» и рисует кнопку «розблокувати».
-- Значит мастер, у которого погашена карточка, но доступ цел, показывался
-- лишённым доступа. Обратное тоже верно и хуже: пока состояния слиты, ни
-- один экран не может показать «не працює, але заходить» — а именно так
-- выглядит человек в отпуске.
--
-- `coalesce` тут не мелкая неточность вывода, а потеря сведения: из одного
-- значения два обратно не достаются. Отдаём оба поля раздельно, каждое —
-- ровно из своей таблицы, без подмешивания.
--
-- Имя `blocked_at` СОХРАНЯЕТСЯ за доступом, а не переезжает: доступ — это
-- то, о чём спрашивает и предупреждает экран, и то, что снимает
-- `unblock_member`. Карточка мастера получает собственные имена с
-- приставкой `staff_`. Так правка экрана сводится к показу второго
-- состояния, а не к переименованию первого.
--
-- ── Б. ПРЕДСТАВЛЕНИЯ БЫЛИ ОТКРЫТЫ АУТЕНТИФИЦИРОВАННЫМ НА ЗАПИСЬ ──────────
--
-- Найдено проверкой прав на бою, не тестом. У `v_bookings`, `v_orders`,
-- `team_access_log` и `stock_low_view` роль `authenticated` имела
-- INSERT/UPDATE/DELETE. Никакая миграция этого не выдавала: все они писали
-- только `grant select`, а `grant` ДОБАВЛЯЕТ право к уже имеющемуся —
-- к тому, что раздал `alter default privileges … grant all … to anon,
-- authenticated` в облаке Supabase. Ровно тот же механизм, что в 0036,
-- 0060, 0072 и 0076; седьмой раз.
--
-- Почему это дыра, а не неопрятность. У представления нет RLS. `v_orders`
-- и `v_bookings` — SECURITY DEFINER (0078, намеренно: они читают колонку,
-- которую смотрящему читать нельзя), владелец у них postgres, он же
-- владелец `orders` и `bookings`, а `force row level security` на тех
-- таблицах не стоит. Представления при этом ПРОСТЫЕ, то есть
-- автообновляемые: `information_schema.views.is_updatable = YES`.
-- Складывается это так: UPDATE через представление доходит до таблицы
-- ПРАВАМИ ВЛАДЕЛЬЦА, и политики не применяются вовсе.
--
-- Проверено планом на бою от имени `authenticated`:
--
--   explain update public.v_orders set comment = 'x';
--     Update on orders o
--       ->  Seq Scan on orders o
--             Filter: (tenant_id = ANY (…tenants_with('orders.read')…)
--                      OR buyer_user_id = …auth.uid()…)
--
--   explain update public.orders   set comment = 'x';
--     Update on orders
--       ->  Seq Scan on orders
--             Filter: (tenant_id = ANY (…RLS-политика…))   + WITH CHECK
--
-- В первом плане нет ни политики, ни WITH CHECK — только собственный WHERE
-- представления, а он спрашивает `orders.read`. То есть право ЧИТАТЬ заказы
-- давало право их ПРАВИТЬ и УДАЛЯТЬ, а отсутствие WITH CHECK позволяло
-- перенести чужую строку в свой заклад (правило 1).
--
-- Чинится не поимённо, а разом по всем представлениям схемы: список имён
-- устаревает ровно в тот день, когда добавят следующее представление,
-- а причина у всех одна. Право на чтение возвращается явным списком —
-- чтобы отзыв не унёс с собой то, ради чего представление и заводилось.
--
-- ── В. FK БЕЗ ПОКРЫВАЮЩЕГО ИНДЕКСА ──────────────────────────────────────
--
-- `tenant_members.blocked_by` (0079) ссылается на `profiles` с `on delete
-- set null`, а индекса под ним нет. У соседней `staff.blocked_by` такой
-- индекс есть с 0074 — там же и записана причина: удаление профиля
-- заставляет Postgres просмотреть ссылающуюся таблицу целиком.
-- ===========================================================================

-- ── А. Состав команды: два состояния раздельно ────────────────────────────
--
-- Через drop, а не `create or replace`: у функции меняется набор выходных
-- колонок, а его `or replace` менять не умеет.
drop function if exists public.team_overview(uuid);

create function public.team_overview(p_tenant_id uuid)
returns table (
  user_id             uuid,
  full_name           text,
  email               text,
  role                public.member_role,
  permissions         jsonb,
  discount_cap_pct    smallint,
  effective_cap_pct   smallint,
  -- Доступ. Единственный источник правды — `tenant_members` (0081).
  blocked_at          timestamptz,
  blocked_reason      text,
  access_expires_at   timestamptz,
  -- Карточка мастера. `staff_blocked_at` — это «не працює»: человек
  -- пропадает из расписания и из списка, на кого можно записать клиента,
  -- но кабинет ему открыт. Снимается тем же `unblock_member`.
  staff_id            uuid,
  staff_blocked_at    timestamptz,
  staff_blocked_reason text,
  staff_is_active     boolean,
  joined_at           timestamptz
)
language sql stable security definer set search_path to '' as $fn$
  select m.user_id,
         p.full_name,
         p.email::text,
         m.role,
         m.permissions,
         m.discount_cap_pct,
         coalesce(m.discount_cap_pct, c.cap_pct, 0)::smallint,
         m.blocked_at,
         m.blocked_reason,
         m.access_expires_at,
         s.id,
         s.blocked_at,
         s.blocked_reason,
         s.is_active,
         m.created_at
    from public.tenant_members m
    left join public.profiles p           on p.id = m.user_id
    left join public.role_discount_caps c on c.role = m.role
    left join public.staff s              on s.tenant_id = m.tenant_id and s.user_id = m.user_id
   where m.tenant_id = p_tenant_id
     and p_tenant_id in (select public.tenants_with('team.read'))
   order by public.role_rank(m.role) desc, p.full_name nulls last;
$fn$;

revoke all on function public.team_overview(uuid) from public, anon;
grant execute on function public.team_overview(uuid) to authenticated;

comment on function public.team_overview(uuid) is
  'Состав команды для экрана. Доступ (blocked_at/blocked_reason) и карточка мастера (staff_blocked_at/staff_blocked_reason/staff_is_active) — РАЗНЫЕ состояния и НЕ склеиваются. SECURITY DEFINER — изоляцию проверяет собственный WHERE по team.read.';

-- ── Б. Представления только читают ───────────────────────────────────────
--
-- Проходим по всем представлениям схемы `public`: причина у них общая,
-- и поимённый список устареет на следующем представлении.
do $$
declare v record;
begin
  for v in select c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           where c.relkind = 'v' order by c.relname
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated',
      v.relname);
  end loop;
end $$;

-- Чтение возвращается явным списком. Кто читает — решено раньше и здесь
-- только повторено: соответствие видит инспектор (0061), склад и команда —
-- сотрудники по своим правам, записи и заказы — по `orders.read` внутри
-- самого представления (0078). Анониму не отдаётся ничего.
grant select on public.compliance_materials     to authenticated;
grant select on public.compliance_batches       to authenticated;
grant select on public.compliance_containers    to authenticated;
grant select on public.compliance_batch_history to authenticated;
grant select on public.stock_low_view           to authenticated;
grant select on public.stock_value_view         to authenticated;
grant select on public.team_access_log          to authenticated;
grant select on public.v_bookings               to authenticated;
grant select on public.v_orders                 to authenticated;

-- ── В. Индекс под внешний ключ ───────────────────────────────────────────
--
-- Частичный: `blocked_by` заполнен у единиц строк, и полный индекс был бы
-- в основном пустыми ссылками. Тот же вид, что у `staff_blocked_by_idx`.
create index if not exists tenant_members_blocked_by_idx
  on public.tenant_members (blocked_by) where blocked_by is not null;
