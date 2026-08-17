-- ===========================================================================
-- 0100. Розлив можно было повторить дважды. Ключ идемпотентности.
-- ===========================================================================
--
-- КАК НАШЛОСЬ. Сверкой ТЗ с кодом. Раздел 4 ТЗ требует «підтримка офлайн-
-- режиму з подальшою синхронізацією», раздел 2 относит к действиям мастера
-- «фіксацію відкриття банок/розливу». Проверено по коду: вскрытие банки
-- в очередь уходит (`container.status`), а РОЗЛИВ — нет, он зовёт
-- `decant_container` напрямую и при обрыве сети просто теряется.
--
-- ПОЧЕМУ НЕЛЬЗЯ БЫЛО ПРОСТО ПОЛОЖИТЬ ЕГО В ОЧЕРЕДЬ. Правило, на котором
-- вообще держится безопасность офлайна (CLAUDE.md): в очередь уходит ключ
-- идемпотентности, сгенерированный ЭКРАНОМ до первой попытки. Сеть рвётся
-- и ПОСЛЕ того, как база записала действие: транзакция прошла, ответ
-- не доехал. У `decant_container` ключа не было вовсе — значит досылка
-- отлила бы из банки второй раз.
--
-- Чем это хуже двойного списания со склада: розлив не только уменьшает
-- объём родителя, он ЗАВОДИТ НОВУЮ ЁМКОСТЬ со своим кодом, своим сроком
-- и своей наклейкой. Второй экземпляр — это лишняя банка в реестре
-- соответствия, которой физически нет на полке, и расхождение с журналом
-- увидят на проверке, а не в тот же день.
--
-- ЧТО СТАЛО. Колонка `idempotency_key` и уникальный индекс на пару
-- «арендатор × ключ». Форма повторяет `stock_movements` (0003) дословно:
-- второго способа делать то же самое в проекте не заводится. Функция
-- с ключом сначала ищет уже созданную дочернюю ёмкость и возвращает ЕЁ,
-- не тронув объём родителя.
--
-- ПОРЯДОК ПРОВЕРКИ ВАЖЕН. Поиск по ключу стоит ДО `update` родителя.
-- Обратный порядок вычел бы объём, а потом вернул старую строку — то есть
-- второй вызов всё равно «отлил» бы, просто молча.
--
-- ПОЧЕМУ DROP, А НЕ CREATE OR REPLACE. Добавление параметра меняет
-- сигнатуру: `create or replace` создало бы ВТОРУЮ функцию, и вызов
-- с тремя аргументами стал бы неоднозначным. Старая снимается, новая
-- принимает четвёртый параметр со значением по умолчанию — все прежние
-- вызовы с тремя аргументами продолжают работать без правок.
-- ===========================================================================

alter table public.material_containers
  add column if not exists idempotency_key text;

comment on column public.material_containers.idempotency_key is
  'Ключ повтора для отложенного розлива. Генерирует ЭКРАН до первой попытки: пересланное действие возвращает ту же ёмкость, а не отливает второй раз.';

create unique index if not exists material_containers_idempotency_idx
  on public.material_containers (tenant_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists public.decant_container(uuid, numeric, text);

create or replace function public.decant_container(
  p_parent_id       uuid,
  p_volume          numeric,
  p_note            text default null,
  p_idempotency_key text default null)
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

  -- Повтор. Проверка стоит ЗДЕСЬ — после прав и до любого изменения:
  -- ниже начинается расход объёма родителя, и он не должен случиться
  -- дважды. Права проверяются и на повторе намеренно: отобранный доступ
  -- не должен «дорабатывать» через застрявшую в очереди отправку.
  if p_idempotency_key is not null then
    select * into v_child from public.material_containers
     where tenant_id = v_parent.tenant_id
       and idempotency_key = p_idempotency_key;
    if found then
      return v_child;
    end if;
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
     opened_at, opened_by, decanted_at, pao_months, note, created_by, idempotency_key)
  values
    (v_parent.tenant_id, v_parent.material_id, v_parent.batch_id, v_code, v_parent.id,
     p_volume, v_parent.unit, 'opened',
     now(), v_actor, now(), v_parent.pao_months, p_note, v_actor, p_idempotency_key)
  returning * into v_child;

  return v_child;
end;
$function$;

comment on function public.decant_container(uuid, numeric, text, text) is
  'Розлив из ёмкости в дозатор. С ключом идемпотентности повтор возвращает уже созданную дочернюю ёмкость и не расходует объём родителя второй раз.';

-- Правило 7. Список получателей тот же, что был у трёхаргументной версии:
-- розлив делает вошедший мастер, анониму он не нужен ни в одном сценарии.
revoke all on function public.decant_container(uuid, numeric, text, text) from public;
revoke all on function public.decant_container(uuid, numeric, text, text) from anon;
grant execute on function public.decant_container(uuid, numeric, text, text) to authenticated;
