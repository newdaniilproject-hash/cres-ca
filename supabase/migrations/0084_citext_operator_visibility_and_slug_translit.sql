-- ===========================================================================
-- 0084. Две починки, найденные тестами шага 5:
--       А. citext под `search_path = ''` сравнивал ПО РЕГИСТРУ;
--       Б. таблица транслитерации в register_tenant была сдвинута на символ.
-- ===========================================================================
--
-- ── А. citext сравнивался как text. Опасность высокая ────────────────────
--
-- ЧТО БЫЛО. Оператор `=` для citext объявлен расширением и живёт в схеме
-- extensions (туда его перенесла 0017). Тело функции с `set search_path = ''`
-- разбирается В МОМЕНТ ВЫПОЛНЕНИЯ и по тому самому пустому пути: оператора
-- citext там не видно. Но и ошибки нет — citext двоично совместим с text,
-- Postgres молча берёт `=(text,text)` из pg_catalog и сравнивает С УЧЁТОМ
-- РЕГИСТРА. То есть citext в этих функциях не работал вообще.
-- Проверено на бою (jobvstdwoyifspaiwazn):
--   set local search_path = '';
--   select 'CafeTest'::extensions.citext = 'cafetest'::extensions.citext; → false
--
-- ЧТО ИЗ-ЗА ЭТОГО ЛОМАЛОСЬ (все пять мест — весь список, найденный сплошной
-- проверкой pg_proc, а не по памяти):
--   • accept_invitation  — `i.email = v_mail`. Приглашение всегда записано
--     строчными, а profiles.email хранит то, что пришло из auth. Человек
--     с почтой в смешанном регистре приглашение принять НЕ МОГ, и починить
--     это из интерфейса нельзя: интерфейс за приглашением;
--   • create_invitation  — `pr.email = v_email`. Проверка «ця людина вже
--     в закладі» промахивалась, заводился дубль;
--   • storefront         — `t.slug = p_slug`. Заклад со слагом «CafeTest»
--     недостижим по адресу «cafetest»;
--   • track_order        — `t.slug = p_tenant_slug`. То же для отслеживания
--     заказа по слагу;
--   • scan_lookup        — `v.barcode = p_code or v.sku = p_code or
--     o.sku = p_code` и `b.barcode = p_code`. Штрихкод и sku на складе
--     искались с учётом регистра.
--
-- ЧЕМ ЧИНИМ И ПОЧЕМУ ИМЕННО ТАК. Путей было два: (1) вернуть схему
-- extensions в search_path этих пяти функций, (2) писать сравнение через
-- lower() с обеих сторон. Выбран (1), единообразно для всех пяти.
-- Три причины:
--   • lower(колонка::text) = lower(параметр::text) убивает индекс. По
--     tenants.slug стоит УНИКАЛЬНЫЙ индекс операторным классом citext,
--     и storefront — это анонимная точка, которую дёргает каждая загрузка
--     публичной витрины. Функциональное сравнение увело бы её в полный
--     проход по tenants. Правило 6 («скорость — критерий приёмки»)
--     запрещает такой размен там, где есть равноценный путь;
--   • search_path чинит ФУНКЦИЮ ЦЕЛИКОМ, а не отдельную строку: возвращаются
--     не только `=`, но и `<>`, сортировки и любое сравнение, дописанное
--     сюда завтра. lower() надо не забыть в каждом новом сравнении, а «не
--     забыть» — это ровно тот класс дефекта, который здесь и чинится;
--   • правка минимальная: `alter function ... set search_path`, тела не
--     переписываются. `create or replace` поверх чужого тела уже уносил
--     из сторожа 0052 ветку INSERT (см. «Тесты» в CLAUDE.md), и делать его
--     ради одной строки конфигурации незачем.
--
-- ПРОВЕРКА «НЕ ОТКРЫВАЕТ ЛИ ЭТО ДРУГИХ ДВЕРЕЙ» (правило 3, разбор схем
-- в 0074). Проверено на бою, три пункта:
--   • CREATE на схеме extensions нет ни у anon, ни у authenticated, ни
--     у PUBLIC: nspacl = {postgres=UC, anon=U, authenticated=U,
--     service_role=U, dashboard_user=UC}. Подложить туда свою функцию
--     и перехватить вызов внутри security definer никто не может.
--     Если CREATE там когда-нибудь появится — эти пять функций надо будет
--     пересмотреть первыми;
--   • pg_catalog в search_path всегда ищется ПЕРВЫМ, если не назван явно.
--     Поэтому ничто из extensions не может перекрыть встроенное имя;
--   • все обращения к таблицам внутри этих пяти функций уже написаны
--     с `public.`, а pgcrypto зовётся как extensions.digest /
--     extensions.gen_random_bytes. Ни одно имя не меняет разрешение.
--
-- ЕДИНСТВЕННЫЙ ЗАМЕЧЕННЫЙ ПОБОЧНЫЙ ЭФФЕКТ, и он назван здесь, чтобы его
-- не искали заново: citext объявляет не только `=`, но и свои `~`, `!~`,
-- `~~`, `!~~` — регистронезависимые. В create_invitation есть проверка
-- почты `v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'`,
-- и теперь она разрешится в citext-вариант. Шаблон не содержит ни одной
-- буквы (только @, точка, [:space:] и отрицания), а v_email к этому месту
-- уже приведён к нижнему регистру, поэтому поведение бит в бит прежнее.
-- В остальных четырёх функциях LIKE и регулярных выражений по citext нет.
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ ПО ЧАСТИ А:
--   • не трогает register_tenant: там citext ни с чем не сравнивается,
--     уникальность слага ловит индекс, а индекс сравнивает операторным
--     классом и от search_path не зависит;
--   • не трогает enqueue_notification: `to_email = excluded.to_email` — это
--     присваивание в ON CONFLICT DO UPDATE, а не сравнение;
--   • не трогает политики RLS, индексы и представления: их выражения
--     разбираются в момент DDL, а не выполнения, и citext в них уже
--     разрешён правильно.
--
-- ОТДЕЛЬНО ПРОВЕРЕНО ПРО ДРУГИЕ ОБЪЕКТЫ ИЗ extensions. Сплошным поиском
-- по pg_proc: digest, gen_random_bytes, gen_salt, crypt, hmac,
-- uuid_generate_v4, unaccent, similarity НИ РАЗУ не вызываются коротким
-- именем — везде стоит `extensions.`. Той же ловушки у них и не было бы:
-- ненайденная ФУНКЦИЯ даёт громкую ошибку «function does not exist»
-- (так и падало до 0056), а ненайденный ОПЕРАТОР тихо подменяется
-- совместимым — потому citext и оказался единственным молчаливым случаем.
-- gen_random_uuid() в register_tenant пишется без схемы законно: с PG13
-- это встроенная функция из pg_catalog, а не из pgcrypto.
--
-- ── Б. Транслитерация слага сдвинута на символ. Последствие необратимое ──
--
-- ЧТО БЫЛО. В register_tenant строка-источник 'абв…ё ' — 37 знаков, строка
-- замены 'abvgg…__ja__e-' — 38: лишний знак приехал из пары «я → ja»,
-- которую translate поштучно выполнить не может. Из-за сдвига последние
-- шесть пар разъехались: ю→_, я→j, ы→a, э→_, ё→_, а ПРОБЕЛ переводился
-- в букву «e»; дефис, стоящий в замене последним, не использовался никогда.
-- На бою видно: «Салон Плетіння Кіс» → salonepletinnjekis,
-- «Студія Ірини» → studijeiryny, «Кава Друга» → kavaedruga.
-- Цена — публичный адрес витрины навсегда получает слипшиеся слова.
--
-- ЧЕМ ЧИНИМ. Двухбуквенные соответствия (є, ж, ї, ч, ш, щ, ю, я) translate
-- не умеет по определению — он работает знак в знак. Поэтому они вынесены
-- в цепочку replace() ПЕРЕД translate, а в translate остались только
-- однобуквенные, и обе его строки теперь одной длины — это и есть починка
-- сдвига. Хвостом добавлены ь, ъ и оба апострофа: у них пары в замене нет,
-- и translate их удаляет. После этого — снятие всего, что не [a-z0-9-],
-- схлопывание подряд идущих дефисов и обрезка дефисов по краям, чтобы
-- «ТОВ "Ромашка"» не давало tov--romashka.
--
-- Однобуквенные соответствия НАМЕРЕННО оставлены прежними (г→g, х→h, ц→c,
-- й→j, и→y, і→i). Официальная транслитерация КМУ №55 дала бы г→h, х→kh,
-- ц→ts — то есть «Кава Друга» превратилась бы в kava-druha. Это была бы
-- уже смена правила именования, а не починка дефекта, и она поменяла бы
-- адрес каждой будущей витрины. Здесь чинится только сдвиг.
--
-- ⚠️ УЖЕ ВЫДАННЫЕ СЛАГИ НЕ ПЕРЕПИСЫВАЮТСЯ. Ни одного UPDATE по
-- public.tenants в этой миграции нет и быть не должно: slug — публичный
-- адрес витрины, он мог уйти в шапку Instagram, на визитки и печатные
-- материалы. Смена адреса задним числом ломает всё это молча и необратимо.
-- Миграция чинит БУДУЩЕЕ; прошлое остаётся как есть, и «salonepletinnjekis»
-- на бою — это не недоделка, а сознательно сохранённый рабочий адрес.
-- Если владелец конкретного заклада захочет красивый адрес — это отдельное
-- решение с редиректом со старого, а не массовая правка.
-- ===========================================================================


-- ── А. Пять функций, которым возвращается видимость операторов citext ────
--
-- Только конфигурация. Тела не трогаются: любая правка тела здесь — это
-- риск потерять то, что в них накопили 0050, 0054, 0081 и 0033.

alter function public.storefront(extensions.citext)
  set search_path to 'extensions';

alter function public.track_order(extensions.citext, bigint, text)
  set search_path to 'extensions';

alter function public.scan_lookup(uuid, extensions.citext)
  set search_path to 'extensions';

alter function public.create_invitation(uuid, text, public.member_role, jsonb, int)
  set search_path to 'extensions';

alter function public.accept_invitation(text)
  set search_path to 'extensions';

-- Правило 7: явные revoke/grant после каждой тронутой функции. ALTER
-- FUNCTION прав не меняет, но список открытого не должен зависеть от того,
-- помнит ли читатель предыдущие миграции. Ниже — ровно то, что было:
-- storefront и track_order остаются двумя из восьми анонимных точек,
-- остальные три анониму закрыты.

revoke all on function public.storefront(extensions.citext) from public;
grant execute on function public.storefront(extensions.citext) to anon, authenticated;

revoke all on function public.track_order(extensions.citext, bigint, text) from public;
grant execute on function public.track_order(extensions.citext, bigint, text) to anon, authenticated;

revoke all on function public.scan_lookup(uuid, extensions.citext) from public, anon;
grant execute on function public.scan_lookup(uuid, extensions.citext) to authenticated;

revoke all on function public.create_invitation(uuid, text, public.member_role, jsonb, int) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.member_role, jsonb, int) to authenticated;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;


-- ── Б. register_tenant: транслитерация без сдвига ────────────────────────
--
-- Тело перенесено из 0027 целиком; изменён только блок построения слага
-- (и то, что явный p_slug теперь берётся отдельной веткой, а не через
-- coalesce — иначе цепочка replace прошлась бы и по нему, а он обязан
-- попасть в базу ровно таким, каким его передали: это проверяет 12_citext).
-- search_path здесь остаётся пустым: сравнений citext в функции нет,
-- занятость слага ловит уникальный индекс, а он от search_path не зависит.

create or replace function public.register_tenant(
  p_name text,
  p_kind public.tenant_kind default 'goods'::public.tenant_kind,
  p_city text default null,
  p_slug extensions.citext default null
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_slug  text;
  v_row   public.tenants;
  v_try   int := 0;
begin
  if v_actor is null then
    raise exception 'реєстрація закладу потребує входу';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'назва закладу занадто коротка';
  end if;

  if (select count(*) from public.tenant_members tm
       join public.tenants t on t.id = tm.tenant_id
      where tm.user_id = v_actor and tm.role = 'owner' and t.status = 'draft') >= 3 then
    raise exception 'у вас уже три неопубліковані заклади — опублікуйте або видаліть їх';
  end if;

  if p_slug is not null then
    -- Явный слаг уходит в базу как есть: его выбрал человек.
    v_slug := p_slug::text;
  else
    -- Регистр опускается ПЕРВЫМ (это починка 0027: иначе заглавные буквы
    -- долетают до regexp_replace как есть и вылетают вместе с ним).
    v_slug := lower(btrim(p_name));

    -- Одна буква → две. translate так не умеет — именно попытка втиснуть
    -- «я → ja» в его таблицу и сдвинула её на символ.
    v_slug := replace(v_slug, 'є', 'ye');
    v_slug := replace(v_slug, 'ж', 'zh');
    v_slug := replace(v_slug, 'ї', 'yi');
    v_slug := replace(v_slug, 'ч', 'ch');
    v_slug := replace(v_slug, 'ш', 'sh');
    v_slug := replace(v_slug, 'щ', 'shch');
    v_slug := replace(v_slug, 'ю', 'yu');
    v_slug := replace(v_slug, 'я', 'ya');

    -- Однобуквенные. Обе строки по 28 знаков — пересчитывать при любой
    -- правке. Хвост «ьъ'’» пары не имеет: translate такие знаки удаляет.
    -- Пробел переводится в дефис — ради этого таблица и написана.
    v_slug := translate(v_slug,
      'абвгґдезиійклмнопрстуфхцыэё ьъ''’',
      'abvggdezyijklmnoprstufhcyee-');

    v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
    v_slug := btrim(regexp_replace(v_slug, '-{2,}', '-', 'g'), '-');
  end if;

  if length(v_slug) < 3 then
    v_slug := 'shop-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  -- Обрезка по длине может оставить дефис на конце — адрес «kava-» не нужен.
  v_slug := btrim(substr(v_slug, 1, 38), '-');

  loop
    begin
      insert into public.tenants (slug, name, kind, city, status)
      values (case when v_try = 0 then v_slug
                   else btrim(substr(v_slug, 1, 34), '-') || '-' || substr(gen_random_uuid()::text, 1, 3) end,
              btrim(p_name), p_kind, p_city, 'draft')
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 3 then raise; end if;
    end;
  end loop;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_row.id, v_actor, 'owner');

  return v_row;
end;
$fn$;

revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from public;
revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from anon;
grant execute on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) to authenticated;
