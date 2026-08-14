-- 0030 — consume_materials_for_variant списывала СВОИ материалы
--        по ЧУЖОЙ рецептуре.
--
-- ⚠️ НОМЕР. Задание называло эту миграцию «0026 с timestamp-префиксом».
-- И то и другое неверно для этого репозитория, поэтому взят 0030:
--   • 0026 и 0027 ЗАНЯТЫ (`0026_profile_identity_consents`,
--     `0027_register_tenant_slug_case_fix`). В списке миграций Supabase они
--     записаны без номеров — оттуда и взялось «после 0025 шли две именованные»;
--     в git они пронумерованы, и файл 0026 создать нельзя;
--   • 0028 и 0029 добавлены тем же днём (citext-фикс уведомлений и утечка
--     складских отчётов);
--   • timestamp-префикса нет НИ У ОДНОГО файла в `supabase/migrations/` —
--     формат здесь `NNNN_имя.sql`. Введи его один файл — и порядок сортировки
--     разъедется на глазок между двумя соглашениями.
--
-- ЧТО БЫЛО НЕ ТАК. Рецептура выбиралась только по variant_id:
--
--     select material_id, quantity_per_unit
--       from public.variant_materials
--      where variant_id = p_variant_id     -- без сверки с p_tenant_id
--
-- а списание шло в p_tenant_id. Значит сотрудник салона А, имея ЛЕГАЛЬНОЕ
-- право stock.write в своём салоне, мог передать variant_id из салона Б
-- и списать свои материалы по чужой рецептуре. Права при этом нигде
-- не нарушались: record_stock_movement внутри проверяет
-- tenant_can(p_tenant_id, 'stock.write'), и проверка проходила честно.
--
-- Это не утечка наружу, это порча складского учёта — а склад в этом
-- продукте объявлен источником правды (правило 5). Побочно: по числу
-- и составу вернувшихся строк stock_movements читается чужая рецептура.
--
-- ВТОРАЯ ДЫРА В ТОЙ ЖЕ ФУНКЦИИ. Если у варианта НЕТ строк в
-- variant_materials, цикл не выполняется ни разу, record_stock_movement
-- не вызывается — и функция отрабатывала вообще без единой проверки прав,
-- молча вернув пустоту с кодом успеха. Единственная защита была
-- транзитивной, и при пустой рецептуре её просто не существовало.
--
-- ПОРЯДОК ПРОВЕРОК ВАЖЕН: сначала права, потом принадлежность варианта.
-- Наоборот нельзя — сообщение «вариант не найден» само становится
-- оракулом, по которому перебором выясняется, какие variant_id
-- существуют в чужих арендаторах.
--
-- CREATE OR REPLACE, а не DROP+CREATE: иначе слетят гранты
-- authenticated/service_role. Сигнатура не меняется ни на символ,
-- включая `default null` у p_note. Тексты исключений — дословно те же,
-- что у соседей (record_stock_movement 0003, reserve_stock_internal 0006):
-- единый стиль сообщений в проекте ломать не надо.

create or replace function public.consume_materials_for_variant(
  p_tenant_id      uuid,
  p_variant_id     uuid,
  p_units          numeric,
  p_reference_type text,
  p_reference_id   uuid,
  p_note           text default null
)
returns setof public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
begin
  if p_units <= 0 then
    raise exception 'количество единиц должно быть положительным';
  end if;

  -- Права — ПЕРВЫМИ. При пустой рецептуре это единственная проверка,
  -- которая вообще случится: цикл ниже не выполнится ни разу.
  if not public.tenant_can(p_tenant_id, 'stock.write') then
    raise exception 'недостаточно прав: stock.write в арендаторе %', p_tenant_id;
  end if;

  -- Принадлежность варианта — ВТОРОЙ. Ради этой проверки и написана
  -- миграция: без неё чужой variant_id приносил чужую рецептуру.
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
$$;

-- Правило 7: Postgres выдаёт EXECUTE роли PUBLIC на каждую новую функцию.
-- CREATE OR REPLACE существующие гранты сохраняет, но повторяем явно —
-- чтобы состав прав читался из файла, а не восстанавливался по истории.
revoke execute on function public.consume_materials_for_variant(uuid, uuid, numeric, text, uuid, text) from public;
revoke execute on function public.consume_materials_for_variant(uuid, uuid, numeric, text, uuid, text) from anon;
grant  execute on function public.consume_materials_for_variant(uuid, uuid, numeric, text, uuid, text) to authenticated;
