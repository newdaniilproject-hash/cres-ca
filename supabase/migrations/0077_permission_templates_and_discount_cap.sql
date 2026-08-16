-- ===========================================================================
-- 0077. Шаблоны прав и потолок скидки. Шаг 4, пункт Б
-- ===========================================================================
--
-- ── А. ШАБЛОНЫ ПРАВ ──────────────────────────────────────────────────────
--
-- Роль отвечает на вопрос «кто он вообще», а тонкая выдача — на вопрос
-- «что именно ему можно здесь». Без шаблонов вторую приходится собирать
-- заново каждому: пятнадцать галочек на человека, и на третьем сотруднике
-- владелец начинает ставить всем «как у Оли», не глядя. Шаблон делает это
-- честным действием, а не привычкой.
--
-- Шаблоны ПЕР-АРЕНДАТОРНЫЕ: набор прав массажиста и набор прав приёмщицы
-- в автосервисе не совпадают ни в одном пункте, и общего справочника тут
-- быть не может.
--
-- ── Б. ПОТОЛОК СКИДКИ — ЧИСЛО, А НЕ ПРАВО ────────────────────────────────
--
-- План называет его «отдельным правом». Здесь он сделан ЧИСЛОМ, и это
-- названное отступление.
--
-- Право — это «можно или нельзя». Потолок скидки — «на сколько процентов»,
-- и у разных людей он разный: администратору двадцать, владельцу сто,
-- новичку ноль. Уложить число в строку разрешения можно только выдумкой
-- вроде `discount.max.20`, и тогда каждый вопрос «а какой у него потолок»
-- превращается в разбор строки, а каждое изменение — в удаление одного
-- разрешения и добавление другого. Один раз ошибёшься с разбором — и
-- скидка станет неограниченной.
--
-- Поэтому: колонка `discount_cap_pct` у участника. NULL означает «по
-- роли», и роль даёт потолок из `role_discount_caps`. Так у числа одно
-- место хранения и одно правило умолчания.
--
-- ── В. ПРАВО ВИДЕТЬ КОНТАКТЫ КЛИЕНТОВ ───────────────────────────────────
--
-- Заводится `customers.contacts` — право видеть телефон и почту клиента.
-- Оно ОТДЕЛЬНО от `customers.read`: список клиентов и телефоны клиентов —
-- разные вещи, и мастеру нужен первый без второго.
--
-- Сегодня это право ещё ничего не закрывает: `bookings.contact_phone`
-- читает любой, у кого есть `orders.read`, — то есть и мастер. Закрытие
-- идёт следующей миграцией ВМЕСТЕ с правкой экранов: спрятать колонку
-- в базе и не поправить три экрана — значит уронить их все разом.
-- Право заводится сейчас, чтобы к моменту закрытия оно уже было роздано
-- и не пришлось менять права и поведение одним движением.
-- ===========================================================================

-- ── 1. Право видеть контакты клиентов ─────────────────────────────────────

insert into public.role_grants (role, permission) values
  ('owner',   'customers.contacts'),
  ('admin',   'customers.contacts'),
  ('manager', 'customers.contacts')
on conflict do nothing;

-- operator (мастер) и inspector его НЕ получают намеренно: мастеру нужны
-- записи, а не телефонная книга заведения; инспектор не видит клиентов
-- вовсе (0014).

-- ── 2. Потолок скидки ─────────────────────────────────────────────────────

create table if not exists public.role_discount_caps (
  role     public.member_role primary key,
  cap_pct  smallint not null check (cap_pct between 0 and 100)
);

insert into public.role_discount_caps (role, cap_pct) values
  ('owner', 100), ('admin', 50), ('manager', 20),
  ('operator', 0), ('accountant', 0), ('viewer', 0), ('inspector', 0)
on conflict (role) do nothing;

alter table public.tenant_members
  add column if not exists discount_cap_pct smallint
  check (discount_cap_pct is null or discount_cap_pct between 0 and 100);

comment on column public.tenant_members.discount_cap_pct is
  'Персональный потолок скидки в процентах. NULL — берётся по роли из role_discount_caps.';

alter table public.role_discount_caps enable row level security;

-- Справочник читают все вошедшие: он одинаков для всех и ничего
-- не раскрывает. Пишет только миграция.
drop policy if exists role_discount_caps_read on public.role_discount_caps;
create policy role_discount_caps_read on public.role_discount_caps
  for select to authenticated using (true);

revoke all on table public.role_discount_caps from anon, authenticated;
grant select on table public.role_discount_caps to authenticated;

-- Действующий потолок: личный, если задан, иначе по роли.
create or replace function public.discount_cap(p_tenant_id uuid)
returns smallint language sql stable security definer set search_path to '' as $fn$
  select coalesce(m.discount_cap_pct, c.cap_pct, 0)
    from public.tenant_members m
    left join public.role_discount_caps c on c.role = m.role
   where m.tenant_id = p_tenant_id and m.user_id = auth.uid();
$fn$;

revoke all on function public.discount_cap(uuid) from public, anon;
grant execute on function public.discount_cap(uuid) to authenticated;

-- ── 3. Шаблоны прав ───────────────────────────────────────────────────────

create table if not exists public.permission_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  role        public.member_role not null,
  permissions jsonb not null default '[]'::jsonb,
  cap_pct     smallint check (cap_pct is null or cap_pct between 0 and 100),
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists permission_templates_tenant_idx on public.permission_templates (tenant_id);

alter table public.permission_templates enable row level security;

drop policy if exists permission_templates_read   on public.permission_templates;
drop policy if exists permission_templates_insert on public.permission_templates;
drop policy if exists permission_templates_update on public.permission_templates;
drop policy if exists permission_templates_delete on public.permission_templates;

create policy permission_templates_read on public.permission_templates
  for select using (tenant_id in (select public.tenants_with('team.read')));
create policy permission_templates_insert on public.permission_templates
  for insert with check (tenant_id in (select public.tenants_with('team.write')));
create policy permission_templates_update on public.permission_templates
  for update using (tenant_id in (select public.tenants_with('team.write')))
          with check (tenant_id in (select public.tenants_with('team.write')));
create policy permission_templates_delete on public.permission_templates
  for delete using (tenant_id in (select public.tenants_with('team.write')));

-- Права, которых никто не выдавал, приходят сами: `alter default privileges`
-- в облаке Supabase. Ловилось пять раз, поэтому отзыв стоит сразу.
revoke all on table public.permission_templates from anon, authenticated;
grant select, insert, update, delete on table public.permission_templates to authenticated;

-- Применение шаблона к участнику.
--
-- Отдельной функцией, а не UPDATE с экрана, по одной причине: применение
-- шаблона обязано пройти через те же запреты, что и ручная правка прав,
-- — иначе шаблон становится обходным путём. Здесь он выполняется обычным
-- UPDATE по `tenant_members`, а значит попадает и под триггер защиты
-- (0076), и в журнал прав, и рвёт сеансы. Это не побочный эффект,
-- это цель.
create or replace function public.apply_permission_template(
  p_tenant_id uuid, p_user_id uuid, p_template_id uuid)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_t public.permission_templates%rowtype; v_rows int;
begin
  if auth.uid() is null then raise exception 'не автентифіковано'; end if;
  if p_tenant_id not in (select public.tenants_with('team.write')) then
    raise exception 'немає права team.write у цьому закладі';
  end if;

  select * into v_t from public.permission_templates
   where id = p_template_id and tenant_id = p_tenant_id;
  if v_t.id is null then raise exception 'шаблон не знайдено'; end if;

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

comment on table public.permission_templates is
  'Шаблоны прав заведения. Применяются функцией apply_permission_template, чтобы пройти через те же запреты и журнал, что и ручная правка.';
