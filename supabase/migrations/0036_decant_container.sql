-- 0036 — розлив в рабочий дозатор. Раздел 3.2 ТЗ отсутствовал в базе целиком.
--
-- ЧТО БЫЛО. ТЗ: «при розливі косметики з великої ємності в робочий дозатор
-- система ґенерує внутрішній QR-код для наклейки на дозатор із зазначенням
-- назви, партії, дати розливу, відповідального майстра та кінцевого терміну».
-- В базе от этого не было ничего:
--   • операции розлива нет — ни функции, ни процедуры;
--   • material_containers.parent_id заведён ещё в 0014, но пуст: 0 из 7 ёмкостей,
--     то есть связь «из какой банки налито» не заполнял никто и никогда;
--   • даты розлива не существует физически — колонки нет. opened_at говорит
--     «когда вскрыли», а не «когда перелили», и для дочернего дозатора это
--     разные события у разных людей;
--   • код ёмкости забивался руками, и уникальность (tenant_id, code) держалась
--     на аккуратности человека с клавиатурой.
--
-- ЧЕМ ГРОЗИЛО. Наклейка на дозаторе — это то, что проверяющий берёт в руки
-- первым. Без даты розлива и связи с партией дозатор с прозрачной жидкостью
-- ничем не отличается от неопознанной ёмкости: нечем доказать ни срок, ни
-- происхождение, ни ответственного. Это прямое замечание при проверке, ради
-- недопущения которого салон и платит.
--
-- ЧТО СТАЛО.
-- 1. Колонка decanted_at, а НЕ отдельная таблица розливов. Обоснование: розлив
--    порождает ровно одну дочернюю ёмкость, и наоборот — дочерняя ёмкость
--    порождается ровно одним розливом. Связь один-к-одному, вся «шапка» события
--    (кто, когда, из чего, сколько) уже лежит в строке дочерней ёмкости:
--    opened_by, parent_id, volume. Отдельная таблица добавила бы join к каждой
--    наклейке и второй источник правды о том же факте, который пришлось бы
--    сводить. Событие остаётся видимым и в audit_log: триггер audit_row
--    на material_containers пишет вставку дочерней строки.
-- 2. container_counters — пер-арендаторный счётчик кодов ровно по образцу
--    order_counters и booking_counters (та же форма таблицы, тот же приём
--    «insert on conflict do nothing + update returning» внутри функции).
--    Счётчик засеян максимумом уже существующих кодов, чтобы автоматика
--    не столкнулась с тем, что люди завели руками.
--    Дополнительно — цикл до 10 попыток: у ручных кодов нет обязанности
--    соблюдать формат C-0001, и наткнуться на занятый код теоретически можно.
--    Лучше взять следующий, чем уронить розлив в руках у мастера.
-- 3. decant_container(): создаёт дочернюю ёмкость, наследует material_id и
--    batch_id, уменьшает объём родителя, ставит дочерней opened/opened_at/
--    opened_by/decanted_at и генерирует код сам.
--    use_by у дочерней НЕ считается руками — его считает существующий триггер
--    containers_guard как min(срок партии, дата вскрытия + PAO). Проверено
--    исполнением: розлив из C-0001 (партия до 10.09.2027, PAO 12 мес) дал
--    дочерней use_by = 15.08.2027, то есть сработала ветка PAO, как и должна.
--    Родитель в состоянии sealed при розливе переводится в opened: налить
--    из закрытой банки нельзя, и это тоже факт вскрытия, который обязан
--    попасть в журнал.
-- 4. container_label() — ровно пять реквизитов наклейки одной строкой.
--    Имя мастера ищется по цепочке staff.name → profiles.full_name →
--    profiles.first_name+last_name. У боевого пользователя все три пусты,
--    поэтому предусмотрен честный запасной вариант: «без імені в профілі
--    (обліковий запис xxxxxxxx)». E-mail в качестве имени НЕ печатается
--    сознательно: наклейка висит на дозаторе в зале, её видят посторонние,
--    и почта сотрудника — это персональные данные, а не подпись.
--
-- ЗАЩИТА (проверена попыткой, каждая ветка отказала как задумано):
--   • объём больше остатка родителя — отказ;
--   • ноль и отрицательный объём — отказ;
--   • розлив из finished/disposed — отказ;
--   • чужой арендатор — отказ на проверке прав (tenant_can смотрит в JWT,
--     а не в строку, поэтому чужой tenant_id прав не даёт);
--   • требуется compliance.write или stock.write — так же, как соседние
--     функции: record_stock_movement проверяет tenant_can(p_tenant,'stock.write')
--     первым делом, до любой работы с данными.

-- ── 1. Дата розлива ───────────────────────────────────────────────────────────
alter table public.material_containers
  add column if not exists decanted_at timestamptz;

comment on column public.material_containers.decanted_at is
  'Момент розлива в дозатор. Заполняется только decant_container(); у ёмкостей, полученных от поставщика, пуст.';

-- ── 2. Пер-арендаторный счётчик кодов ─────────────────────────────────────────
create table if not exists public.container_counters (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  last_number bigint not null default 0
);

alter table public.container_counters enable row level security;

drop policy if exists container_counters_read on public.container_counters;
create policy container_counters_read on public.container_counters
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));

-- Записи в счётчик делает только decant_container (security definer):
-- политик на insert/update нет намеренно, чтобы номер нельзя было подкрутить.
insert into public.container_counters (tenant_id, last_number)
select c.tenant_id,
       max(coalesce(nullif(regexp_replace(c.code, '[^0-9]', '', 'g'), '')::bigint, 0))
  from public.material_containers c
 group by c.tenant_id
on conflict (tenant_id) do update
   set last_number = greatest(public.container_counters.last_number, excluded.last_number);

-- ── 3. Операция розлива ───────────────────────────────────────────────────────
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

  -- Права — первыми, до любого чтения данных родителя наружу.
  if not (public.tenant_can(v_parent.tenant_id, 'compliance.write')
       or public.tenant_can(v_parent.tenant_id, 'stock.write')) then
    raise exception 'недостаточно прав: compliance.write или stock.write в арендаторе %', v_parent.tenant_id;
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

  -- use_by намеренно не задаётся: его посчитает триггер containers_guard.
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

revoke all on function public.decant_container(uuid, numeric, text) from public;
grant execute on function public.decant_container(uuid, numeric, text) to authenticated, service_role;

-- ── 4. Наклейка на дозатор ────────────────────────────────────────────────────
create or replace function public.container_label(p_container_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_c      public.material_containers;
  v_mat    text;
  v_batch  text;
  v_master uuid;
  v_name   text;
  v_when   timestamptz;
begin
  select * into v_c from public.material_containers where id = p_container_id;
  if not found or not public.tenant_can(v_c.tenant_id, 'compliance.read') then
    return null;
  end if;

  select m.name into v_mat from public.materials m where m.id = v_c.material_id;
  select b.batch_number into v_batch from public.material_batches b where b.id = v_c.batch_id;

  v_master := coalesce(v_c.opened_by, v_c.created_by);
  v_when   := coalesce(v_c.decanted_at, v_c.opened_at);

  select coalesce(
           (select nullif(btrim(s.name), '') from public.staff s
             where s.tenant_id = v_c.tenant_id and s.user_id = v_master limit 1),
           (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = v_master),
           (select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
              from public.profiles p where p.id = v_master))
    into v_name;

  -- Честный запасной вариант. E-mail сотрудника наклейкой в зал не выносится.
  if v_name is null then
    v_name := case when v_master is null
                   then 'не вказаний'
                   else 'без імені в профілі (обліковий запис ' || left(v_master::text, 8) || ')'
              end;
  end if;

  return format('Засіб: %s · Партія: %s · Розлив: %s · Майстер: %s · Придатне до: %s',
    coalesce(v_mat, '—'),
    coalesce(v_batch, '—'),
    coalesce(to_char(v_when, 'DD.MM.YYYY'), '—'),
    v_name,
    coalesce(to_char(v_c.use_by, 'DD.MM.YYYY'), '—'));
end;
$function$;

revoke all on function public.container_label(uuid) from public;
grant execute on function public.container_label(uuid) to authenticated, service_role;

-- ── 5. Дата розлива видна и в режиме проверки ─────────────────────────────────
create or replace view public.compliance_containers as
select c.id, c.tenant_id, c.code, c.material_id, m.name as material_name,
       c.batch_id, b.batch_number, b.expiry_date as batch_expiry,
       c.parent_id, c.volume, c.unit, c.status, c.opened_at, c.opened_by,
       c.use_by, c.disposed_at, c.note, c.created_at, c.decanted_at
  from public.material_containers c
  join public.materials m on m.id = c.material_id
  left join public.material_batches b on b.id = c.batch_id
 where c.tenant_id in (select public.tenants_with('compliance.read'));

-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ. Сам QR не рисуется: содержимое наклейки отдаёт
-- container_label, картинку строит интерфейс — это выше уровня базы.
