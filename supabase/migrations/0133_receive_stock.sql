-- 0133. Надходження БЕЗ документа — одной операцией.
--
-- ── Откуда ──────────────────────────────────────────────────────────────────
--
-- Решение владельца 30.08.2026: «приемка документа не надо, все что
-- происходит для расходника или товара — документация и прочее крепится
-- в самом расходнике или товаре».
--
-- До этого дня единственным способом УВЕЛИЧИТЬ остаток был документ
-- приёмки: завести `stock_receipts`, набить строки, провести
-- `apply_stock_receipt`. Для салона это лишний обряд: банка приезжает
-- одна, накладной нет, а мастер стоит над коробкой с телефоном.
--
-- ── Почему это не «просто record_stock_movement с типом receipt» ────────────
--
-- Потому что вместе с документом ушла бы СЕБЕСТОИМОСТЬ. Средневзвешенный
-- пересчёт (0112) живёт ровно внутри `apply_stock_receipt` и больше нигде;
-- на нём стоят «Вартість запасу» на складе, маржа позиции и P&L в финансах.
-- Убрать документ и не перенести формулу значило бы тихо заморозить
-- себестоимость на дне последней приёмки — а заметно это стало бы через
-- месяц, в отчёте, по которому принимают решения о ценах.
--
-- Поэтому формула переезжает сюда ДОСЛОВНО, вместе со всеми тремя
-- оговорками 0112, и они здесь повторены не для красоты:
--
--   1. Приход БЕЗ цены себестоимость не трогает. «Нет цены» значит
--      «не знаю», а не «ноль»; ноль размыл бы её вникуда.
--   2. Старой себестоимости нет — берётся цена прихода целиком: усреднять
--      с неизвестным нечестно, первый известный факт лучше пустоты.
--   3. Ручная правка на карточке остаётся. Последний, кто знал факт,
--      побеждает.
--
-- ── Порядок внутри, и он единственно возможный ──────────────────────────────
--
-- Идемпотентность проверяется ПЕРВОЙ, до пересчёта. Иначе повтор запроса
-- (обычное дело на телефоне и единственный смысл ключа) прошёл бы формулу
-- второй раз: движение `record_stock_movement` по тому же ключу вернула бы
-- прежнее, остаток бы не сдвинулся, а себестоимость уже уехала бы на
-- второй заход усреднения. Это ровно тот класс ошибок, ради которого ключ
-- и заводился, — только по другой величине.
--
-- Пересчёт стоит ДО движения: формуле нужен остаток ДО прихода, а движение
-- его уже увеличит.
--
-- Документ приёмки НЕ УДАЛЯЕТСЯ этой миграцией: таблицы `stock_receipts`
-- и `stock_receipt_lines` остаются, `apply_stock_receipt` работает.
-- Миграции добавляющие, сужающая идёт отдельным шагом ПОСЛЕ выката
-- (CLAUDE.md, принцип 3) — а на бою уже лежат проведённые документы,
-- и движения по ним ссылаются на `receipt_id`.

create or replace function public.receive_stock(
  p_tenant_id       uuid,
  p_quantity        numeric,
  p_material_id     uuid default null,
  p_variant_id      uuid default null,
  p_unit_cost       numeric default null,
  p_note            text default null,
  p_idempotency_key text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.stock_movements;
  v_stock numeric;
  v_cost  numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'кількість надходження має бути додатною';
  end if;

  if (p_material_id is null) = (p_variant_id is null) then
    raise exception 'укажите ровно один из material_id / variant_id';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'ціна не може бути відʼємною';
  end if;

  -- Право спрашивается ЗДЕСЬ, а не только внутри record_stock_movement:
  -- себестоимость правится до движения, и без этой проверки человек без
  -- stock.write успел бы сдвинуть цифру на карточке прежде, чем отказ
  -- прилетит от движения.
  if not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;

  -- ⚠️ ПЕРВОЙ. Разбор — в шапке файла.
  if p_idempotency_key is not null then
    select * into v_row from public.stock_movements
     where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if p_unit_cost is not null then
    if p_material_id is not null then
      select current_stock, cost_per_unit into v_stock, v_cost
        from public.materials where id = p_material_id and tenant_id = p_tenant_id
        for update;
      if not found then
        raise exception 'засіб % не знайдено в закладі %', p_material_id, p_tenant_id;
      end if;
      update public.materials
         set cost_per_unit = case
               when v_cost is null or coalesce(v_stock, 0) <= 0 then p_unit_cost
               else round((v_stock * v_cost + p_quantity * p_unit_cost)
                          / (v_stock + p_quantity), 4)
             end
       where id = p_material_id;
    else
      select stock_qty, cost into v_stock, v_cost
        from public.offering_variants where id = p_variant_id and tenant_id = p_tenant_id
        for update;
      if not found then
        raise exception 'позицію % не знайдено в закладі %', p_variant_id, p_tenant_id;
      end if;
      update public.offering_variants
         set cost = case
               when v_cost is null or coalesce(v_stock, 0) <= 0 then p_unit_cost
               else round((v_stock * v_cost + p_quantity * p_unit_cost)
                          / (v_stock + p_quantity), 4)
             end
       where id = p_variant_id;
    end if;
  end if;

  v_row := public.record_stock_movement(
    p_tenant_id       => p_tenant_id,
    p_movement_type   => 'receipt',
    p_quantity        => p_quantity,
    p_material_id     => p_material_id,
    p_variant_id      => p_variant_id,
    p_reference_type  => 'manual',
    p_note            => p_note,
    p_idempotency_key => p_idempotency_key
  );

  return v_row;
end;
$$;

-- Правило 7: у каждой функции явный revoke/grant. Postgres выдаёт EXECUTE
-- роли PUBLIC на каждую новую функцию — в этом проекте ловилось трижды.
revoke all on function public.receive_stock(uuid, numeric, uuid, uuid, numeric, text, text) from public;
revoke all on function public.receive_stock(uuid, numeric, uuid, uuid, numeric, text, text) from anon;
grant execute on function public.receive_stock(uuid, numeric, uuid, uuid, numeric, text, text)
  to authenticated, service_role;

comment on function public.receive_stock(uuid, numeric, uuid, uuid, numeric, text, text) is
  'Надходження на склад без документа: пересчитывает средневзвешенную '
  'себестоимость (формула 0112) и пишет движение receipt. Ключ '
  'идемпотентности проверяется ДО пересчёта — иначе повтор усреднил бы цену дважды.';
