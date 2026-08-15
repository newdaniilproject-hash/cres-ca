-- 0049. record_stock_movement оставлял открытой калитку для прямой
-- правки остатков до конца транзакции.
--
-- ЧТО БЫЛО. Остаток защищён триггером guard_stock_columns: прямые правки
-- materials.current_stock и offering_variants.stock_qty/reserved_qty
-- запрещены, кроме случая, когда выставлен транзакционный флаг
-- vitrina.allow_stock_write = 'on'. record_stock_movement выставляла этот
-- флаг перед своим апдейтом (set_config(..., is_local => true)) и НЕ
-- возвращала его обратно.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. is_local = true означает «до конца транзакции», а не
-- «до конца функции». После первого же законного движения остатка защита
-- переставала действовать на всю оставшуюся транзакцию.
--
-- ЧЕМ ГРОЗИЛО. Правило «остаток меняется только функциями из
-- 0003_inventory.sql» переставало быть правилом. Любой следующий оператор
-- в той же транзакции мог написать остаток руками, минуя журнал движений:
-- складские книги и stock_movements расходятся, причину расхождения
-- в аудите не найти. Замер до этой миграции: после
-- record_stock_movement(write_off, -1) прямой
-- «update materials set current_stock = current_stock + 1000» проходил,
-- остаток 2000 -> 2999.
--
-- ЧТО СТАЛО. Флаг сохраняется и восстанавливается, а не гасится жёстко
-- в 'off'. Восстановление, а не обнуление — потому что вызовы бывают
-- вложенными: consume_materials_for_variant крутит record_stock_movement
-- в цикле по рецептуре, а внешняя функция может держать флаг для
-- собственного апдейта. Жёсткий 'off' во внутреннем вызове сломал бы
-- внешний; возврат прежнего значения безопасен при любой вложенности.
-- Восстановление стоит и на ветке «позиция не найдена» — до raise,
-- иначе исключение унесло бы флаг с собой.
--
-- Проверено после применения: флаг после вызова пуст, прямой апдейт
-- остатка отбивается («current_stock меняется только через
-- record_stock_movement»), повторный законный вызов функции работает.
--
-- ОСТАЁТСЯ НЕ ЗАКРЫТЫМ (осознанно, вне объёма этой задачи): тот же флаг
-- не восстанавливают reserve_stock_internal, commit_reservation,
-- release_reservation и set_order_status. Их надо править тем же
-- приёмом отдельной миграцией.

create or replace function public.record_stock_movement(
  p_tenant_id uuid,
  p_movement_type public.stock_movement_type,
  p_quantity numeric,
  p_variant_id uuid default null,
  p_material_id uuid default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_receipt_id uuid default null,
  p_count_id uuid default null,
  p_note text default null,
  p_idempotency_key text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_row   public.stock_movements;
  v_actor uuid := auth.uid();
  v_prev  text;
begin
  if v_actor is null then
    raise exception 'движение остатка требует авторизованного пользователя';
  end if;

  -- stock.consume — узкая калитка для мастера: списать израсходованное
  -- на услуге. Только write_off и только в минус. Приход, корректировка
  -- и инвентаризация по-прежнему требуют полноценного stock.write.
  if not (
        public.tenant_can(p_tenant_id, 'stock.write')
     or (p_movement_type = 'write_off' and p_quantity < 0
         and public.tenant_can(p_tenant_id, 'stock.consume'))
  ) then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;

  if (p_variant_id is null) = (p_material_id is null) then
    raise exception 'укажите ровно один из variant_id / material_id';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from public.stock_movements
     where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return v_row;  -- уже применено этим ключом — не повторяем
    end if;
  end if;

  insert into public.stock_movements
    (tenant_id, variant_id, material_id, movement_type, quantity,
     reference_type, reference_id, receipt_id, count_id, note, idempotency_key, created_by)
  values
    (p_tenant_id, p_variant_id, p_material_id, p_movement_type, p_quantity,
     p_reference_type, p_reference_id, p_receipt_id, p_count_id, p_note, p_idempotency_key, v_actor)
  returning * into v_row;

  -- Калитка для guard_stock_columns открывается ровно на один апдейт
  -- и закрывается обратно в прежнее положение (0049).
  v_prev := coalesce(current_setting('vitrina.allow_stock_write', true), '');
  perform set_config('vitrina.allow_stock_write', 'on', true);

  if p_variant_id is not null then
    update public.offering_variants
       set stock_qty = stock_qty + p_quantity
     where id = p_variant_id and tenant_id = p_tenant_id;
  else
    update public.materials
       set current_stock = current_stock + p_quantity
     where id = p_material_id and tenant_id = p_tenant_id;
  end if;

  if not found then
    perform set_config('vitrina.allow_stock_write', v_prev, true);
    raise exception 'позиция не найдена в арендаторе %', p_tenant_id;
  end if;

  perform set_config('vitrina.allow_stock_write', v_prev, true);

  return v_row;
end;
$fn$;

revoke all on function public.record_stock_movement(
  uuid,public.stock_movement_type,numeric,uuid,uuid,text,uuid,uuid,uuid,text,text) from public;
grant execute on function public.record_stock_movement(
  uuid,public.stock_movement_type,numeric,uuid,uuid,text,uuid,uuid,uuid,text,text) to authenticated, service_role;
