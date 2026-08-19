-- 0113. Перемещение позиции в другое место хранения — со следом в журнале.
--
-- ── Откуда ──────────────────────────────────────────────────────────────────
--
-- Долг из CLAUDE.md: «перемещение между местами хранения». Модель мест
-- одноместная с 0009: у засоба и у варианта ОДНА колонка `location_id`,
-- остаток по местам не разложен. Значит «перемещение» здесь — перенос
-- позиции целиком, а не делёж количества: частичное перемещение потребовало
-- бы остатков по каждому месту, то есть другой модели учёта. Это решение,
-- а не упрощение: у салона места хранения — «полиця», «шафа», «кабінет»,
-- и банка стоит в одном из них.
--
-- ── В чём была дыра ─────────────────────────────────────────────────────────
--
-- Место УЖЕ менялось — селектом в форме правки засоба — но МОЛЧА: ни журнал
-- движений, ни какой-либо другой след не знали, что банку перенесли.
-- Для склада с материальной ответственностью «кто и когда перенёс» — не
-- украшение: при недостаче первым делом спрашивают, где вещь лежала.
--
-- Типы `transfer_in` / `transfer_out` лежали в enum движений с 0003
-- МЁРТВЫМИ — ни одна функция их не писала. Эта миграция — их единственный
-- потребитель: перенос пишет пару «-всё со старого места / +всё на новое».
-- Сумма пары — ноль, остаток не меняется, кэш пересчитывается сам через
-- record_stock_movement; в журнале остаётся, кто, когда и куда.
--
-- Перенос при НУЛЕВОМ остатке журнал не трогает (движение с нулём запрещено
-- проверкой знака) — меняется только колонка. Это честно: перемещение нуля
-- ничего не перемещает.
--
-- Прямую правку `location_id` мимо функции эта миграция НЕ запрещает:
-- форма правки засоба остаётся рабочей (там место задают при заведении).
-- След обязан появляться у осознанного действия «перемістити» на карточке —
-- для него и функция.

create or replace function public.relocate_stock(
  p_material_id uuid default null,
  p_variant_id  uuid default null,
  p_location_id uuid default null,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_stock    numeric;
  v_name     text;
  v_from_id  uuid;
  v_from     text;
  v_to       text;
begin
  if (p_material_id is null) = (p_variant_id is null) then
    raise exception 'укажите ровно один из material_id / variant_id';
  end if;

  if p_material_id is not null then
    select tenant_id, current_stock, name, location_id
      into v_tenant, v_stock, v_name, v_from_id
      from public.materials where id = p_material_id for update;
  else
    select tenant_id, stock_qty, name, location_id
      into v_tenant, v_stock, v_name, v_from_id
      from public.offering_variants where id = p_variant_id for update;
  end if;

  if v_tenant is null then
    raise exception 'позиція не знайдена';
  end if;
  if not public.tenant_can(v_tenant, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', v_tenant;
  end if;

  -- Целевое место обязано существовать, быть живым и принадлежать тому же
  -- заведению: чужой uuid в параметре — это попытка увести позицию.
  -- p_location_id = null разрешён: «прибрати з місця» — тоже перенос.
  if p_location_id is not null then
    select name into v_to from public.storage_locations
     where id = p_location_id and tenant_id = v_tenant and is_active;
    if v_to is null then
      raise exception 'місце зберігання не знайдено в цьому закладі';
    end if;
  end if;

  if p_location_id is not distinct from v_from_id then
    raise exception 'позиція вже в цьому місці';
  end if;

  select name into v_from from public.storage_locations where id = v_from_id;

  -- Пара движений — только когда есть чему двигаться.
  if coalesce(v_stock, 0) > 0 then
    perform public.record_stock_movement(
      p_tenant_id     => v_tenant,
      p_movement_type => 'transfer_out',
      p_quantity      => -v_stock,
      p_variant_id    => p_variant_id,
      p_material_id   => p_material_id,
      p_reference_type=> 'relocation',
      p_note          => concat_ws(' · ',
        format('переміщення: %s → %s', coalesce(v_from, '—'), coalesce(v_to, '—')),
        nullif(btrim(coalesce(p_note, '')), '')));
    perform public.record_stock_movement(
      p_tenant_id     => v_tenant,
      p_movement_type => 'transfer_in',
      p_quantity      => v_stock,
      p_variant_id    => p_variant_id,
      p_material_id   => p_material_id,
      p_reference_type=> 'relocation',
      p_note          => concat_ws(' · ',
        format('переміщення: %s → %s', coalesce(v_from, '—'), coalesce(v_to, '—')),
        nullif(btrim(coalesce(p_note, '')), '')));
  end if;

  if p_material_id is not null then
    update public.materials set location_id = p_location_id where id = p_material_id;
  else
    update public.offering_variants set location_id = p_location_id where id = p_variant_id;
  end if;
end;
$$;

revoke execute on function public.relocate_stock(uuid, uuid, uuid, text) from public;
revoke execute on function public.relocate_stock(uuid, uuid, uuid, text) from anon;
revoke execute on function public.relocate_stock(uuid, uuid, uuid, text) from authenticated;
grant  execute on function public.relocate_stock(uuid, uuid, uuid, text) to authenticated;
