-- 0121. Финансовая аналитика: P&L по месяцам, постоянные и переменные
--       расходы, себестоимость и маржа позиций, накопленный итог периода.
--
-- CLAUDE.md называл это долгом дословно: «нет P&L по периодам, разделения
-- на постоянные и переменные расходы, себестоимости услуги по рецептуре,
-- маржи по позициям, кассового разрыва». Три из четырёх опор уже стояли:
-- журнал `finance_records` (0007), рецептуры `variant_materials` (0003,
-- экран — М39) и себестоимость, которую приёмка пересчитывает
-- средневзвешенно (0112 — и для расходников, и для товарных вариантов).
-- Эта миграция только СВОДИТ готовые данные, не заводя ни одной новой
-- сущности учёта.
--
-- Решения:
-- • «Постоянный или переменный» — свойство КАТЕГОРИИ, а не записи:
--   аренда постоянна вся, закупка материалов переменна вся. Флаг на
--   каждой записи означал бы, что одна и та же аренда в январе
--   постоянная, а в феврале как проставят. Данными — то, что меняется
--   (правило проекта): галочка на категории, никакого кода.
-- • Агрегаты считает БАЗА, а не экран. Экран сегодня грузит 200 строк
--   журнала; P&L за год по этим 200 строкам был бы враньём молча.
-- • Функции — SECURITY INVOKER: RLS `finance_records` сам отсекает
--   чужое (`finances.read`), и дублировать проверку внутри значит
--   завести второй источник правды о правах.
-- • «Кассовый разрыв» в честном объёме: накопленный итог ВНУТРИ периода
--   (`running`). Настоящий прогноз разрыва требует начального остатка
--   счёта, которого в учёте нет как сущности, — выдумывать его нельзя.

-- ── Постоянные и переменные расходы ─────────────────────────────────────────

alter table public.finance_categories
  add column if not exists is_fixed boolean not null default false;

comment on column public.finance_categories.is_fixed is
  'Постоянный расход (аренда, подписки) против переменного (материалы, '
  'закупки). Свойство категории, а не записи: P&L делит расходы по нему.';

-- ── P&L по месяцам ──────────────────────────────────────────────────────────

create or replace function public.finance_pnl(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  bucket           date,
  income           numeric,
  expense_fixed    numeric,
  expense_variable numeric,
  net              numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_trunc('month', r.occurred_on)::date as bucket,
    coalesce(sum(r.amount) filter (where r.kind = 'income'), 0)  as income,
    coalesce(sum(r.amount) filter (where r.kind = 'expense'
                                     and coalesce(c.is_fixed, false)), 0) as expense_fixed,
    coalesce(sum(r.amount) filter (where r.kind = 'expense'
                                     and not coalesce(c.is_fixed, false)), 0) as expense_variable,
    coalesce(sum(case when r.kind = 'income' then r.amount else -r.amount end), 0) as net
  from public.finance_records r
  left join public.finance_categories c on c.id = r.category_id
  where r.tenant_id = p_tenant_id
    and r.occurred_on between p_from and p_to
  group by 1
  order by 1;
$$;

comment on function public.finance_pnl(uuid, date, date) is
  'P&L по месяцам из finance_records. INVOKER: RLS finances.read сам '
  'отсекает чужого арендатора — пустой ответ, а не утечка.';

revoke all on function public.finance_pnl(uuid, date, date) from public;
revoke all on function public.finance_pnl(uuid, date, date) from anon;
grant execute on function public.finance_pnl(uuid, date, date) to authenticated;

-- ── Накопленный итог по дням (честная часть «кассового разрыва») ───────────

create or replace function public.finance_running(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
returns table (
  day     date,
  income  numeric,
  expense numeric,
  running numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with daily as (
    select
      r.occurred_on as day,
      coalesce(sum(r.amount) filter (where r.kind = 'income'), 0)  as income,
      coalesce(sum(r.amount) filter (where r.kind = 'expense'), 0) as expense
    from public.finance_records r
    where r.tenant_id = p_tenant_id
      and r.occurred_on between p_from and p_to
    group by 1
  )
  select
    day, income, expense,
    sum(income - expense) over (order by day) as running
  from daily
  order by day;
$$;

comment on function public.finance_running(uuid, date, date) is
  'Доход/расход по дням и накопленный итог ВНУТРИ периода. Не прогноз '
  'кассового разрыва: начального остатка счёта в учёте не существует, '
  'и выдумывать его нельзя.';

revoke all on function public.finance_running(uuid, date, date) from public;
revoke all on function public.finance_running(uuid, date, date) from anon;
grant execute on function public.finance_running(uuid, date, date) to authenticated;

-- ── Себестоимость и маржа позиций ───────────────────────────────────────────
--
-- Себестоимость варианта:
--   товар  — его собственный `cost` (0112 пересчитывает из приёмок);
--   услуга — сумма рецептуры: quantity_per_unit × cost_per_unit расходника
--            (первое — М39, второе — 0112). Плюс собственный `cost`
--            варианта, если продавец завёл его руками (работа мастера).
--
-- ⚠️ INVOKER-а здесь НЕДОСТАТОЧНО, и это поймал тест 42 первым прогоном:
-- RLS каталога публичный — витрину читают все, включая чужих
-- authenticated. То есть представление на одном INVOKER отдавало
-- себестоимость и маржу ЛЮБОМУ вошедшему. Маржа — финансовая
-- информация, поэтому в самом представлении стоит фильтр по праву
-- `finances.read`, тем же `tenants_with()`, что и политики.

create or replace view public.variant_margin_view
with (security_invoker = on) as
select
  v.tenant_id,
  v.id           as variant_id,
  o.id           as offering_id,
  o.kind         as offering_kind,
  o.title,
  v.name         as variant_name,
  v.price,
  v.cost         as own_cost,
  rc.recipe_cost,
  (coalesce(v.cost, 0) + coalesce(rc.recipe_cost, 0)) as unit_cost,
  case when v.price is null then null
       else v.price - (coalesce(v.cost, 0) + coalesce(rc.recipe_cost, 0))
  end as margin,
  case when v.price is null or v.price = 0 then null
       else round((v.price - (coalesce(v.cost, 0) + coalesce(rc.recipe_cost, 0)))
                  / v.price * 100, 1)
  end as margin_pct,
  -- Рецептура есть, но хотя бы у одного расходника нет себестоимости:
  -- маржа выше — заниженная, и экран обязан сказать это, а не молчать.
  coalesce(rc.missing_costs, 0) as missing_costs
from public.offering_variants v
join public.offerings o on o.id = v.offering_id
left join lateral (
  select
    sum(vm.quantity_per_unit * m.cost_per_unit) as recipe_cost,
    count(*) filter (where m.cost_per_unit is null) as missing_costs
  from public.variant_materials vm
  join public.materials m on m.id = vm.material_id
  where vm.variant_id = v.id
) rc on true
where v.is_active
  and v.tenant_id in (select public.tenants_with('finances.read'));

comment on view public.variant_margin_view is
  'Себестоимость и маржа по позициям: cost варианта (0112) + рецептура '
  '(М39 × 0112). missing_costs > 0 — маржа занижена, у части рецептуры '
  'нет себестоимости.';

-- Правило 7 про представления, и здесь оно дороже всего: у простого
-- представления UPDATE доходит до таблицы правами владельца. Это
-- представление не автообновляемо (join + агрегат), но отзыв пишем
-- явно — облако Supabase раздаёт ALL через default privileges (седьмой
-- раз: 0036, 0060, 0072, 0076, 0082, 0114).
revoke all on public.variant_margin_view from public;
revoke all on public.variant_margin_view from anon;
revoke all on public.variant_margin_view from authenticated;
grant select on public.variant_margin_view to authenticated;
