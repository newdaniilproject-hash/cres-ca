-- 0122. Пресети: заклад заводиться ЗАПОВНЕНИМ, а не порожнім.
--
-- ── Навіщо ──────────────────────────────────────────────────────────────────
--
-- Рішення власника 19.08.2026. Продаємо не підписку, а ВПРОВАДЖЕННЯ: людина
-- платить за те, що в перший же день бачить робочу систему, а не десяток
-- порожніх довідників з написом «Додайте перший запис». Сьогодні заведення
-- заклада під салон — це вечір ручного набивання одиниць виміру, категорій
-- витрат, чек-листа прибирання і типової техкарти. Пресет робить це за
-- п'ятнадцять хвилин, і той самий пресет наповнює демо-заклад — тобто те,
-- що людина бачить у демо, і є те, що вона отримає. Розійтися їм нема чим.
--
-- ── Чому таблицею, а не масивом у коді ──────────────────────────────────────
--
-- Правило проекту: даними — те, що змінюється; кодом — те, що інваріантне.
-- Набір довідників під нішу змінюється з кожним новим клієнтом («у нас ще
-- журнал видачі ключів», «у нас витрати діляться інакше»), а механіка
-- «взяти рядки пресету і розкласти по таблицях закладу» — ні. Тому пресет
-- це рядки, а не гілка в register_tenant: завести пресет під нову нішу
-- має бути INSERT-ом, без викату.
--
-- ── Що НЕ входить у пресет і чому ───────────────────────────────────────────
--
-- Постачальники, партії, ціни, майстри, послуги — власне закладу, вигадувати
-- їх за нього не можна. Модулі теж не тут: набір модулів це те, що заклад
-- купив (`tenants.modules`), і пресет не має права його розширювати —
-- інакше з'явиться шлях видати оплачений розділ повз оплату.

-- ── Реєстр пресетів ─────────────────────────────────────────────────────────

create table if not exists public.presets (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  title       text not null check (length(btrim(title)) > 0),
  description text,
  -- Для якого виду закладу пропонувати. null — підходить будь-якому.
  kind        public.tenant_kind,
  position    int     not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.presets is
  'Готові набори довідників під нішу. Застосовуються функцією apply_preset; '
  'модулі закладу пресет НЕ чіпає — це оплачена вісь.';

create table if not exists public.preset_items (
  id          uuid primary key default gen_random_uuid(),
  preset_code text not null references public.presets(code) on delete cascade,
  -- Закритий список: нова сутність у пресеті — це нова гілка в apply_preset,
  -- тобто код, і має пройти через міграцію, а не через INSERT даних.
  entity      text not null check (entity in
                ('storage_location', 'cleaning_task', 'finance_category',
                 'tech_card', 'material')),
  payload     jsonb not null,
  position    int not null default 0
);

create index if not exists preset_items_preset_idx
  on public.preset_items (preset_code, position);

-- Реєстр читають усі, хто заводить заклад: це список продукту, а не дані
-- конкретного закладу — жодного `tenant_id` тут немає й бути не може.
alter table public.presets      enable row level security;
alter table public.preset_items enable row level security;

drop policy if exists presets_read on public.presets;
create policy presets_read on public.presets
  for select to authenticated using (is_active);

-- Не `using (true)`: правило 7 забороняє його навіть на «все одно публічних»
-- даних, і тест 06 ловить це одразу. Фільтрувати тут є по чому — рядок
-- належить пресету, і вимкнений пресет не має віддавати свій вміст.
drop policy if exists preset_items_read on public.preset_items;
create policy preset_items_read on public.preset_items
  for select to authenticated
  using (exists (select 1 from public.presets p
                  where p.code = preset_code and p.is_active));

revoke all on public.presets      from public, anon;
revoke all on public.preset_items from public, anon;
grant select on public.presets      to authenticated;
grant select on public.preset_items to authenticated;

-- ── Застосування ────────────────────────────────────────────────────────────
--
-- Ідемпотентна: кожна вставка гаситься `on conflict do nothing` по тому ж
-- унікальному ключу, що й ручне заведення (tenant_id + назва). Повторний
-- виклик нічого не подвоїть — а він буде: «застосуй ще раз, я випадково
-- видалив» це нормальний хід впровадження.
--
-- Повертає, скільки рядків реально додано по кожній сутності: мовчазне
-- «готово» на порожньому результаті читається як успіх, і людина йде
-- шукати довідники, яких немає.

create or replace function public.apply_preset(
  p_tenant_id uuid,
  p_preset    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_item  record;
  v_n     int;
  v_out   jsonb := jsonb_build_object(
    'storage_location', 0, 'cleaning_task', 0,
    'finance_category', 0, 'tech_card', 0, 'material', 0);
begin
  if v_actor is null then
    raise exception 'застосування пресету потребує входу';
  end if;
  -- Право те саме, що й на решту налаштувань закладу. Окремого права
  -- «застосувати пресет» не заводимо: привілей, що обходить решту, —
  -- це дірка з кнопкою.
  if not public.tenant_can(p_tenant_id, 'settings.write') then
    raise exception 'немає права налаштовувати заклад';
  end if;
  if not exists (select 1 from public.presets
                  where code = p_preset and is_active) then
    raise exception 'пресет % не існує', p_preset;
  end if;

  for v_item in
    select entity, payload
      from public.preset_items
     where preset_code = p_preset
     order by position, id
  loop
    if v_item.entity = 'storage_location' then
      insert into public.storage_locations (tenant_id, name, note, position)
      values (p_tenant_id,
              v_item.payload ->> 'name',
              v_item.payload ->> 'note',
              coalesce((v_item.payload ->> 'position')::int, 0))
      on conflict (tenant_id, name) do nothing;

    elsif v_item.entity = 'cleaning_task' then
      insert into public.cleaning_tasks (tenant_id, name, schedule, position)
      values (p_tenant_id,
              v_item.payload ->> 'name',
              v_item.payload ->> 'schedule',
              coalesce((v_item.payload ->> 'position')::int, 0))
      on conflict (tenant_id, name) do nothing;

    elsif v_item.entity = 'finance_category' then
      insert into public.finance_categories (tenant_id, kind, name, position, is_fixed)
      values (p_tenant_id,
              (v_item.payload ->> 'kind')::public.finance_kind,
              v_item.payload ->> 'name',
              coalesce((v_item.payload ->> 'position')::int, 0),
              coalesce((v_item.payload ->> 'is_fixed')::boolean, false))
      on conflict (tenant_id, kind, name) do nothing;

    elsif v_item.entity = 'material' then
      insert into public.materials
        (tenant_id, name, unit, category, min_stock_threshold)
      values (p_tenant_id,
              v_item.payload ->> 'name',
              v_item.payload ->> 'unit',
              v_item.payload ->> 'category',
              coalesce((v_item.payload ->> 'threshold')::numeric, 0))
      on conflict (tenant_id, name) do nothing;

    elsif v_item.entity = 'tech_card' then
      -- Техкарта версійна, і `approved_by` не має значення за замовчуванням:
      -- затверджує той, хто застосовує пресет, і це чесно — саме він відповів
      -- за те, що регламент підходить закладу.
      insert into public.tech_cards
        (tenant_id, title, version, steps, approved_by)
      values (p_tenant_id,
              v_item.payload ->> 'title',
              1,
              coalesce(v_item.payload -> 'steps', '[]'::jsonb),
              v_actor)
      on conflict (tenant_id, title, version) do nothing;
    end if;

    get diagnostics v_n = row_count;
    v_out := jsonb_set(v_out, array[v_item.entity],
                       to_jsonb(coalesce((v_out ->> v_item.entity)::int, 0) + v_n));
  end loop;

  return v_out;
end;
$fn$;

comment on function public.apply_preset(uuid, text) is
  'Розкладає рядки пресету по довідниках закладу. Ідемпотентна: повторний '
  'виклик нічого не подвоює. Модулі не чіпає — це оплачена вісь.';

revoke all on function public.apply_preset(uuid, text) from public;
revoke all on function public.apply_preset(uuid, text) from anon;
grant execute on function public.apply_preset(uuid, text) to authenticated;

-- ── Пресет «Салон послуг» ───────────────────────────────────────────────────
--
-- Зібраний під першого клієнта — брейдинг-салон, — але свідомо БЕЗ жодної
-- згадки канекалону в назвах довідників: це набір будь-якого салону, і
-- перукарня з манікюром бере його як є. Канекалонове — тільки в техкарті,
-- і вона версійна: заклад випускає свою наступну версію, не ламаючи цю.

insert into public.presets (code, title, description, kind, position) values
  ('salon_services', 'Салон послуг',
   'Місця зберігання, чек-лист прибирання, категорії доходів і витрат, '
   'типова техкарта обробки волокна.',
   'services', 10)
on conflict (code) do nothing;

-- Строк пресету немає власного унікального ключа (одна назва може зустрітися
-- у двох пресетах), тому повторний накат гаситься перевіркою, а не
-- `on conflict`: без неї другий прогон подвоїв би весь набір.
insert into public.preset_items (preset_code, entity, payload, position)
select preset_code, entity, payload::jsonb, position from (values
  -- Місця зберігання
  ('salon_services', 'storage_location', '{"name":"Робоче місце","position":10}', 10),
  ('salon_services', 'storage_location', '{"name":"Склад","position":20}', 20),
  ('salon_services', 'storage_location', '{"name":"Холодильник","position":30}', 30),

  -- Чек-лист прибирання і кварцювання (ТЗ 3.3)
  ('salon_services', 'cleaning_task',
   '{"name":"Дезінфекція робочої поверхні","schedule":"після кожного клієнта","position":10}', 110),
  ('salon_services', 'cleaning_task',
   '{"name":"Дезінфекція інструментів","schedule":"після кожного клієнта","position":20}', 120),
  ('salon_services', 'cleaning_task',
   '{"name":"Кварцювання кабінету","schedule":"щодня","position":30}', 130),
  ('salon_services', 'cleaning_task',
   '{"name":"Вологе прибирання підлоги","schedule":"щодня","position":40}', 140),
  ('salon_services', 'cleaning_task',
   '{"name":"Заміна рушників і одноразових покриттів","schedule":"після кожного клієнта","position":50}', 150),
  ('salon_services', 'cleaning_task',
   '{"name":"Винесення відходів","schedule":"щодня","position":60}', 160),
  ('salon_services', 'cleaning_task',
   '{"name":"Генеральне прибирання","schedule":"щотижня","position":70}', 170),

  -- Доходи
  ('salon_services', 'finance_category',
   '{"kind":"income","name":"Послуги","position":10}', 210),
  ('salon_services', 'finance_category',
   '{"kind":"income","name":"Продаж товарів","position":20}', 220),
  ('salon_services', 'finance_category',
   '{"kind":"income","name":"Сертифікати","position":30}', 230),

  -- Витрати. `is_fixed` — це і є поділ P&L на постійні і змінні (0121):
  -- оренда постійна вся, закупівля матеріалів змінна вся.
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Оренда","position":10,"is_fixed":true}', 310),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Комунальні платежі","position":20,"is_fixed":true}', 320),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Підписки і сервіси","position":30,"is_fixed":true}', 330),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Податки і ЄСВ","position":40,"is_fixed":true}', 340),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Закупівля матеріалів","position":50,"is_fixed":false}', 350),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Оплата майстрам","position":60,"is_fixed":false}', 360),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Реклама","position":70,"is_fixed":false}', 370),
  ('salon_services', 'finance_category',
   '{"kind":"expense","name":"Обладнання та ремонт","position":80,"is_fixed":false}', 380),

  -- Типова техкарта (ТЗ 3.4). Кроки — той самий формат, що читає екран:
  -- [{"step":…, "solution":…, "proportion":…, "minutes":…, "note":…}]
  ('salon_services', 'tech_card',
   '{"title":"Підготовка волокна перед плетінням",
     "steps":[
       {"step":"Замочування","solution":"Вода з содою","proportion":"1 ст. л. на 1 л","minutes":15,
        "note":"Знімає технологічне покриття, через яке буває свербіж і почервоніння."},
       {"step":"Полоскання","solution":"Проточна вода","proportion":"—","minutes":5,
        "note":"До зникнення слизькості на дотик."},
       {"step":"Кондиціонування","solution":"Кондиціонер для волосся","proportion":"1:10","minutes":10,
        "note":"Пасмо стає м''якшим, менше електризується."},
       {"step":"Сушіння","solution":"—","proportion":"—","minutes":60,
        "note":"У розправленому вигляді, без фена. Вологе волокно пліснявіє."}
     ]}', 410)
) as v(preset_code, entity, payload, position)
where not exists (
  select 1 from public.preset_items where preset_code = 'salon_services'
);
