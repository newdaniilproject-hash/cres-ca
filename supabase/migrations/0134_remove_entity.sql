-- 0134. Видалення: людина має право прибрати те, що завела.
--
-- ── ЩО ПРОСИЛИ ─────────────────────────────────────────────────────────────
--
-- Власник 26.08.2026: «додай функцію видалити — витратний засіб, товар,
-- клієнта — все, щоб у користувачів була така можливість».
--
-- Її не було НІДЕ: жоден екран кабінету не міг прибрати ні засіб, ні
-- позицію каталогу, ні клієнта. Політики видалення в базі стояли з 0004,
-- але викликати їх не було звідки — тобто помилково заведений рядок
-- лишався в реєстрі назавжди.
--
-- ── ЧОМУ ЦЕ НЕ «ПРОСТО DELETE» ─────────────────────────────────────────────
--
-- Половину того, що людина хоче прибрати, стерти НЕ МОЖНА, і це не наша
-- обережність, а зовнішні ключі з `on delete restrict`, поставлені
-- навмисно:
--
--   materials          ← stock_movements, stock_receipt_lines,
--                        stock_count_lines, variant_materials
--   offerings          ← bookings, order_items
--   offering_variants  ← ті самі плюс stock_reservations
--   customers          ← bookings, orders
--   suppliers          ← stock_receipts
--
-- Тобто засіб, яким хоч раз щось списали, тримає ЖУРНАЛ РУХІВ — джерело
-- правди про залишок (правило 5). Стерти його означає стерти історію,
-- і саме тому база цього не дає. Клієнт із замовленнями — те саме:
-- первинний облік не видаляється ніколи (розділ «Строк зберігання»).
--
-- ── ЩО ЗАМІСТЬ ─────────────────────────────────────────────────────────────
--
-- Одна дія для людини — «видалити», — і чесна відповідь, що саме сталося:
--
--   `deleted`   — рядок стерто повністю. Так буває з тим, чого ще ніде
--                 не використали: щойно заведений засіб, зайва позиція,
--                 клієнт без жодного замовлення.
--   `archived`  — стерти не вийшло, бо є історія; рядок прибрано з реєстру
--                 (`is_active = false`, у каталозі `status = 'archived'`).
--                 З екранів він зникає, історія лишається цілою.
--   `forgotten` — тільки клієнт із замовленнями: рядок лишається (на нього
--                 дивляться замовлення), але ПЕРСОНАЛЬНІ ДАНІ стираються —
--                 імʼя, телефон, пошта, нотатки. Це те саме, що робить
--                 `retention_sweep` через три роки, тільки на вимогу.
--
-- Вибір робить НЕ інтерфейс, а ця функція: інтерфейс не знає і не має
-- знати, які зовнішні ключі стоять на таблиці, а якби знав — це був би
-- другий опис звʼязків, який розійшовся б із базою мовчки.
--
-- ── ЧОМУ CASE, А НЕ ТАБЛИЦЯ «ВИД → ТАБЛИЦЯ» ────────────────────────────────
--
-- Спокуса завести реєстр видів даними, як зроблено з модулями (0110).
-- Тут це було б помилкою: у кожного виду СВОЯ поведінка при відмові
-- (архів, забуття, різні колонки), тобто це код, а не дані. Правило
-- проекту називає межу прямо: «Даними — те, що змінюється. Кодом —
-- те, що інваріантне».

-- ── Клієнта теж треба вміти прибирати з очей ───────────────────────────────
--
-- У `customers` не було ознаки активності взагалі, тож забутий клієнт
-- лишався б у списку порожнім рядком. Колонка ДОДАЮЧА і з умовчанням,
-- тому безпечна при будь-якому порядку викату.
alter table public.customers
  add column if not exists is_active boolean not null default true;

comment on column public.customers.is_active is
  'false — клієнта прибрано з реєстру (0134). Рядок лишається, бо на нього '
  'дивляться замовлення й записи; зі списків він зникає.';

-- ── Сама дія ───────────────────────────────────────────────────────────────
--
-- `security definer`, бо вона робить те, чого політики поодинці не дають:
-- зокрема стирає контакти клієнта, куди прямого UPDATE у застосунку немає.
-- Право перевіряється ЯВНО і першим ділом — своє для кожного виду.
create or replace function public.remove_entity(p_kind text, p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_perm   text;
begin
  if p_id is null then
    raise exception 'не вказано, що саме прибрати';
  end if;

  -- Заклад і потрібне право беруться з САМОГО рядка. Передавати їх
  -- параметром не можна: тоді викликач назвав би чужий заклад і зняв
  -- перевірку, а `security definer` слухняно виконав би.
  case p_kind
    when 'material' then
      select tenant_id into v_tenant from public.materials where id = p_id;
      v_perm := 'stock.write';
    when 'offering' then
      select tenant_id into v_tenant from public.offerings where id = p_id;
      v_perm := 'catalog.write';
    when 'customer' then
      select tenant_id into v_tenant from public.customers where id = p_id;
      v_perm := 'customers.write';
    when 'supplier' then
      select tenant_id into v_tenant from public.suppliers where id = p_id;
      v_perm := 'stock.write';
    when 'location' then
      select tenant_id into v_tenant from public.storage_locations where id = p_id;
      v_perm := 'stock.write';
    when 'finance_category' then
      select tenant_id into v_tenant from public.finance_categories where id = p_id;
      v_perm := 'finances.write';
    when 'cleaning_task' then
      select tenant_id into v_tenant from public.cleaning_tasks where id = p_id;
      v_perm := 'compliance.write';
    else
      raise exception 'невідомий вид запису: %', p_kind;
  end case;

  if v_tenant is null then
    raise exception 'запис не знайдено';
  end if;
  if not public.tenant_can(v_tenant, v_perm) then
    raise exception 'недостатньо прав, щоб прибрати цей запис';
  end if;

  -- ── Що НЕ можна стирати, хоча зовнішній ключ дозволяє ────────────────
  --
  -- Тут перевірка ЯВНА, і саме тому, що схема тут мовчить: ці звʼязки
  -- стоять `on delete cascade`, тобто DELETE пройшов би і забрав їх
  -- із собою беззвучно.
  --
  --   ЗАСІБ: партії, ємності й документи — це облік за Технічним
  --     регламентом №65. Ємність зі строком придатності, підтвердження
  --     нотифікації МОЗ, MSDS — те, що показують перевірці. Стерти
  --     засіб разом із ними означає стерти доказ, і жодна людина,
  --     тиснучи «видалити», такого не має на увазі.
  --   ПОЗИЦІЯ КАТАЛОГУ: відгуки. Відгук — це слово покупця, а не наші
  --     дані; він лишається за позицією навіть коли її прибрали.
  --
  -- Наслідок для людини той самий, що й при відмові зовнішнього ключа:
  -- запис іде в архів, а не стирається. Тому нижче ми просто НЕ пробуємо
  -- стерти, а одразу переходимо до архівації.
  if (p_kind = 'material' and (
        exists (select 1 from public.material_batches    where material_id = p_id)
     or exists (select 1 from public.material_containers where material_id = p_id)
     or exists (select 1 from public.material_documents  where material_id = p_id)))
  or (p_kind = 'offering' and
        exists (select 1 from public.reviews where offering_id = p_id))
  then
    if p_kind = 'material' then
      update public.materials set is_active = false where id = p_id;
    else
      update public.offerings set status = 'archived' where id = p_id;
    end if;
    return 'archived';
  end if;

  -- ── Спроба стерти повністю ───────────────────────────────────────────
  --
  -- `exception` тут доречний, хоча в тригері пульсу (0133) від нього
  -- відмовились: там це плата на КОЖЕН запис у базі, а тут — дія, яку
  -- людина робить кілька разів на місяць. І головне: питати базу
  -- «а чи можна?» окремими запитами означало б переписати список
  -- зовнішніх ключів у код, тобто завести другий опис звʼязків.
  -- Тут ми просто пробуємо, а відповідає сама схема.
  begin
    case p_kind
      when 'material'         then delete from public.materials          where id = p_id;
      when 'offering'         then delete from public.offerings          where id = p_id;
      when 'customer'         then delete from public.customers          where id = p_id;
      when 'supplier'         then delete from public.suppliers          where id = p_id;
      when 'location'         then delete from public.storage_locations  where id = p_id;
      when 'finance_category' then delete from public.finance_categories where id = p_id;
      when 'cleaning_task'    then delete from public.cleaning_tasks     where id = p_id;
    end case;
    return 'deleted';
  exception when foreign_key_violation then
    -- Є історія. Далі — по виду.
    null;
  end;

  case p_kind
    when 'material' then
      update public.materials set is_active = false where id = p_id;
    when 'offering' then
      -- У каталозі ознака активності — це статус, і 'archived' у ньому
      -- вже є з 0002. Другої колонки заводити не треба.
      update public.offerings set status = 'archived' where id = p_id;
    when 'supplier' then
      update public.suppliers set is_active = false where id = p_id;
    when 'location' then
      update public.storage_locations set is_active = false where id = p_id;
    when 'finance_category' then
      update public.finance_categories set is_active = false where id = p_id;
    when 'cleaning_task' then
      update public.cleaning_tasks set is_active = false where id = p_id;
    when 'customer' then
      -- Клієнт із замовленнями. Рядок лишається (на нього дивляться
      -- замовлення і записи), але персональних даних у ньому більше
      -- немає. Імʼя не порожнє навмисно: порожнє поле в старому
      -- замовленні читається як збій, а не як «клієнта прибрано».
      update public.customers
         set name = 'Клієнта прибрано',
             phone = null, email = null, note = null, tags = '{}',
             is_active = false
       where id = p_id;
      return 'forgotten';
  end case;

  return 'archived';
end;
$$;

-- ── Повернути назад ────────────────────────────────────────────────────────
--
-- Без цього «прибрати» — двері в один бік: рядок зникає з екрана,
-- і повернути його нема чим. Дія рідкісна, але її відсутність
-- перетворює помилкове натискання на непоправне.
create or replace function public.restore_entity(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_perm   text;
begin
  case p_kind
    when 'material' then
      select tenant_id into v_tenant from public.materials where id = p_id;
      v_perm := 'stock.write';
    when 'offering' then
      select tenant_id into v_tenant from public.offerings where id = p_id;
      v_perm := 'catalog.write';
    when 'customer' then
      select tenant_id into v_tenant from public.customers where id = p_id;
      v_perm := 'customers.write';
    when 'supplier' then
      select tenant_id into v_tenant from public.suppliers where id = p_id;
      v_perm := 'stock.write';
    when 'location' then
      select tenant_id into v_tenant from public.storage_locations where id = p_id;
      v_perm := 'stock.write';
    when 'finance_category' then
      select tenant_id into v_tenant from public.finance_categories where id = p_id;
      v_perm := 'finances.write';
    when 'cleaning_task' then
      select tenant_id into v_tenant from public.cleaning_tasks where id = p_id;
      v_perm := 'compliance.write';
    else
      raise exception 'невідомий вид запису: %', p_kind;
  end case;

  if v_tenant is null then
    raise exception 'запис не знайдено';
  end if;
  if not public.tenant_can(v_tenant, v_perm) then
    raise exception 'недостатньо прав';
  end if;

  case p_kind
    when 'material'         then update public.materials          set is_active = true where id = p_id;
    -- Повертаємо в ЧЕРНЕТКУ, а не в 'active': позиція зникала з каталогу
    -- разом зі своєю ціною й описом, і повернути її одразу покупцеві
    -- на очі означало б опублікувати те, що ніхто не передивився.
    when 'offering'         then update public.offerings          set status = 'draft' where id = p_id;
    when 'supplier'         then update public.suppliers          set is_active = true where id = p_id;
    when 'location'         then update public.storage_locations  set is_active = true where id = p_id;
    when 'finance_category' then update public.finance_categories set is_active = true where id = p_id;
    when 'cleaning_task'    then update public.cleaning_tasks     set is_active = true where id = p_id;
    -- Клієнта повертаємо в список, але СТЕРТЕ НЕ ВОСКРЕШАЄМО: імʼя
    -- і телефон стерті назавжди, це і був сенс дії. Обіцяти інше не можна.
    when 'customer'         then update public.customers          set is_active = true where id = p_id;
  end case;
end;
$$;

revoke execute on function public.remove_entity(text, uuid) from public, anon;
revoke execute on function public.restore_entity(text, uuid) from public, anon;
grant execute on function public.remove_entity(text, uuid) to authenticated;
grant execute on function public.restore_entity(text, uuid) to authenticated;
