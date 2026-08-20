-- Наповнення TRINITY_DREADS повним об'ємом даних для приймання й показу
-- клієнту: склад ~60 позицій з партіями й ємностями різного статусу
-- придатності, 8 записів на сьогодні, десяток замовлень у різних
-- статусах, два тижні санітарних журналів, дві техкарти, фінанси
-- за три місяці.
--
-- Рішення власника 20.08.2026: дані йдуть ПРЯМО в TRINITY_DREADS —
-- реальний заклад першого клієнта, а не в окремий демо-заклад. Тому
-- окремого прапорця "демонстраційне" не заводиться і не потрібен:
-- заклад уже draft/storefront_enabled=false/listed_in_catalog=false,
-- цього достатньо, щоб не потрапити ні в пошук, ні на мапу, ні
-- в каталог (усі чотири публічні точки фільтрують саме за цим).
--
-- Правило запису: жодного прямого INSERT у кеші (current_stock,
-- stock_qty, use_by) і в незмінні журнали в обхід звичайного шляху.
-- Залишок — лише через apply_stock_receipt → record_stock_movement.
-- Партії, ємності, санітарні журнали, техкарти, фінанси — прямий INSERT
-- у таблицю: це ТОЙ САМИЙ шлях, яким пише сам додаток (container-form.tsx,
-- pao-control.tsx, cleaning/sterilization форми, finance форма) — RPC
-- для них немає ніде, і заводити його тут не треба. Замовлення й записи —
-- лише через create_order / create_booking / set_order_status /
-- set_booking_status, як і бойовий інтерфейс.
--
-- Ідемпотентність: кожен блок перевіряє існування за природним ключем
-- (назва, номер партії, мітка в comment/note) перед вставкою. Повторний
-- запуск нічого не подвоює.
--
-- Фото: з цього середовища немає мережевого доступу до Storage API
-- Supabase (тільки SQL через MCP) — реальні файли завантажити звідси
-- не можна. image_path свідомо лишається NULL; завантаження — окремий
-- крок з машини з мережею.
begin;

-- ── Актори ──────────────────────────────────────────────────────────
-- Аліна — owner, Анастасія — admin (обидві встановлені рішенням
-- власника 20.08.2026: "два владельца, у них должен быть полный
-- спектр прав"). Права beruться з JWT (правило 3), тож пишемо під тим
-- самим токеном, який видав би хук при вході.
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_nastia uuid := 'a11a0000-0000-4000-8000-000000000002';
  v_staff_alina  uuid := '183577da-13eb-4a30-a098-bcc1f3a766d6';
  v_staff_nastia uuid := 'db7b7b8b-96a8-4d22-94c5-f2b194c05f18';

  v_loc_work uuid := '3d8da660-54b1-44d7-972d-3c46301dbd10'; -- Робоче місце
  v_loc_store uuid := '4534e408-3fbf-471d-8c9a-0a1f535f51c0'; -- Склад
  v_loc_fridge uuid := 'be6e89f5-1393-41a5-ad3b-26a4cefde3ba'; -- Холодильник

  v_supplier_hair uuid;
  v_supplier_cosm uuid;

  -- Категорії матеріалів: назва, категорія, одиниця, косметика?, PAO(міс),
  -- бренд, кількість на приході, ціна за одиницю (грн), поріг мінімуму.
  v_mat text[];
  v_materials text[][] := array[
    -- Канекалон (15) — не косметика, термін не спливає.
    ['Канекалон XPression #1 Чорний','канекалон','уп','false','','XPression','40','85','8'],
    ['Канекалон XPression #613 Блонд','канекалон','уп','false','','XPression','25','90','8'],
    ['Канекалон XPression #1B Темна ніч','канекалон','уп','false','','XPression','35','85','8'],
    ['Канекалон XPression #27 Мідний','канекалон','уп','false','','XPression','20','88','6'],
    ['Канекалон XPression #33 Каштан','канекалон','уп','false','','XPression','22','88','6'],
    ['Канекалон XPression #T1B/30 Омбре','канекалон','уп','false','','XPression','18','95','5'],
    ['Канекалон XPression #Grey Сивий','канекалон','уп','false','','XPression','12','90','4'],
    ['Канекалон Fashion Red Червоний','канекалон','уп','false','','Fashion','10','92','3'],
    ['Канекалон Fashion Burgundy Бордо','канекалон','уп','false','','Fashion','10','92','3'],
    ['Канекалон Fashion Pink Рожевий','канекалон','уп','false','','Fashion','8','98','3'],
    ['Канекалон Ombre 1B/613','канекалон','уп','false','','XPression','9','105','3'],
    ['Канекалон Fashion Green Зелений','канекалон','уп','false','','Fashion','6','98','2'],
    ['Канекалон Fashion Blue Синій','канекалон','уп','false','','Fashion','6','98','2'],
    ['Канекалон Fashion Purple Фіолетовий','канекалон','уп','false','','Fashion','6','98','2'],
    ['Канекалон XPression White Білий','канекалон','уп','false','','XPression','7','90','3'],

    -- Догляд і косметика (15) — is_cosmetic=true, PAO задано.
    ['Шампунь для плетених зачісок','догляд','мл','true','12','CurlyCare','3000','0.42','500'],
    ['Кондиціонер безсульфатний','догляд','мл','true','12','CurlyCare','2500','0.48','400'],
    ['Маска відновлююча для волосся','догляд','мл','true','9','CurlyCare','1500','0.65','300'],
    ['Олія для шкіри голови','догляд','мл','true','9','ScalpLab','800','1.10','150'],
    ['Гель для країв (edge control)','догляд','мл','true','12','EdgeFix','1200','0.55','200'],
    ['Мус для укладки','догляд','мл','true','12','StyleMax','900','0.60','150'],
    ['Незмивний спрей-догляд','догляд','мл','true','9','CurlyCare','1000','0.58','200'],
    ['Сухий шампунь','догляд','мл','true','12','StyleMax','600','0.70','100'],
    ['Сироватка для кінчиків','догляд','мл','true','9','ScalpLab','500','1.30','100'],
    ['Термозахист спрей','догляд','мл','true','12','StyleMax','700','0.75','150'],
    ['Крем-дефінер для кучерів','догляд','мл','true','9','CurlyCare','600','0.85','120'],
    ['Спрей для блиску волосся','догляд','мл','true','12','StyleMax','500','0.80','100'],
    ['Спрей-антизаплутування','догляд','мл','true','12','CurlyCare','800','0.55','150'],
    ['Крем проти пухнастості','догляд','мл','true','9','EdgeFix','500','0.90','100'],
    ['Кондиціонер для фарбованого волосся','догляд','мл','true','12','CurlyCare','1200','0.52','200'],

    -- Дезінфекція та санітарія (10) — не косметика, але термін є.
    ['Спирт ізопропіловий 70%','дезінфекція','мл','false','','SaniPro','3000','0.35','500'],
    ['Розчин хлоргексидину 0.5%','дезінфекція','мл','false','','SaniPro','2000','0.40','400'],
    ['Дезінфікуючі серветки','дезінфекція','шт','false','','SaniPro','600','1.20','100'],
    ['Пакети для стерилізації','дезінфекція','шт','false','','SteriPack','400','2.50','80'],
    ['Індикаторні смужки стерилізації','дезінфекція','шт','false','','SteriPack','300','1.80','60'],
    ['Антисептик для рук','дезінфекція','мл','false','','SaniPro','1500','0.30','300'],
    ['Спрей для дезінфекції поверхонь','дезінфекція','мл','false','','SaniPro','1800','0.38','300'],
    ['Розчин четвертинних амонієвих сполук','дезінфекція','мл','false','','SaniPro','1200','0.45','250'],
    ['Одноразові рукавички (упаковка)','дезінфекція','уп','false','','SaniPro','40','65','10'],
    ['Одноразові пеньюари','дезінфекція','шт','false','','SaniPro','150','15','30'],

    -- Інструменти та аксесуари (20) — не косметика, термін не спливає.
    ['Гребінець-хвостик для розділення','інструменти','шт','false','','ToolPro','12','45','2'],
    ['Гребінець з широкими зубцями','інструменти','шт','false','','ToolPro','10','55','2'],
    ['Затискачі для секцій (набір)','інструменти','уп','false','','ToolPro','8','120','2'],
    ['Гумки силіконові дрібні (уп 500шт)','аксесуари','уп','false','','HairAcc','30','40','6'],
    ['Гумки силіконові великі (уп 200шт)','аксесуари','уп','false','','HairAcc','25','45','5'],
    ['Гачок для плетіння','інструменти','шт','false','','ToolPro','15','35','3'],
    ['Ножиці перукарські','інструменти','шт','false','','ToolPro','6','280','2'],
    ['Інструмент для запаювання кінчиків','інструменти','шт','false','','ToolPro','4','650','1'],
    ['Набір манжет і намистин','аксесуари','уп','false','','HairAcc','18','60','4'],
    ['Нитки для плетіння (котушка)','аксесуари','шт','false','','HairAcc','20','25','5'],
    ['Щітка для країв','інструменти','шт','false','','ToolPro','10','30','2'],
    ['Пляшка-розпилювач','інструменти','шт','false','','ToolPro','8','35','2'],
    ['Накидка перукарська','аксесуари','шт','false','','HairAcc','6','150','2'],
    ['Рушник перукарський','аксесуари','шт','false','','HairAcc','20','60','4'],
    ['Бігуді термостійкі (набір)','аксесуари','уп','false','','HairAcc','5','180','1'],
    ['Гребінець для натягування','інструменти','шт','false','','ToolPro','8','40','2'],
    ['Паличка для проділу','інструменти','шт','false','','ToolPro','12','20','3'],
    ['Дзеркало ручне','аксесуари','шт','false','','HairAcc','4','90','1'],
    ['Фартух робочий','аксесуари','шт','false','','HairAcc','4','120','1'],
    ['Контейнер для зберігання канекалону','інструменти','шт','false','','ToolPro','10','75','2']
  ];
  v_id uuid;
  v_batch_id uuid;
  v_receipt_id uuid;
  v_i int := 0;
  v_bucket int;
  v_expiry date;
  v_opened_at timestamptz;
  v_container_seq int := 0;
begin
  -- Актор — Аліна (owner): каталог, склад, довідники веде вона.
  -- reset role ПЕРШИМ: custom_access_token_hook доступний лише ролі
  -- з'єднання (тут — сервісній через MCP), а не 'authenticated', в яку
  -- нижче перемикає set local role. Без reset кожен наступний do-блок
  -- у цій самій транзакції відмовляв би permission denied.
  reset role;
  perform set_config('request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
       'user_id', v_alina::text,
       'claims', jsonb_build_object('sub', v_alina::text)
     )) -> 'claims')::text, true);
  set local role authenticated;

  -- Постачальники (2) — довідник, штатний шлях: refs-form.tsx робить
  -- рівно такий insert.
  select id into v_supplier_hair from public.suppliers
   where tenant_id = v_tenant and name = 'ТОВ «Канекалон Юкрейн»';
  if v_supplier_hair is null then
    insert into public.suppliers (tenant_id, name, is_active)
    values (v_tenant, 'ТОВ «Канекалон Юкрейн»', true)
    returning id into v_supplier_hair;
  end if;

  select id into v_supplier_cosm from public.suppliers
   where tenant_id = v_tenant and name = 'ФОП Косметик Дистрибуція';
  if v_supplier_cosm is null then
    insert into public.suppliers (tenant_id, name, is_active)
    values (v_tenant, 'ФОП Косметик Дистрибуція', true)
    returning id into v_supplier_cosm;
  end if;

  -- Матеріали (60) + прихід кожного окремою приймальною (штатний шлях:
  -- draft-документ → apply_stock_receipt → record_stock_movement).
  foreach v_mat slice 1 in array v_materials
  loop
    v_i := v_i + 1;

    select id into v_id from public.materials
     where tenant_id = v_tenant and name = v_mat[1];
    if v_id is null then
      insert into public.materials
        (tenant_id, name, unit, category, is_cosmetic, pao_months, brand,
         min_stock_threshold, supplier_id, location_id, is_active)
      values
        (v_tenant, v_mat[1], v_mat[3], v_mat[2], v_mat[4]::boolean,
         nullif(v_mat[5],'')::int, v_mat[6], v_mat[9]::numeric,
         case when v_mat[2] in ('канекалон') then v_supplier_hair
              when v_mat[4]::boolean or v_mat[2]='дезінфекція' then v_supplier_cosm
              else null end,
         case when v_mat[2] = 'догляд' then v_loc_fridge
              when v_mat[2] in ('інструменти','аксесуари') then v_loc_work
              else v_loc_store end,
         true)
      returning id into v_id;
    end if;

    -- Прихід — лише якщо ще жодного не було (idempotent за назвою
    -- документа).
    if not exists (
      select 1 from public.stock_receipt_lines l
      join public.stock_receipts r on r.id = l.receipt_id
      where r.tenant_id = v_tenant and l.material_id = v_id
    ) then
      insert into public.stock_receipts (tenant_id, document_number, status, note, created_by, supplier_id)
      values (v_tenant, 'SEED-' || lpad(v_i::text, 3, '0'), 'draft',
              'Початкове наповнення складу', v_alina,
              case when v_mat[2] = 'канекалон' then v_supplier_hair else v_supplier_cosm end)
      returning id into v_receipt_id;

      insert into public.stock_receipt_lines (receipt_id, tenant_id, material_id, quantity, unit_cost)
      values (v_receipt_id, v_tenant, v_id, v_mat[7]::numeric, v_mat[8]::numeric);

      perform public.apply_stock_receipt(v_receipt_id);
    end if;

    -- Партії й ємності — тільки для косметики та дезінфекції (термін
    -- годності має сенс лише для них). Три кошики: чинна (+240д),
    -- спливає (+20д), прострочена (-15д) — по колу.
    if v_mat[4]::boolean or v_mat[2] = 'дезінфекція' then
      v_bucket := v_i % 3;
      v_expiry := current_date + case v_bucket when 0 then 240 when 1 then 20 else -15 end;

      select id into v_batch_id from public.material_batches
       where tenant_id = v_tenant and material_id = v_id and batch_number = 'B-' || lpad(v_i::text,3,'0');
      if v_batch_id is null then
        insert into public.material_batches
          (tenant_id, material_id, batch_number, manufactured_date, expiry_date, received_at, supplier_id, created_by)
        values
          (v_tenant, v_id, 'B-' || lpad(v_i::text,3,'0'),
           v_expiry - interval '18 months', v_expiry, current_date - (v_i % 10),
           case when v_mat[2] = 'канекалон' then v_supplier_hair else v_supplier_cosm end,
           v_alina)
        returning id into v_batch_id;
      end if;

      -- Ємність (банка) для косметики з PAO — розкриваємо приблизно
      -- кожну другу, з різним "днів тому" під три статуси придатності.
      if v_mat[4]::boolean and nullif(v_mat[5],'')::int is not null and v_i % 2 = 0 then
        v_container_seq := v_container_seq + 1;
        v_opened_at := case v_bucket
          when 0 then now() - interval '10 days'                                   -- чинна
          when 1 then now() - (nullif(v_mat[5],'')::int * interval '1 month') + interval '5 days' -- спливає
          else now() - (nullif(v_mat[5],'')::int * interval '1 month') - interval '20 days'        -- прострочена
        end;

        if not exists (
          select 1 from public.material_containers
           where tenant_id = v_tenant and material_id = v_id and code = 'M-' || lpad(v_container_seq::text,4,'0')
        ) then
          insert into public.material_containers
            (tenant_id, material_id, batch_id, code, volume, unit, status,
             opened_at, opened_by, pao_months, created_by)
          values
            (v_tenant, v_id, v_batch_id, 'M-' || lpad(v_container_seq::text,4,'0'),
             v_mat[7]::numeric * 0.2, v_mat[3], 'opened',
             v_opened_at, v_alina, nullif(v_mat[5],'')::int, v_alina);
        end if;
      end if;
    end if;
  end loop;
end $$;

-- ── Каталог: послуги для запису + товари для замовлень ─────────────
-- До цього моменту в закладі не було жодної offering/variant узагалі —
-- без них ані create_booking, ані create_order не мають на що
-- посилатись. Прямий insert — той самий шлях, яким каталог заводить
-- екран /app/catalog (RPC для цього немає).
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';

  v_off_braid uuid;   v_var_braid uuid;
  v_off_box   uuid;   v_var_box   uuid;
  v_off_take  uuid;   v_var_take  uuid;
  v_off_scalp uuid;   v_var_scalp uuid;

  v_off_kanekalon uuid; v_var_kanekalon uuid;
  v_off_careset   uuid; v_var_careset   uuid;
  v_off_shine     uuid; v_var_shine     uuid;
  v_off_edge      uuid; v_var_edge      uuid;
  v_off_comb      uuid; v_var_comb      uuid;

  v_mat_kanekalon uuid;
  v_mat_shampoo   uuid;
  v_mat_cond      uuid;
  v_mat_oil       uuid;
  v_mat_shine     uuid;
  v_mat_edge      uuid;
  v_mat_comb      uuid;
begin
  reset role;
  perform set_config('request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
       'user_id', v_alina::text, 'claims', jsonb_build_object('sub', v_alina::text)
     )) -> 'claims')::text, true);
  set local role authenticated;

  -- Послуги (kind='services') — потрібні для запису на сьогодні.
  select id into v_off_braid from public.offerings where tenant_id=v_tenant and slug='pletinnya-kis-klasychni';
  if v_off_braid is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, subtitle, price, listed, published_at)
    values (v_tenant, 'service', 'active', 'pletinnya-kis-klasychni', 'Плетіння кіс з канекалоном', 'Класичні коси', 1800, true, now())
    returning id into v_off_braid;
    insert into public.offering_variants (tenant_id, offering_id, name, price, track_stock, duration_minutes, buffer_minutes)
    values (v_tenant, v_off_braid, 'Класичні коси', 1800, false, 240, 15)
    returning id into v_var_braid;
  else
    select id into v_var_braid from public.offering_variants where offering_id=v_off_braid limit 1;
  end if;

  select id into v_off_box from public.offerings where tenant_id=v_tenant and slug='pletinnya-kis-boks';
  if v_off_box is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, subtitle, price, listed, published_at)
    values (v_tenant, 'service', 'active', 'pletinnya-kis-boks', 'Плетіння кіс з канекалоном', 'Бокс-коси', 2200, true, now())
    returning id into v_off_box;
    insert into public.offering_variants (tenant_id, offering_id, name, price, track_stock, duration_minutes, buffer_minutes)
    values (v_tenant, v_off_box, 'Бокс-коси', 2200, false, 300, 15)
    returning id into v_var_box;
  else
    select id into v_var_box from public.offering_variants where offering_id=v_off_box limit 1;
  end if;

  select id into v_off_take from public.offerings where tenant_id=v_tenant and slug='znyattya-kis';
  if v_off_take is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'service', 'active', 'znyattya-kis', 'Зняття кіс', 400, true, now())
    returning id into v_off_take;
    insert into public.offering_variants (tenant_id, offering_id, name, price, track_stock, duration_minutes, buffer_minutes)
    values (v_tenant, v_off_take, 'Стандарт', 400, false, 60, 10)
    returning id into v_var_take;
  else
    select id into v_var_take from public.offering_variants where offering_id=v_off_take limit 1;
  end if;

  select id into v_off_scalp from public.offerings where tenant_id=v_tenant and slug='dogliad-golovy';
  if v_off_scalp is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'service', 'active', 'dogliad-golovy', 'Догляд за шкірою голови', 500, true, now())
    returning id into v_off_scalp;
    insert into public.offering_variants (tenant_id, offering_id, name, price, track_stock, duration_minutes, buffer_minutes)
    values (v_tenant, v_off_scalp, 'Стандарт', 500, false, 45, 10)
    returning id into v_var_scalp;
  else
    select id into v_var_scalp from public.offering_variants where offering_id=v_off_scalp limit 1;
  end if;

  -- Товари (kind='goods') — потрібні для замовлень.
  select id into v_mat_kanekalon from public.materials where tenant_id=v_tenant and name='Канекалон XPression #1 Чорний';
  select id into v_off_kanekalon from public.offerings where tenant_id=v_tenant and slug='kanekalon-xpression-pack';
  if v_off_kanekalon is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'product', 'active', 'kanekalon-xpression-pack', 'Канекалон XPression, упаковка', 350, true, now())
    returning id into v_off_kanekalon;
    insert into public.offering_variants (tenant_id, offering_id, name, price, cost, track_stock, unit)
    values (v_tenant, v_off_kanekalon, 'Стандарт', 350, 85, true, 'уп')
    returning id into v_var_kanekalon;
  else
    select id into v_var_kanekalon from public.offering_variants where offering_id=v_off_kanekalon limit 1;
  end if;

  select id into v_off_careset from public.offerings where tenant_id=v_tenant and slug='nabir-dogliadu-za-kosamy';
  if v_off_careset is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'product', 'active', 'nabir-dogliadu-za-kosamy', 'Набір для догляду за косами', 750, true, now())
    returning id into v_off_careset;
    insert into public.offering_variants (tenant_id, offering_id, name, price, cost, track_stock, unit)
    values (v_tenant, v_off_careset, 'Стандарт', 750, 220, true, 'шт')
    returning id into v_var_careset;
  else
    select id into v_var_careset from public.offering_variants where offering_id=v_off_careset limit 1;
  end if;

  select id into v_off_shine from public.offerings where tenant_id=v_tenant and slug='sprey-dlia-blysku';
  if v_off_shine is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'product', 'active', 'sprey-dlia-blysku', 'Спрей для блиску волосся', 320, true, now())
    returning id into v_off_shine;
    insert into public.offering_variants (tenant_id, offering_id, name, price, cost, track_stock, unit)
    values (v_tenant, v_off_shine, 'Стандарт', 320, 80, true, 'шт')
    returning id into v_var_shine;
  else
    select id into v_var_shine from public.offering_variants where offering_id=v_off_shine limit 1;
  end if;

  select id into v_off_edge from public.offerings where tenant_id=v_tenant and slug='strichka-dlia-krayiv';
  if v_off_edge is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'product', 'active', 'strichka-dlia-krayiv', 'Гель для країв, дорожня', 180, true, now())
    returning id into v_off_edge;
    insert into public.offering_variants (tenant_id, offering_id, name, price, cost, track_stock, unit)
    values (v_tenant, v_off_edge, 'Стандарт', 180, 45, true, 'шт')
    returning id into v_var_edge;
  else
    select id into v_var_edge from public.offering_variants where offering_id=v_off_edge limit 1;
  end if;

  select id into v_off_comb from public.offerings where tenant_id=v_tenant and slug='grebinets-dlia-rozdilennya';
  if v_off_comb is null then
    insert into public.offerings (tenant_id, kind, status, slug, title, price, listed, published_at)
    values (v_tenant, 'product', 'active', 'grebinets-dlia-rozdilennya', 'Гребінець для розділення', 150, true, now())
    returning id into v_off_comb;
    insert into public.offering_variants (tenant_id, offering_id, name, price, cost, track_stock, unit)
    values (v_tenant, v_off_comb, 'Стандарт', 150, 45, true, 'шт')
    returning id into v_var_comb;
  else
    select id into v_var_comb from public.offering_variants where offering_id=v_off_comb limit 1;
  end if;

  -- Прихід залишку товарів — тим самим шляхом, що й розхідники.
  if not exists (select 1 from public.stock_movements where tenant_id=v_tenant and variant_id=v_var_kanekalon) then
    perform public.record_stock_movement(v_tenant, 'receipt', 60, v_var_kanekalon, null, 'stock_receipt', null, null, null, 'Початковий залишок товару');
  end if;
  if not exists (select 1 from public.stock_movements where tenant_id=v_tenant and variant_id=v_var_careset) then
    perform public.record_stock_movement(v_tenant, 'receipt', 15, v_var_careset, null, 'stock_receipt', null, null, null, 'Початковий залишок товару');
  end if;
  if not exists (select 1 from public.stock_movements where tenant_id=v_tenant and variant_id=v_var_shine) then
    perform public.record_stock_movement(v_tenant, 'receipt', 20, v_var_shine, null, 'stock_receipt', null, null, null, 'Початковий залишок товару');
  end if;
  if not exists (select 1 from public.stock_movements where tenant_id=v_tenant and variant_id=v_var_edge) then
    perform public.record_stock_movement(v_tenant, 'receipt', 25, v_var_edge, null, 'stock_receipt', null, null, null, 'Початковий залишок товару');
  end if;
  if not exists (select 1 from public.stock_movements where tenant_id=v_tenant and variant_id=v_var_comb) then
    perform public.record_stock_movement(v_tenant, 'receipt', 10, v_var_comb, null, 'stock_receipt', null, null, null, 'Початковий залишок товару');
  end if;

  -- Дві техкарти (approved), прив'язані до двох головних послуг —
  -- версія 1, is_active. Рецептура (variant_materials) списує канекалон
  -- і догляд при виконанні запису (set_booking_status → 'completed').
  select id into v_mat_shampoo from public.materials where tenant_id=v_tenant and name='Шампунь для плетених зачісок';
  select id into v_mat_cond    from public.materials where tenant_id=v_tenant and name='Кондиціонер безсульфатний';
  select id into v_mat_oil     from public.materials where tenant_id=v_tenant and name='Олія для шкіри голови';
  select id into v_mat_shine   from public.materials where tenant_id=v_tenant and name='Спрей для блиску волосся';
  select id into v_mat_edge    from public.materials where tenant_id=v_tenant and name='Гель для країв (edge control)';
  select id into v_mat_comb    from public.materials where tenant_id=v_tenant and name='Гребінець-хвостик для розділення';

  if not exists (select 1 from public.tech_cards where tenant_id=v_tenant and offering_id=v_off_braid) then
    insert into public.tech_cards (tenant_id, offering_id, title, version, steps, is_active, approved_by)
    values (v_tenant, v_off_braid, 'Плетіння кіс з канекалоном — класичні коси', 1,
      '["Діагностика шкіри голови","Миття голови шампунем","Нанесення кондиціонера","Розділення на секції","Плетіння з канекалоном","Обробка країв гелем","Фінальне сприскування блиском"]'::jsonb,
      true, v_alina);
  end if;
  if not exists (select 1 from public.variant_materials where tenant_id=v_tenant and variant_id=v_var_braid) then
    insert into public.variant_materials (tenant_id, variant_id, material_id, quantity_per_unit) values
      (v_tenant, v_var_braid, v_mat_kanekalon, 6),
      (v_tenant, v_var_braid, v_mat_shampoo, 30),
      (v_tenant, v_var_braid, v_mat_cond, 20),
      (v_tenant, v_var_braid, v_mat_oil, 10),
      (v_tenant, v_var_braid, v_mat_edge, 15),
      (v_tenant, v_var_braid, v_mat_shine, 10);
  end if;

  if not exists (select 1 from public.tech_cards where tenant_id=v_tenant and offering_id=v_off_box) then
    insert into public.tech_cards (tenant_id, offering_id, title, version, steps, is_active, approved_by)
    values (v_tenant, v_off_box, 'Плетіння кіс з канекалоном — бокс-коси', 1,
      '["Діагностика шкіри голови","Миття голови шампунем","Нанесення кондиціонера","Розділення на квадратні секції","Плетіння бокс-кіс з канекалоном","Обробка країв гелем","Запаювання кінчиків","Фінальне сприскування блиском"]'::jsonb,
      true, v_alina);
  end if;
  if not exists (select 1 from public.variant_materials where tenant_id=v_tenant and variant_id=v_var_box) then
    insert into public.variant_materials (tenant_id, variant_id, material_id, quantity_per_unit) values
      (v_tenant, v_var_box, v_mat_kanekalon, 8),
      (v_tenant, v_var_box, v_mat_shampoo, 30),
      (v_tenant, v_var_box, v_mat_cond, 20),
      (v_tenant, v_var_box, v_mat_oil, 10),
      (v_tenant, v_var_box, v_mat_edge, 20),
      (v_tenant, v_var_box, v_mat_shine, 10);
  end if;
end $$;

-- ── Санітарні журнали за два тижні ─────────────────────────────────
-- Прямий insert у cleaning_entries / sterilization_cycles /
-- sanitation_solutions — тим самим шляхом, яким пише сам екран журналів:
-- журнали захищені подвійно (немає політик UPDATE/DELETE + тригер),
-- але INSERT це і є штатний шлях (RPC для нього немає ніде).
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_nastia uuid := 'a11a0000-0000-4000-8000-000000000002';
  v_actor  uuid;
  v_day    int;
  v_date   date;
  v_task   uuid;
  v_daily_tasks uuid[] := array[
    '8370be43-d3e3-4c4f-a0dd-66ce1bd74965', -- Дезінфекція робочої поверхні
    '72c8444c-ed12-46d8-9c52-8323466a5558', -- Дезінфекція інструментів
    '1f6b2ae1-ebe3-4ab4-8e0b-1437c2a95db0', -- Кварцювання кабінету
    '5e3774a5-72a2-4d5b-8134-55bde81e02f0', -- Вологе прибирання підлоги
    '858ad97b-a83e-4ba2-8ef1-8b551be64cbc', -- Заміна рушників і покриттів
    '5b1e19cf-ffa4-4539-8ac1-2e0c72b413b2'  -- Винесення відходів
  ];
  v_general_task uuid := '14d14eec-c630-473f-acee-0b7ff5ad8be3'; -- Генеральне прибирання
begin
  for v_day in 0..13 loop
    v_date := current_date - v_day;
    v_actor := case when v_day % 2 = 0 then v_alina else v_nastia end;

    -- performed_by/prepared_by звіряється політикою з auth.uid() (кожен
    -- пише своє чергування) — перемикаємо актора на кожен день.
    reset role;
    perform set_config('request.jwt.claims',
      (public.custom_access_token_hook(jsonb_build_object(
         'user_id', v_actor::text, 'claims', jsonb_build_object('sub', v_actor::text)
       )) -> 'claims')::text, true);
    set local role authenticated;

    foreach v_task in array v_daily_tasks loop
      if not exists (
        select 1 from public.cleaning_entries
         where tenant_id = v_tenant and task_id = v_task
           and performed_at::date = v_date
      ) then
        insert into public.cleaning_entries (tenant_id, task_id, performed_at, performed_by, note)
        values (v_tenant, v_task, v_date + time '09:30', v_actor, null);
      end if;
    end loop;

    -- Генеральне прибирання — раз на тиждень, не щодня.
    if v_day % 7 = 0 then
      if not exists (
        select 1 from public.cleaning_entries
         where tenant_id = v_tenant and task_id = v_general_task
           and performed_at::date = v_date
      ) then
        insert into public.cleaning_entries (tenant_id, task_id, performed_at, performed_by, note)
        values (v_tenant, v_general_task, v_date + time '19:00', v_actor, 'Генеральне прибирання після закриття');
      end if;
    end if;

    -- Стерилізація інструментів — щодня одним циклом. Два дні поспіль
    -- (для реалізму) — індикатор не спрацював, повторний цикл.
    if not exists (
      select 1 from public.sterilization_cycles
       where tenant_id = v_tenant and performed_at::date = v_date
    ) then
      insert into public.sterilization_cycles
        (tenant_id, device, temperature_c, duration_minutes, indicator_ok, indicator_note, performed_at, performed_by)
      values
        (v_tenant, 'Сухожарова шафа', 180, 60,
         v_day not in (5, 9), case when v_day in (5, 9) then 'Індикатор не змінив колір, цикл повторено' else null end,
         v_date + time '08:30', v_actor);
    end if;

    -- Робочий розчин дезінфектанту — готується щоранку.
    if not exists (
      select 1 from public.sanitation_solutions
       where tenant_id = v_tenant and prepared_at::date = v_date
    ) then
      insert into public.sanitation_solutions
        (tenant_id, agent_name, registration, concentration, volume, unit, prepared_at, expires_at, prepared_by, note)
      values
        (v_tenant,
         case when v_day % 2 = 0 then 'Хлоргексидину біглюконат' else 'Розчин четвертинних амонієвих сполук' end,
         case when v_day % 2 = 0 then 'UA/12345/01/01' else 'UA/54321/01/01' end,
         case when v_day % 2 = 0 then '0.5%' else '1:100' end,
         0.5, 'л', v_date + time '09:00', v_date + time '21:00', v_actor, null);
    end if;
  end loop;
end $$;

-- ── 8 записів на сьогодні ────────────────────────────────────────────
-- Лише через create_booking / set_booking_status — той самий шлях, яким
-- запис іде з боевого екрана. Мітка '[seed:booking-N]' на початку
-- comment — ключ ідемпотентності (номер замовлення видає лічильник
-- і не підходить для перевірки заздалегідь).
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_staff_alina  uuid := '183577da-13eb-4a30-a098-bcc1f3a766d6';
  v_staff_nastia uuid := 'db7b7b8b-96a8-4d22-94c5-f2b194c05f18';

  v_var_braid uuid; v_var_box uuid; v_var_take uuid; v_var_scalp uuid;
  v_row public.bookings;

  v_plan record;
  v_bookings record;
begin
  reset role;
  perform set_config('request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
       'user_id', v_alina::text, 'claims', jsonb_build_object('sub', v_alina::text)
     )) -> 'claims')::text, true);
  set local role authenticated;

  select id into v_var_braid from public.offering_variants where tenant_id=v_tenant and name='Класичні коси';
  select id into v_var_box   from public.offering_variants where tenant_id=v_tenant and name='Бокс-коси';
  select id into v_var_take  from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='znyattya-kis');
  select id into v_var_scalp from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='dogliad-golovy');

  -- Зсуви від now() у хвилинах, а не фіксований годинник: створення
  -- запису вимагає starts_at строго в майбутньому (create_booking),
  -- а прогін скрипту сам займає час — календарна позначка "14:00"
  -- встигає стати минулим між читанням часу й вставкою. На один
  -- майстра зсуви не перетинаються: наступний старт ≥ кінець
  -- попереднього (тривалість+буфер) + 10 хв паузи.
  for v_plan in
    select * from (values
      (1, v_staff_alina,  v_var_braid, 20,  'Оксана Мельник',    '+380971112233', 'completed'),
      (2, v_staff_alina,  v_var_take,  285, 'Марія Ковальчук',   '+380972223344', 'confirmed'),
      (3, v_staff_alina,  v_var_scalp, 365, 'Софія Бондаренко',  '+380973334455', 'booked'),
      (4, v_staff_alina,  v_var_take,  430, 'Валерія Шевченко',  '+380974445566', 'cancelled'),
      (5, v_staff_nastia, v_var_box,   25,  'Катерина Іванова',  '+380975556677', 'completed'),
      (6, v_staff_nastia, v_var_scalp, 350, 'Юлія Ткаченко',     '+380976667788', 'no_show'),
      (7, v_staff_nastia, v_var_take,  415, 'Дарина Поліщук',    '+380977778899', 'arrived'),
      (8, v_staff_nastia, v_var_take,  495, 'Вікторія Савченко', '+380978889900', 'booked')
    ) as t(n, staff_id, variant_id, offset_min, contact_name, contact_phone, target_status)
  loop
    if not exists (
      select 1 from public.bookings
       where tenant_id = v_tenant and comment like ('[seed:booking-' || v_plan.n || ']%')
    ) then
      v_row := public.create_booking(
        v_tenant, v_plan.variant_id, v_plan.staff_id,
        now() + (v_plan.offset_min * interval '1 minute'),
        v_plan.contact_name, v_plan.contact_phone,
        '[seed:booking-' || v_plan.n || '] демо-запис');

      if v_plan.target_status in ('confirmed','arrived','cancelled','no_show','completed') then
        perform public.set_booking_status(v_row.id, 'confirmed');
      end if;
      if v_plan.target_status in ('arrived','completed') then
        perform public.set_booking_status(v_row.id, 'arrived');
      end if;
      if v_plan.target_status = 'completed' then
        perform public.set_booking_status(v_row.id, 'completed');
      end if;
      if v_plan.target_status = 'cancelled' then
        perform public.set_booking_status(v_row.id, 'cancelled');
      end if;
      if v_plan.target_status = 'no_show' then
        perform public.set_booking_status(v_row.id, 'no_show');
      end if;
    end if;
  end loop;
end $$;

-- ── ~10 замовлень у різних статусах ─────────────────────────────────
-- Лише через create_order / set_order_status — той самий шлях, яким
-- замовлення оформлюється з боевого екрана. 'shipped' по дорозі списує
-- залишок товару через record_stock_movement (усередині set_order_status).
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_var_kanekalon uuid; v_var_careset uuid; v_var_shine uuid; v_var_edge uuid; v_var_comb uuid;
  v_row public.orders;
  v_plan record;
  v_items jsonb;
begin
  reset role;
  perform set_config('request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
       'user_id', v_alina::text, 'claims', jsonb_build_object('sub', v_alina::text)
     )) -> 'claims')::text, true);
  set local role authenticated;

  select id into v_var_kanekalon from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='kanekalon-xpression-pack');
  select id into v_var_careset   from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='nabir-dogliadu-za-kosamy');
  select id into v_var_shine     from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='sprey-dlia-blysku');
  select id into v_var_edge      from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='strichka-dlia-krayiv');
  select id into v_var_comb      from public.offering_variants where tenant_id=v_tenant and offering_id=(select id from public.offerings where tenant_id=v_tenant and slug='grebinets-dlia-rozdilennya');

  for v_plan in
    select * from (values
      (1, jsonb_build_array(jsonb_build_object('variant_id', v_var_kanekalon, 'quantity', 2)), 'Оксана Мельник',    '+380971112233', 'new'),
      (2, jsonb_build_array(jsonb_build_object('variant_id', v_var_careset,   'quantity', 1)), 'Марія Ковальчук',   '+380972223344', 'confirmed'),
      (3, jsonb_build_array(jsonb_build_object('variant_id', v_var_shine,     'quantity', 3)), 'Софія Бондаренко',  '+380973334455', 'awaiting_payment'),
      (4, jsonb_build_array(jsonb_build_object('variant_id', v_var_edge,      'quantity', 2)), 'Валерія Шевченко',  '+380974445566', 'paid'),
      (5, jsonb_build_array(jsonb_build_object('variant_id', v_var_comb,      'quantity', 1)), 'Катерина Іванова',  '+380975556677', 'packing'),
      (6, jsonb_build_array(jsonb_build_object('variant_id', v_var_kanekalon, 'quantity', 1),
                             jsonb_build_object('variant_id', v_var_careset,  'quantity', 1)), 'Юлія Ткаченко',     '+380976667788', 'shipped'),
      (7, jsonb_build_array(jsonb_build_object('variant_id', v_var_shine,     'quantity', 1)), 'Дарина Поліщук',    '+380977778899', 'delivered'),
      (8, jsonb_build_array(jsonb_build_object('variant_id', v_var_kanekalon, 'quantity', 3)), 'Вікторія Савченко', '+380978889900', 'completed'),
      (9, jsonb_build_array(jsonb_build_object('variant_id', v_var_edge,      'quantity', 1)), 'Тетяна Гриценко',   '+380979990011', 'cancelled'),
      (10, jsonb_build_array(jsonb_build_object('variant_id', v_var_careset,  'quantity', 1)), 'Наталія Кравець',   '+380979990022', 'returned')
    ) as t(n, items, contact_name, contact_phone, target_status)
  loop
    if not exists (
      select 1 from public.orders
       where tenant_id = v_tenant and comment like ('[seed:order-' || v_plan.n || ']%')
    ) then
      v_row := public.create_order(
        v_tenant, v_plan.items, v_plan.contact_name, v_plan.contact_phone, null,
        '{}'::jsonb, '[seed:order-' || v_plan.n || '] демо-замовлення', 'manual');

      if v_plan.target_status <> 'new' then
        perform public.set_order_status(v_row.id, 'confirmed');
      end if;
      if v_plan.target_status = 'awaiting_payment' then
        perform public.set_order_status(v_row.id, 'awaiting_payment');
      end if;
      if v_plan.target_status in ('paid','packing','shipped','delivered','completed') then
        perform public.set_order_status(v_row.id, 'paid');
      end if;
      if v_plan.target_status in ('packing','shipped','delivered','completed') then
        perform public.set_order_status(v_row.id, 'packing');
      end if;
      if v_plan.target_status in ('shipped','delivered','completed') then
        perform public.set_order_status(v_row.id, 'shipped');
      end if;
      if v_plan.target_status in ('delivered','completed') then
        perform public.set_order_status(v_row.id, 'delivered');
      end if;
      if v_plan.target_status = 'completed' then
        perform public.set_order_status(v_row.id, 'completed');
      end if;
      if v_plan.target_status = 'cancelled' then
        perform public.set_order_status(v_row.id, 'cancelled');
      end if;
      if v_plan.target_status = 'returned' then
        -- 'returned' дозволено лише з delivered/completed — проводимо
        -- через повний цикл до delivered, а потім повертаємо.
        perform public.set_order_status(v_row.id, 'paid');
        perform public.set_order_status(v_row.id, 'packing');
        perform public.set_order_status(v_row.id, 'shipped');
        perform public.set_order_status(v_row.id, 'delivered');
        perform public.set_order_status(v_row.id, 'returned');
      end if;
    end if;
  end loop;
end $$;

-- ── Фінанси за три місяці ────────────────────────────────────────────
-- Прямий insert у finance_records (той самий шлях, яким пише форма
-- фінансів — RPC для цього немає). Категорії — вже наявний довідник
-- заведення (11 позицій з пресету 'salon_services', 20.08.2026).
do $$
declare
  v_tenant uuid := '858fbb1c-3b8e-4d43-bce1-ece478eb77ec';
  v_alina  uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_cat_services  uuid := '27a369d9-7a40-4fa3-952c-88e4f92af36c';
  v_cat_goods     uuid := 'a88b5652-4dd6-426f-9d02-1a81cacb4a5a';
  v_cat_certs     uuid := '59761303-287f-4ae1-8175-24c45aaa3440';
  v_cat_purchase  uuid := 'c699565e-732b-4485-9b49-d761887ecf59';
  v_cat_utility   uuid := 'f476ee2b-abef-4cd1-af7c-c8321693d43d';
  v_cat_equipment uuid := '1fefe6b2-e7b3-48db-9e37-b373c578bc73';
  v_cat_salary    uuid := 'ac416a73-45c8-4ec0-affc-58f32699a4f0';
  v_cat_rent      uuid := '919b0701-e6aa-44a0-a1e7-21613ffbc371';
  v_cat_subs      uuid := '09fa1901-ef1e-4dae-be6a-000ad11e827c';
  v_cat_tax       uuid := '32df31ec-529a-43ee-96ab-635d2733492c';
  v_cat_ads       uuid := 'bbc46617-a846-4ba4-875a-8cc7182a74c4';
  v_month_offset int;
  v_month_start date;
  v_date date;
  v_line record;
begin
  reset role;
  perform set_config('request.jwt.claims',
    (public.custom_access_token_hook(jsonb_build_object(
       'user_id', v_alina::text, 'claims', jsonb_build_object('sub', v_alina::text)
     )) -> 'claims')::text, true);
  set local role authenticated;

  for v_month_offset in 0..2 loop
    v_month_start := (date_trunc('month', current_date) - (v_month_offset * interval '1 month'))::date;

    for v_line in
      select * from (values
        ('rent',          v_cat_rent,      'expense', 15000::numeric, 5),
        ('utility',       v_cat_utility,   'expense', 3500::numeric,  5),
        ('subs',          v_cat_subs,      'expense', 1200::numeric,  3),
        ('tax',           v_cat_tax,       'expense', 2600::numeric,  20),
        ('salary_alina',  v_cat_salary,    'expense', 18000::numeric, 28),
        ('salary_nastia', v_cat_salary,    'expense', 15000::numeric, 28),
        ('svc1',          v_cat_services,  'income',  3200::numeric,  4),
        ('svc2',          v_cat_services,  'income',  2400::numeric,  9),
        ('svc3',          v_cat_services,  'income',  3600::numeric,  15),
        ('svc4',          v_cat_services,  'income',  1800::numeric,  22),
        ('goods1',        v_cat_goods,     'income',  700::numeric,   7),
        ('goods2',        v_cat_goods,     'income',  1050::numeric,  18),
        ('purchase1',     v_cat_purchase,  'expense', 3200::numeric,  6),
        ('purchase2',     v_cat_purchase,  'expense', 2100::numeric,  19),
        ('ads',           v_cat_ads,       'expense', 1200::numeric,  12)
      ) as t(key, category_id, kind, amount, day)
    loop
      v_date := v_month_start + (v_line.day - 1);
      if v_date <= current_date then
        if not exists (
          select 1 from public.finance_records
           where tenant_id = v_tenant
             and note like ('[seed:finance-' || v_month_offset || '-' || v_line.key || ']%')
        ) then
          insert into public.finance_records (tenant_id, kind, amount, category_id, note, occurred_on, created_by)
          values (v_tenant, v_line.kind::public.finance_kind, v_line.amount, v_line.category_id,
                  '[seed:finance-' || v_month_offset || '-' || v_line.key || ']', v_date, v_alina);
        end if;
      end if;
    end loop;

    -- Сертифікат — не щомісяця; ремонт обладнання — один раз за весь період.
    if v_month_offset = 1 and (v_month_start + 10) <= current_date then
      if not exists (select 1 from public.finance_records where tenant_id=v_tenant and note like '[seed:finance-cert]%') then
        insert into public.finance_records (tenant_id, kind, amount, category_id, note, occurred_on, created_by)
        values (v_tenant, 'income'::public.finance_kind, 1000, v_cat_certs, '[seed:finance-cert]', v_month_start + 10, v_alina);
      end if;
    end if;
    if v_month_offset = 2 and (v_month_start + 14) <= current_date then
      if not exists (select 1 from public.finance_records where tenant_id=v_tenant and note like '[seed:finance-equipment]%') then
        insert into public.finance_records (tenant_id, kind, amount, category_id, note, occurred_on, created_by)
        values (v_tenant, 'expense'::public.finance_kind, 3500, v_cat_equipment, '[seed:finance-equipment]', v_month_start + 14, v_alina);
      end if;
    end if;
  end loop;
end $$;

commit;
