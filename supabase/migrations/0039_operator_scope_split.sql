-- 0039 — права мастера были шире, чем отдаёт ТЗ.
--
-- ЧТО БЫЛО. ТЗ отдаёт мастеру ровно четыре вещи: сканирование, фиксация
-- вскрытия и розлива, отметки о дезинфекции и ПРОСМОТР техкарт.
-- У роли operator в role_grants лежали stock.write и compliance.write.
-- Проверено попыткой под JWT мастера ДО правки — он мог всё девять из девяти:
--   записать уборку, вскрыть банку, разлить, списать расход,
--   ОФОРМИТЬ ПРИХОД НА СКЛАД, ЗАВЕСТИ МАТЕРИАЛ, УТВЕРДИТЬ ТЕХКАРТУ,
--   ЗАВЕСТИ ПОСТАВЩИКА, СОЗДАТЬ ЗАДАЧУ УБОРКИ.
-- Последние пять — не его работа ни по ТЗ, ни по смыслу.
--
-- ЧЕМ ГРОЗИЛО. Техкарта — это утверждённый регламент, по которому потом
-- отвечают перед проверкой; мастер мог завести свою версию и «утвердить» её
-- собой же. Реестр материалов и поставщики — коммерческая часть: правка
-- cost_per_unit мастером ломает и себестоимость, и доверие к журналу цен.
-- Задачи уборки — это расписание, за которое отвечает управляющий: мастер мог
-- завести задачу под себя вместо той, которую не выполнил.
--
-- ПОЧЕМУ НЕЛЬЗЯ ПРОСТО СНЯТЬ compliance.write. Именно на этом праве висят
-- политики вставки во все три санитарных журнала (cleaning_entries,
-- sanitation_solutions, sterilization_cycles) и вставка/изменение ёмкостей.
-- Снять целиком — значит запретить мастеру отмечать дезинфекцию и вскрывать
-- банки, то есть сломать ровно то, что ТЗ от него и требует.
--
-- РЕШЕНИЕ — РАЗДЕЛИТЬ ПРАВО ПО ПРИРОДЕ ДЕЙСТВИЯ, а не по таблицам.
-- Введено compliance.journal.write — «делать записи в журналах»:
-- отметки уборки, дезраствора, стерилизации, вскрытие и розлив ёмкостей.
-- Всё это — НЕИЗМЕНЯЕМЫЕ ФАКТЫ: journal_guard запрещает их править и удалять,
-- containers_guard запрещает переписывать дату вскрытия. Ошибиться такой
-- записью можно, подделать историю — нет, поэтому право безопасно отдавать
-- рядовому сотруднику.
-- За compliance.write остаётся то, что МЕНЯЕТ НОРМУ, а не фиксирует факт:
-- техкарты, документы, партии, справочник задач уборки. Это работа
-- управляющего, и она у мастера отобрана.
--
-- ВТОРАЯ ПОЛОВИНА — СКЛАД. Снятие stock.write в лоб ломало живой сценарий,
-- который ТЗ не упоминает, но который работает у клиента: set_booking_status
-- при переводе записи в 'completed' зовёт consume_materials_for_variant,
-- а та — record_stock_movement, требующую stock.write. Мастер с orders.write
-- закрывает свою запись сам; без stock.write он получил бы отказ и не смог бы
-- завершить услугу вообще. Молча оставить это сломанным нельзя.
-- Поэтому введено stock.consume — «списать по факту оказанной услуги».
-- record_stock_movement принимает его СТРОГО в одном случае: тип движения
-- write_off И количество отрицательное. То есть с этим правом остаток можно
-- только уменьшить по расходу, но нельзя оформить приход, инвентаризацию
-- или корректировку в плюс — то, чем можно было бы прикрыть недостачу.
-- Это строго уже, чем stock.write, которое было у мастера раньше.
--
-- ИЕРАРХИЯ РОЛЕЙ СОХРАНЕНА: оба новых права выданы owner, admin, manager
-- и operator. Роль выше по иерархии не должна уметь меньше, чем роль ниже,
-- иначе следующая проверка прав в коде начнёт врать. Владельцу — по правилу
-- 0034: в role_grants у него обязаны быть все существующие права.
--
-- ПРОВЕРЕНО ПОПЫТКОЙ ПОСЛЕ ПРАВКИ, по каждой роли, девять операций:
--   мастер МОЖЕТ:     записать уборку, вскрыть банку, разлить, списать расход;
--   мастер НЕ МОЖЕТ:  приход на склад, завести материал, утвердить техкарту,
--                     завести поставщика, создать задачу уборки.
--   owner/admin/manager — все девять, как и до правки, ни одной потери;
--   accountant/viewer/inspector — ни одной из девяти, как и до правки.

-- ── 1. Новые права ────────────────────────────────────────────────────────────
insert into public.role_grants (role, permission)
select r::public.member_role, p
  from unnest(array['owner','admin','manager','operator']) r,
       unnest(array['compliance.journal.write','stock.consume']) p
on conflict do nothing;

-- ── 2. Журналы: запись факта — по compliance.journal.write ────────────────────
-- Право compliance.write ОСТАВЛЕНО в условии рядом, а не заменено. Так никто
-- не потеряет доступ из-за поимённого переопределения в tenant_members.permissions.
drop policy if exists cleaning_entries_insert on public.cleaning_entries;
create policy cleaning_entries_insert on public.cleaning_entries
  for insert to authenticated
  with check ((tenant_id in (select public.tenants_with('compliance.write'))
               or tenant_id in (select public.tenants_with('compliance.journal.write')))
              and performed_by = (select auth.uid()));

drop policy if exists sanitation_solutions_insert on public.sanitation_solutions;
create policy sanitation_solutions_insert on public.sanitation_solutions
  for insert to authenticated
  with check ((tenant_id in (select public.tenants_with('compliance.write'))
               or tenant_id in (select public.tenants_with('compliance.journal.write')))
              and prepared_by = (select auth.uid()));

drop policy if exists sterilization_cycles_insert on public.sterilization_cycles;
create policy sterilization_cycles_insert on public.sterilization_cycles
  for insert to authenticated
  with check ((tenant_id in (select public.tenants_with('compliance.write'))
               or tenant_id in (select public.tenants_with('compliance.journal.write')))
              and performed_by = (select auth.uid()));

-- Ёмкости: завести, вскрыть, разлить — тоже фиксация факта.
drop policy if exists material_containers_insert on public.material_containers;
create policy material_containers_insert on public.material_containers
  for insert to authenticated
  with check ((tenant_id in (select public.tenants_with('compliance.write'))
               or tenant_id in (select public.tenants_with('compliance.journal.write')))
              and created_by = (select auth.uid()));

drop policy if exists material_containers_update on public.material_containers;
create policy material_containers_update on public.material_containers
  for update to authenticated
  using (tenant_id in (select public.tenants_with('compliance.write'))
         or tenant_id in (select public.tenants_with('compliance.journal.write')))
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              or tenant_id in (select public.tenants_with('compliance.journal.write')));

-- ── 3. Расход по услуге — по stock.consume, только в минус ────────────────────
create or replace function public.record_stock_movement(p_tenant_id uuid, p_movement_type stock_movement_type, p_quantity numeric, p_variant_id uuid DEFAULT NULL::uuid, p_material_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_receipt_id uuid DEFAULT NULL::uuid, p_count_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 returns stock_movements
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_row   public.stock_movements;
  v_actor uuid := auth.uid();
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
    raise exception 'позиция не найдена в арендаторе %', p_tenant_id;
  end if;

  return v_row;
end;
$function$;

revoke all on function public.record_stock_movement(uuid, stock_movement_type, numeric, uuid, uuid, text, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, stock_movement_type, numeric, uuid, uuid, text, uuid, uuid, uuid, text, text) to authenticated, service_role;

-- ── 4. Розлив: право журнала тоже подходит ────────────────────────────────────
create or replace function public.decant_container(p_parent_id uuid, p_volume numeric, p_note text default null)
returns public.material_containers
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_parent public.material_containers;
  v_child  public.material_containers;
  v_number bigint;
  v_code   text;
  v_actor  uuid := auth.uid();
  v_try    int;
begin
  if v_actor is null then
    raise exception 'розлив требует авторизованного пользователя';
  end if;
  if p_volume is null or p_volume <= 0 then
    raise exception 'объём розлива должен быть положительным';
  end if;

  select * into v_parent from public.material_containers where id = p_parent_id for update;
  if not found then
    raise exception 'ёмкость % не найдена', p_parent_id;
  end if;

  if not (public.tenant_can(v_parent.tenant_id, 'compliance.journal.write')
       or public.tenant_can(v_parent.tenant_id, 'compliance.write')
       or public.tenant_can(v_parent.tenant_id, 'stock.write')) then
    raise exception 'недостаточно прав: compliance.journal.write, compliance.write или stock.write в арендаторе %', v_parent.tenant_id;
  end if;

  if v_parent.status in ('finished', 'disposed') then
    raise exception 'ёмкость % в состоянии % — розлив невозможен', v_parent.code, v_parent.status;
  end if;

  if v_parent.volume is null then
    raise exception 'у ёмкости % не задан объём — розлив не посчитать', v_parent.code;
  end if;
  if p_volume >= v_parent.volume then
    raise exception 'в ёмкости % осталось %, розлить % нельзя: остаток родителя не может стать нулевым — пустую ёмкость закрывают статусом finished',
      v_parent.code, v_parent.volume, p_volume;
  end if;

  for v_try in 1..10 loop
    insert into public.container_counters (tenant_id) values (v_parent.tenant_id)
    on conflict (tenant_id) do nothing;
    update public.container_counters
       set last_number = last_number + 1
     where tenant_id = v_parent.tenant_id
    returning last_number into v_number;

    v_code := 'C-' || lpad(v_number::text, 4, '0');
    exit when not exists (select 1 from public.material_containers c
                           where c.tenant_id = v_parent.tenant_id and c.code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'не удалось подобрать свободный код ёмкости в арендаторе %', v_parent.tenant_id;
  end if;

  insert into public.material_containers
    (tenant_id, material_id, batch_id, code, parent_id, volume, unit, status,
     opened_at, opened_by, decanted_at, pao_months, note, created_by)
  values
    (v_parent.tenant_id, v_parent.material_id, v_parent.batch_id, v_code, v_parent.id,
     p_volume, v_parent.unit, 'opened',
     now(), v_actor, now(), v_parent.pao_months, p_note, v_actor)
  returning * into v_child;

  update public.material_containers
     set volume = volume - p_volume,
         status = case when status = 'sealed' then 'opened'::public.container_status else status end
   where id = v_parent.id;

  return v_child;
end;
$function$;

revoke all on function public.decant_container(uuid, numeric, text) from public, anon;
grant execute on function public.decant_container(uuid, numeric, text) to authenticated, service_role;

-- ── 5. И только теперь сузить мастера ─────────────────────────────────────────
-- Порядок важен: сначала выданы замещающие права и переписаны политики,
-- потом снято лишнее. Наоборот — это окно, в котором мастер не может работать.
delete from public.role_grants
 where role = 'operator'
   and permission in ('stock.write', 'compliance.write');

-- ВНИМАНИЕ НА БУДУЩЕЕ. Право compliance.journal.write новое, и в интерфейсе
-- его никто не проверяет. Пока фронт спрашивает только compliance.write,
-- кнопки журналов у мастера могут быть скрыты, хотя база запись разрешает.
-- Это правка выше уровня базы и делается отдельно.
