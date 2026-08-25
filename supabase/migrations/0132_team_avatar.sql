-- 0132. Фото людини в списку команди.
--
-- Продовження 0130. Своє фото зʼявилось на екрані профілю, а всюди
-- інше лишалась перша літера імені — відгук власника 25.08.2026:
-- «фото обновилось но не везде». Шапка й шторка під нею полагоджені
-- у застосунку (їм вистачило додати колонку в запит макета), а список
-- команди читає `team_overview`, і колонки в ньому не було.
--
-- ── ЧОМУ DROP, А НЕ CREATE OR REPLACE ──────────────────────────────────────
--
-- Змінюється СКЛАД повернення (`returns table`), а його `or replace`
-- міняти не вміє — Postgres відмовляє «cannot change return type of
-- existing function». Тому drop + create, і обовʼязково знову видати
-- EXECUTE: після перестворення прав на функції немає, а `alter default
-- privileges` у хмарі Supabase видасть їх ще й `anon`.
--
-- Тіло знято `pg_get_functiondef` 25.08.2026 і перенесено дослівно.
-- Змінено РІВНО ОДНЕ місце: доданий `p.avatar_url`. Порядок решти
-- колонок і сортування не чіпані — застосунок читає їх за іменем,
-- але тест і картка учасника читають за складом.
--
-- Шлях віддається як є (`<tenant_id>/avatars/<user_id>.<ext>`), а не
-- повною адресою: домен проекту міняється, шлях — ні. Адресу збирає
-- сторінка, як і на екрані профілю.

begin;

drop function if exists public.team_overview(uuid);

create function public.team_overview(p_tenant_id uuid)
returns table (
  user_id uuid, full_name text, email text, avatar_url text,
  role public.member_role, permissions jsonb,
  discount_cap_pct smallint, effective_cap_pct smallint,
  blocked_at timestamptz, blocked_reason text,
  access_expires_at timestamptz,
  staff_id uuid, staff_blocked_at timestamptz, staff_blocked_reason text,
  staff_is_active boolean, joined_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select m.user_id,
         p.full_name,
         p.email::text,
         p.avatar_url,
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
$function$;

revoke execute on function public.team_overview(uuid) from public;
revoke execute on function public.team_overview(uuid) from anon;
grant execute on function public.team_overview(uuid) to authenticated, service_role;

commit;
