-- 0042. Регрессия 0039: мастер не может закрыть запись клиента.
--
-- ЧТО БЫЛО. Миграция 0039 разделила «складские» права: у роли operator
-- (мастер) отобрали stock.write и выдали узкое stock.consume — «списать
-- израсходованное на услуге». Новое право научилась понимать ровно одна
-- функция — record_stock_movement. Шапка 0039 при этом утверждала, что
-- боевой сценарий мастера сохранён.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. Сценарий сохранён НЕ БЫЛ. Мастер не дёргает
-- record_stock_movement напрямую — он закрывает запись:
--   set_booking_status(booking,'completed')
--     -> consume_materials_for_variant(...)   -- расход по рецептуре
--       -> record_stock_movement(...)         -- по движению на строку
-- Средним звеном осталась consume_materials_for_variant, которая
-- по-прежнему требовала stock.write и проверяла право ПЕРВЫМ — до цикла
-- по рецептуре. То есть до узкой калитки 0039 управление не доходило
-- вообще: исключение вылетало этажом выше.
--
-- ЧЕМ ГРОЗИЛО. Исключение внутри set_booking_status откатывает всю
-- транзакцию целиком, вместе с уже выполненным update статуса. Мастер
-- нажимал «Услуга оказана» и получал ошибку прав, а запись оставалась
-- в прежнем статусе — незакрытой. Расходники не списывались, остаток
-- расходился с реальностью, выручка по записи не фиксировалась.
-- Воспроизведение под JWT мастера (operator) до этой миграции:
--   select public.consume_materials_for_variant(
--     '<tenant>', gen_random_uuid(), 1, 'booking', gen_random_uuid());
--   -- P0001 недостаточно прав: stock.write
--
-- ЧТО СТАЛО. consume_materials_for_variant принимает stock.consume
-- наравне со stock.write. Это не послабление: функция по смыслу и есть
-- расход по рецептуре — ровно то, ради чего stock.consume вводилось.
-- Ниже по стеку record_stock_movement всё равно пропустит по
-- stock.consume только write_off и только в минус, а именно такие
-- движения эта функция и порождает (quantity = -(норма * единицы),
-- p_units > 0 проверено выше). Приход, корректировка в плюс и
-- инвентаризация остаются за stock.write.
--
-- Прочие функции, требующие stock.write, проверены поимённо:
--   apply_stock_receipt, apply_stock_count, start_stock_count — приёмка и
--     инвентаризация, мастеру не нужны и намеренно закрыты;
--   decant_container — уже принимает compliance.journal.write, которое
--     у мастера есть, розлив работает;
--   record_stock_movement — калитка stock.consume добавлена в 0039.
-- Больше функций, обязательных мастеру и запертых за stock.write, нет.

create or replace function public.consume_materials_for_variant(
  p_tenant_id uuid,
  p_variant_id uuid,
  p_units numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_note text default null
)
returns setof public.stock_movements
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_line record;
begin
  if p_units <= 0 then
    raise exception 'количество единиц должно быть положительным';
  end if;

  -- Права — ПЕРВЫМИ. При пустой рецептуре это единственная проверка,
  -- которая вообще случится: цикл ниже не выполнится ни разу.
  -- stock.consume принимается наравне со stock.write: расход по
  -- рецептуре — это и есть то, что разрешает stock.consume (0042).
  if not (
       public.tenant_can(p_tenant_id, 'stock.write')
    or public.tenant_can(p_tenant_id, 'stock.consume')
  ) then
    raise exception 'недостаточно прав: stock.write или stock.consume в арендаторе %', p_tenant_id;
  end if;

  -- Принадлежность варианта — ВТОРОЙ. Ради этой проверки и написана
  -- миграция 0030: без неё чужой variant_id приносил чужую рецептуру.
  if not exists (
    select 1 from public.offering_variants v
     where v.id = p_variant_id
       and v.tenant_id = p_tenant_id
  ) then
    raise exception 'вариант % не найден в арендаторе %', p_variant_id, p_tenant_id;
  end if;

  for v_line in
    select material_id, quantity_per_unit
      from public.variant_materials
     where variant_id = p_variant_id
  loop
    return next public.record_stock_movement(
      p_tenant_id      => p_tenant_id,
      p_movement_type  => 'write_off',
      p_quantity       => -(v_line.quantity_per_unit * p_units),
      p_material_id    => v_line.material_id,
      p_reference_type => p_reference_type,
      p_reference_id   => p_reference_id,
      p_note           => p_note
    );
  end loop;

  return;
end;
$fn$;

revoke all on function public.consume_materials_for_variant(uuid,uuid,numeric,text,uuid,text) from public;
grant execute on function public.consume_materials_for_variant(uuid,uuid,numeric,text,uuid,text)
  to authenticated, service_role;
