-- ===========================================================================
-- 0066. Склад: три дефекта, которые делали модуль непродаваемым
-- ===========================================================================
--
-- А. ИНВЕНТАРИЗАЦИЯ РАСХОДНИКОВ БЫЛА НЕВОЗМОЖНА АРХИТЕКТУРНО.
--    stock_count_lines имела только variant_id, а start_stock_count
--    принимала исключительно варианты товаров. У платящего клиента склад —
--    это ИМЕННО расходники, товаров у него ноль: пересчитать банки
--    было нельзя в принципе. Форма ограничения повторяет ту, что уже
--    стоит в stock_movements и stock_receipt_lines: обе колонки рядом,
--    ровно одна заполнена.
--
-- Б. ЖУРНАЛ ДВИЖЕНИЙ НЕ БЫЛ ЗАЩИЩЁН ВТОРЫМ РУБЕЖОМ.
--    Политик UPDATE и DELETE у stock_movements нет, и обычный пользователь
--    журнал не тронет. Но любая функция SECURITY DEFINER идёт мимо RLS,
--    а остаток обязан сходиться с журналом: сломать сходимость можно
--    молча, обнаружится при инвентаризации у клиента. Четыре журнала
--    соответствия защищены дважды — отсутствием политик И триггером;
--    журнал движений заслуживает того же. Ошибку исправляют сторнирующим
--    движением, а не правкой прошлого: это документ.
--    То же — шапка проведённой накладной: guard_applied_document висел
--    только на строках, и проведённый документ можно было переписать,
--    оставив его движения висеть.
--
-- В. stock_value_view ИГНОРИРОВАЛА РАСХОДНИКИ.
--    Представление считало только offering_variants. Для салона, у которого
--    товаров нет, стоимость склада всегда ноль — при том что соседняя
--    stock_low_view расходники учитывает, и расхождение видно на глаз.
--
-- Единственная законная лазейка в неизменяемости — транзакционный флаг
-- app.purging_account, тот же, что у остальных журналов: он существует
-- ради удаления аккаунта (0058) и больше ни для чего.
-- ===========================================================================

-- ── А. Инвентаризация расходников ──────────────────────────────────────────

alter table public.stock_count_lines
  add column if not exists material_id uuid references public.materials(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_count_lines_one_target') then
    alter table public.stock_count_lines
      add constraint stock_count_lines_one_target
      check ((variant_id is not null)::int + (material_id is not null)::int = 1);
  end if;
end $$;

-- Старая уникальность покрывала только варианты: у строк по материалам
-- variant_id пуст, а (count_id, null) в UNIQUE не конфликтует само с собой —
-- одну банку можно было посчитать дважды. Меняем на два частичных индекса.
alter table public.stock_count_lines
  drop constraint if exists stock_count_lines_count_id_variant_id_key;

create unique index if not exists stock_count_lines_variant_uniq
  on public.stock_count_lines (count_id, variant_id) where variant_id is not null;
create unique index if not exists stock_count_lines_material_uniq
  on public.stock_count_lines (count_id, material_id) where material_id is not null;

-- Сигнатура меняется: третий параметр с умолчанием превратил бы вызов
-- из двух аргументов в неоднозначный, поэтому старая функция снимается.
drop function if exists public.start_stock_count(uuid, uuid[]);

create function public.start_stock_count(
  p_tenant_id    uuid,
  p_variant_ids  uuid[] default null,
  p_material_ids uuid[] default null
) returns public.stock_counts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count public.stock_counts;
begin
  if not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;
  if auth.uid() is null then
    raise exception 'инвентаризация требует авторизованного пользователя';
  end if;
  if coalesce(array_length(p_variant_ids, 1), 0)
   + coalesce(array_length(p_material_ids, 1), 0) = 0 then
    raise exception 'нечего пересчитывать: не передан ни один товар и ни один засіб';
  end if;

  insert into public.stock_counts (tenant_id, started_by)
  values (p_tenant_id, auth.uid())
  returning * into v_count;

  insert into public.stock_count_lines (count_id, variant_id, expected_qty)
  select v_count.id, v.id, v.stock_qty
    from public.offering_variants v
   where v.id = any(coalesce(p_variant_ids, '{}'::uuid[]))
     and v.tenant_id = p_tenant_id;

  -- Ожидаемое по расходнику — текущий кэш остатка, ровно как у вариантов.
  insert into public.stock_count_lines (count_id, material_id, expected_qty)
  select v_count.id, m.id, m.current_stock
    from public.materials m
   where m.id = any(coalesce(p_material_ids, '{}'::uuid[]))
     and m.tenant_id = p_tenant_id;

  return v_count;
end;
$function$;

revoke all on function public.start_stock_count(uuid, uuid[], uuid[]) from public;
revoke all on function public.start_stock_count(uuid, uuid[], uuid[]) from anon;
grant execute on function public.start_stock_count(uuid, uuid[], uuid[]) to authenticated;

create or replace function public.apply_stock_count(p_count_id uuid)
returns public.stock_counts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count public.stock_counts;
  v_line  record;
begin
  select * into v_count from public.stock_counts where id = p_count_id for update;

  if not found then
    raise exception 'инвентаризация % не найдена', p_count_id;
  end if;
  if v_count.status <> 'counting' then
    raise exception 'инвентаризация % в статусе % — не идёт пересчёт', p_count_id, v_count.status;
  end if;
  if not public.tenant_can(v_count.tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', v_count.tenant_id;
  end if;

  for v_line in
    select * from public.stock_count_lines
     where count_id = p_count_id
       and counted_qty is not null
       and counted_qty <> expected_qty
  loop
    -- Расхождение разносится ТОЛЬКО движением: прямая правка остатка
    -- заблокирована guard_stock_columns, и это правильно (правило 5).
    perform public.record_stock_movement(
      p_tenant_id      => v_count.tenant_id,
      p_movement_type  => 'adjustment',
      p_quantity       => v_line.counted_qty - v_line.expected_qty,
      p_variant_id     => v_line.variant_id,
      p_material_id    => v_line.material_id,
      p_reference_type => 'stock_count',
      p_reference_id   => p_count_id,
      p_count_id       => p_count_id
    );
  end loop;

  update public.stock_counts
     set status = 'applied', applied_at = now(), applied_by = auth.uid()
   where id = p_count_id
   returning * into v_count;

  return v_count;
end;
$function$;

-- ── Б. Журнал движений неизменяем ──────────────────────────────────────────

create or replace function public.stock_movement_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'рух складу % не можна змінити або видалити: помилку виправляють сторнуючим рухом',
    coalesce(old.id, new.id)
    using hint = 'Створіть зустрічний рух того ж обсягу зі зворотним знаком.';
end;
$function$;

revoke all on function public.stock_movement_guard() from public;

drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.stock_movement_guard();

-- Шапка проведённой накладной — тоже документ.
create or replace function public.stock_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if coalesce(old.status, 'draft') = 'applied' then
    raise exception 'накладна % проведена: змінити або видалити її не можна', old.document_number
      using hint = 'Виправлення проводиться окремим документом або сторнуючим рухом.';
  end if;
  return coalesce(new, old);
end;
$function$;

revoke all on function public.stock_receipt_guard() from public;

drop trigger if exists stock_receipts_applied_immutable on public.stock_receipts;
create trigger stock_receipts_applied_immutable
  before update or delete on public.stock_receipts
  for each row execute function public.stock_receipt_guard();

-- ── В. Стоимость склада считает и расходники ───────────────────────────────
--
-- 0029 чинила эти представления на предмет утечки себестоимости между
-- арендаторами — фильтр по арендатору не ослабляем, он остаётся в обеих
-- половинах объединения. Тест 06_isolation это проверяет.

drop view if exists public.stock_value_view;

create view public.stock_value_view as
  with rows_all as (
    select v.tenant_id,
           v.stock_qty::numeric                                  as qty,
           v.stock_qty::numeric * coalesce(v.cost, 0)            as cost_value,
           v.stock_qty::numeric * coalesce(v.price, 0)           as retail_value,
           v.min_stock_threshold::numeric                        as threshold
      from public.offering_variants v
     where v.track_stock and v.is_active
       and v.tenant_id in (select public.tenants_with('stock.read'))
    union all
    select m.tenant_id,
           m.current_stock,
           m.current_stock * coalesce(m.cost_per_unit, 0),
           -- У расходника нет цены продажи: он не продаётся, а тратится.
           -- Ноль здесь честнее, чем себестоимость во второй колонке.
           0::numeric,
           m.min_stock_threshold
      from public.materials m
     where m.is_active
       and m.tenant_id in (select public.tenants_with('stock.read'))
  )
  select tenant_id,
         sum(qty)                                                     as units,
         sum(cost_value)                                              as cost_value,
         sum(retail_value)                                            as retail_value,
         count(*) filter (where qty <= 0)                             as out_of_stock,
         count(*) filter (where threshold > 0 and qty <= threshold)   as low_stock
    from rows_all
   group by tenant_id;

alter view public.stock_value_view set (security_barrier = true);
revoke all on public.stock_value_view from anon, authenticated, public;
grant select on public.stock_value_view to authenticated;
