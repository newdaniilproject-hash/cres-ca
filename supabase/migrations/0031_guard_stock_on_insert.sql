-- 0031 — остаток создавался ИЗ ВОЗДУХА вставкой строки.
--
-- Правило 5 проекта гласит: stock_qty, reserved_qty и current_stock —
-- это КЭШ от журнала stock_movements, и прямой путь к ним закрыт. Триггеры
-- guard_stock_columns стояли на этом страже — но только `before update`.
-- Политики INSERT колонки не ограничивают, значит любой сотрудник
-- с catalog.write или stock.write мог написать
--     insert into public.materials (…, current_stock) values (…, 500)
--     insert into public.offering_variants (…, stock_qty) values (…, 999)
-- и получить остаток, которого нет ни в одном движении. После этого
-- кэш расходится с журналом НАВСЕГДА: встречного движения, которое можно
-- было бы погасить, не существует — гасить нечего, движения не было.
--
-- Почему это чинится ИМЕННО СЕЙЧАС, а не в общей очереди хардening.
-- Неизменяемость остатка — один из восьми пунктов, которые показывают
-- клиенту как доказательство «система не даст соврать». Показывать этот
-- козырь, зная, что он обходится одной вставкой, нельзя: демонстрируется
-- то, чего нет. Остальные дыры того же списка клиенту не видны и ждут
-- своей очереди — эта видна.
--
-- Автор проекта этот приём знал и применял: material_containers_guard,
-- collection_items_tenant_guard и staff_services_tenant_guard объявлены
-- `before insert or update`. Здесь просто не поставили INSERT.
--
-- ЧТО СЧИТАЕТСЯ ЗАКОННОЙ ВСТАВКОЙ. Все три колонки объявлены
-- `not null default 0`, то есть нормальный путь — завести позицию с нулём
-- и наполнить её движением. Поэтому правило простое: при вставке остаток
-- обязан быть нулевым. Обход остаётся ровно один и тот же, что и у UPDATE, —
-- флаг vitrina.allow_stock_write, который ставят функции склада.
--
-- OLD на INSERT в PL/pgSQL не назначен, поэтому ветка INSERT вынесена
-- отдельно и до сравнений со старой строкой, а не дописана к ним.

create or replace function public.guard_stock_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('vitrina.allow_stock_write', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if tg_table_name = 'offering_variants' then
      if coalesce(new.stock_qty, 0) <> 0 or coalesce(new.reserved_qty, 0) <> 0 then
        raise exception
          'позиция заводится с нулевым остатком: stock_qty/reserved_qty наполняются только через record_stock_movement/reserve_stock';
      end if;
    elsif tg_table_name = 'materials' then
      if coalesce(new.current_stock, 0) <> 0 then
        raise exception
          'расходник заводится с нулевым остатком: current_stock наполняется только через record_stock_movement';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'offering_variants' then
    if new.stock_qty is distinct from old.stock_qty
       or new.reserved_qty is distinct from old.reserved_qty then
      raise exception
        'stock_qty/reserved_qty меняются только через record_stock_movement/reserve_stock — не напрямую';
    end if;
  elsif tg_table_name = 'materials' then
    if new.current_stock is distinct from old.current_stock then
      raise exception
        'current_stock меняется только через record_stock_movement — не напрямую';
    end if;
  end if;

  return new;
end;
$$;

-- Пересоздаём триггеры с INSERT. drop + create, а не alter: у триггера
-- нельзя расширить список событий на месте.
drop trigger if exists offering_variants_guard_stock on public.offering_variants;
create trigger offering_variants_guard_stock
  before insert or update on public.offering_variants
  for each row execute function public.guard_stock_columns();

drop trigger if exists materials_guard_stock on public.materials;
create trigger materials_guard_stock
  before insert or update on public.materials
  for each row execute function public.guard_stock_columns();

-- Правило 7. create or replace существующие права сохраняет, но повторяем
-- явно: состав прав должен читаться из файла, а не восстанавливаться
-- по истории миграций.
revoke execute on function public.guard_stock_columns() from public, anon, authenticated;
