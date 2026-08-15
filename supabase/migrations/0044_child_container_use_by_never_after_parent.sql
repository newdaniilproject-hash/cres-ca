-- 0044. Розлив «омолаживал» косметику: дочерняя ёмкость получала срок
-- ПОЗЖЕ материнской банки.
--
-- ЧТО БЫЛО. decant_container ставил дочерней opened_at = now() и копировал
-- pao_months родителя. containers_guard считает use_by как
-- least(срок партии, вскрытие + PAO) — то есть для дочерней PAO отсчитывался
-- ОТ ДАТЫ РОЗЛИВА, а не от вскрытия исходной банки.
-- Замер на боевых данных до этой миграции:
--   C-0007 «Маска відновлююча», вскрыта 27.11.2025, PAO 9 мес,
--   партия MS-2554 годна до 28.02.2027  ->  родитель годен до 27.08.2026;
--   дозатор, разлитый из неё 15.08.2026 -> годен до 28.02.2027.
-- Дочерняя ёмкость «жила» на полгода дольше банки, из которой налита.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. Косметика в дозаторе не может быть свежее косметики
-- в банке: это физически один и тот же продукт, вскрытый один раз.
-- Отсчёт PAO заново при переливе — это подделка срока годности.
--
-- ЧЕМ ГРОЗИЛО. Для проверки МОЗ это хуже утечки данных: журнал ёмкостей
-- сам, машинально, документирует использование просроченного продукта как
-- «годного». Плюс предупреждения за 14/7 дней по дозатору уходили с
-- неверной датой, то есть маскировали просрочку вместо того, чтобы её
-- ловить.
--
-- ЧТО СТАЛО. Правило: срок дочерней ёмкости НИКОГДА не позже срока
-- родителя. use_by дочерней = least(use_by родителя, срок партии,
-- дата розлива + PAO).
--
-- ГДЕ ЭТО СДЕЛАНО И ПОЧЕМУ ИМЕННО ТАМ. Правило поставлено в
-- containers_guard — триггер BEFORE INSERT OR UPDATE на самой таблице, а
-- не в decant_container. Обоснование: decant_container — лишь один из
-- способов завести дочернюю ёмкость. Строку с parent_id можно вставить
-- напрямую (у роли с compliance.write/compliance.journal.write есть
-- INSERT по RLS) или подставить parent_id при UPDATE. Правило в функции
-- обходится тривиально, правило в триггере не обходится ничем, что идёт
-- через SQL. Проверено: прямой insert дочерней с pao_months = 99
-- всё равно даёт use_by = срок родителя.
--
-- Дополнительно:
--  * decant_container теперь СНАЧАЛА обновляет родителя (объём и, если
--    он был sealed, статус opened) и только потом вставляет дочернюю.
--    Порядок важен: вскрытие родителя само пересчитывает его use_by
--    (вскрытие + PAO), и дочерняя должна равняться на уже пересчитанный
--    срок, а не на прежний. Раньше дочерняя вставлялась первой и видела
--    старый, более длинный срок родителя.
--  * добавлен каскад material_containers_use_by_cascade (AFTER UPDATE OF
--    use_by): если срок родителя укоротился задним числом (например,
--    перепривязали партию), дети подтягиваются следом. Каскад в AFTER,
--    а не в BEFORE, потому что в BEFORE родительская строка ещё не
--    записана и ребёнок прочитал бы старый срок. Условие
--    «use_by is null or use_by > new.use_by» делает срок строго
--    убывающим — рекурсия по дереву гарантированно завершается.
--  * запрещён parent_id = id (ёмкость сама себе родитель) — это
--    единственный способ зациклить каскад на одной строке.

create or replace function public.containers_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_pao    int;
  v_expiry date;
  v_name   text;
  v_parent date;
begin
  -- Факт вскрытия не переписывается и не стирается: это запись журнала,
  -- а не поле настроек. Ошиблись банкой — списывают её и заводят новую.
  if tg_op = 'UPDATE' and old.opened_at is not null
     and new.opened_at is distinct from old.opened_at then
    raise exception 'дата вскрытия не редактируется: ошибочную ёмкость списывают, а не переоткрывают';
  end if;

  if new.status in ('opened') and new.opened_at is null then
    new.opened_at := now();
  end if;
  if new.opened_at is not null and new.opened_by is null then
    new.opened_by := auth.uid();
  end if;
  if new.opened_at is not null and new.status = 'sealed' then
    new.status := 'opened';
  end if;
  if new.status = 'disposed' and new.disposed_at is null then
    new.disposed_at := now();
    new.disposed_by := coalesce(new.disposed_by, auth.uid());
  end if;

  -- use_by: меньшая из дат «срок партии» и «вскрытие + PAO».
  select coalesce(new.pao_months, m.pao_months), m.name
    into v_pao, v_name
    from public.materials m where m.id = new.material_id;
  select b.expiry_date into v_expiry
    from public.material_batches b where b.id = new.batch_id;

  new.use_by := least(
    v_expiry,
    case when new.opened_at is not null and v_pao is not null
         then (new.opened_at + make_interval(months => v_pao))::date
         end
  );

  -- Дочерняя ёмкость не может быть «свежее» родителя: перелив не
  -- обнуляет PAO, продукт вскрыт один раз (0044). least() игнорирует
  -- NULL, поэтому не заданный срок родителя ничего не ограничивает,
  -- а не заданный срок ребёнка наследует родительский.
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'ёмкость % не может быть собственным родителем', new.code;
    end if;
    select p.use_by into v_parent
      from public.material_containers p where p.id = new.parent_id;
    new.use_by := least(new.use_by, v_parent);
  end if;

  -- Срок изменился (например, привязали другую партию) — старые
  -- предупреждения с прежней датой больше не верны, гасим.
  if tg_op = 'UPDATE' and new.use_by is distinct from old.use_by then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  if new.use_by is not null and new.status in ('sealed','opened') then
    perform public.enqueue_expiry_warnings(
      new.tenant_id, new.id, new.code, v_name, new.use_by);
  end if;

  -- Списанная/закончившаяся ёмкость гасит свои неотправленные предупреждения.
  if new.status in ('finished','disposed') then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  return new;
end;
$fn$;

revoke all on function public.containers_guard() from public;
grant execute on function public.containers_guard() to service_role;

create or replace function public.containers_propagate_use_by()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  -- Значение справа неважно: пересчёт всё равно сделает containers_guard,
  -- нам нужен сам факт UPDATE, чтобы ребёнок перечитал срок родителя.
  update public.material_containers c
     set use_by = c.use_by
   where c.parent_id = new.id
     and (c.use_by is null or c.use_by > new.use_by);
  return null;
end;
$fn$;

revoke all on function public.containers_propagate_use_by() from public;
grant execute on function public.containers_propagate_use_by() to service_role;

drop trigger if exists material_containers_use_by_cascade on public.material_containers;
create trigger material_containers_use_by_cascade
after update of use_by on public.material_containers
for each row
when (new.use_by is distinct from old.use_by)
execute function public.containers_propagate_use_by();

create or replace function public.decant_container(p_parent_id uuid, p_volume numeric, p_note text default null)
returns public.material_containers
language plpgsql
security definer
set search_path to ''
as $fn$
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

  -- Родитель обновляется ПЕРВЫМ: если он был sealed, вскрытие пересчитает
  -- его use_by, и дочерняя должна равняться на новый срок (0044).
  update public.material_containers
     set volume = volume - p_volume,
         status = case when status = 'sealed' then 'opened'::public.container_status else status end
   where id = v_parent.id
  returning * into v_parent;

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

  return v_child;
end;
$fn$;

revoke all on function public.decant_container(uuid,numeric,text) from public;
grant execute on function public.decant_container(uuid,numeric,text) to authenticated, service_role;
