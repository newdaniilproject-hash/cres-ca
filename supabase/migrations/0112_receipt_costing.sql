-- 0112. Себестоимость считается из приёмок.
--
-- ── Откуда ──────────────────────────────────────────────────────────────────
--
-- Долг назван в CLAUDE.md с самого начала: «себестоимость из приёмок» —
-- в списке «осталось по складу». Цена в строке приёмки (`unit_cost`)
-- собирается с 0003, но никуда не идёт: проведение приёмки двигало только
-- остаток. Себестоимость на карточке (`materials.cost_per_unit`,
-- `offering_variants.cost`) жила отдельной ручной цифрой, которая устаревала
-- в день первой закупки по новой цене.
--
-- ── Правило пересчёта ───────────────────────────────────────────────────────
--
-- Средневзвешенная по остатку НА МОМЕНТ проведения строки:
--
--     новая = (остаток × старая + количество × цена строки)
--             / (остаток + количество)
--
-- Это единственный метод, который не требует партионного учёта себестоимости
-- (FIFO потребовал бы помнить, из какой приёмки каждая списанная единица, —
-- отдельная система) и при этом честен: полсклада по 100 и полсклада по 200
-- дают 150, а не «последняя цена победила».
--
-- Три оговорки, каждая — решение, а не случайность:
--
-- 1. Строка БЕЗ цены себестоимость не трогает. Цена в приёмке необязательна
--    (мастер заносит вчерашнюю коробку без накладной), и «нет цены» означает
--    «не знаю», а не «ноль». Ноль в формуле размыл бы себестоимость вникуда.
-- 2. Если старой себестоимости нет — берётся цена строки целиком, каким бы
--    ни был остаток: усреднять новую цену с неизвестным нечестно, а первый
--    известный факт лучше пустоты.
-- 3. Ручная правка на карточке ОСТАЁТСЯ: продавец знает про свой склад
--    больше формулы. Приёмка обновляет цифру при проведении, ручная правка
--    живёт между приёмками. Последний, кто знал факт, побеждает.
--
-- Пересчёт стоит ДО record_stock_movement той же строки: формуле нужен
-- остаток до прихода, а движение его уже увеличит.
--
-- `create or replace` поверх своей же функции 0003 — тело действующей
-- прочитано, всё, чего правка не касается, перенесено дословно
-- (правило письма миграций: «пишешь or replace — прочитай действующее тело»).

create or replace function public.apply_stock_receipt(p_receipt_id uuid)
returns public.stock_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.stock_receipts;
  v_line    record;
  v_lines   int;
  v_stock   numeric;
  v_cost    numeric;
begin
  select * into v_receipt from public.stock_receipts
   where id = p_receipt_id for update;

  if not found then
    raise exception 'приёмка % не найдена', p_receipt_id;
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'приёмка % в статусе % — уже проведена или отменена', p_receipt_id, v_receipt.status;
  end if;
  if not public.tenant_can(v_receipt.tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', v_receipt.tenant_id;
  end if;

  select count(*) into v_lines from public.stock_receipt_lines where receipt_id = p_receipt_id;
  if v_lines = 0 then
    raise exception 'в приёмке % нет ни одной строки', p_receipt_id;
  end if;

  for v_line in
    select * from public.stock_receipt_lines where receipt_id = p_receipt_id
  loop
    -- Себестоимость — до движения: формуле нужен остаток ДО прихода.
    if v_line.unit_cost is not null then
      if v_line.material_id is not null then
        select current_stock, cost_per_unit into v_stock, v_cost
          from public.materials where id = v_line.material_id for update;
        update public.materials
           set cost_per_unit = case
                 when v_cost is null or coalesce(v_stock, 0) <= 0 then v_line.unit_cost
                 else round((v_stock * v_cost + v_line.quantity * v_line.unit_cost)
                            / (v_stock + v_line.quantity), 4)
               end
         where id = v_line.material_id;
      else
        select stock_qty, cost into v_stock, v_cost
          from public.offering_variants where id = v_line.variant_id for update;
        update public.offering_variants
           set cost = case
                 when v_cost is null or coalesce(v_stock, 0) <= 0 then v_line.unit_cost
                 else round((v_stock * v_cost + v_line.quantity * v_line.unit_cost)
                            / (v_stock + v_line.quantity), 4)
               end
         where id = v_line.variant_id;
      end if;
    end if;

    perform public.record_stock_movement(
      p_tenant_id      => v_receipt.tenant_id,
      p_movement_type  => 'receipt',
      p_quantity       => v_line.quantity,
      p_variant_id     => v_line.variant_id,
      p_material_id    => v_line.material_id,
      p_reference_type => 'stock_receipt',
      p_reference_id   => p_receipt_id,
      p_receipt_id     => p_receipt_id,
      p_note           => v_receipt.note
    );
  end loop;

  update public.stock_receipts
     set status = 'applied', applied_at = now(), applied_by = auth.uid()
   where id = p_receipt_id
   returning * into v_receipt;

  return v_receipt;
end;
$$;

-- Права — как выдавала 0004 и только они: три revoke, потом одно grant.
revoke execute on function public.apply_stock_receipt(uuid) from public;
revoke execute on function public.apply_stock_receipt(uuid) from anon;
revoke execute on function public.apply_stock_receipt(uuid) from authenticated;
grant  execute on function public.apply_stock_receipt(uuid) to authenticated;
