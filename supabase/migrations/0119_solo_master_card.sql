-- 0119. Заклад услуг заводится с карточкой мастера и рабочей неделей.
--
-- ── В чём была дыра ─────────────────────────────────────────────────────────
--
-- Найдено 19.08.2026 при разборе сценария соло-мастера. Человек
-- регистрируется, заводит заклад вида «послуги», публикует витрину,
-- ставит услугу — и на витрине есть кнопка «Записатися», а слотов нет
-- ни одного. Причина в том, что `available_slots` строит слоты по
-- карточкам мастеров и их рабочим часам, а `register_tenant` не заводил
-- ни того ни другого: ни одна строка `public.staff` не создавалась
-- нигде в продукте автоматически (проверено — единственный INSERT
-- живёт в экране списка мастеров, руками).
--
-- Соло-мастер обязан был догадаться зайти в Записи → Майстри, завести
-- САМ СЕБЯ карточкой и расставить рабочую неделю. Ничто на витрине
-- об этом не говорит: кнопка есть, слотов нет, причина невидима.
-- Молчаливая пустота дороже отказа — тот же урок, что с инспектором
-- (0083): её читают как «мастер занят навсегда», а не как «настройка
-- не доделана».
--
-- ── Что делает ──────────────────────────────────────────────────────────────
--
-- При создании заклада вида `services` или `both` заводится ОДНА карточка
-- мастера на владельца и рабочая неделя пн–пт 09:00–18:00. Для `goods`
-- не заводится ничего: магазину товаров карточка мастера не нужна,
-- и пустой раздел «Майстри» у него был бы мусором.
--
-- Почему заодно и расписание: карточка без рабочих часов не даёт ни
-- одного слота ровно так же, как её отсутствие. Починить половину
-- значит оставить ту же невидимую пустоту, только на шаг дальше.
--
-- Почему пн–пт 09:00–18:00, а не «спросить»: это умолчание, которое
-- видно и правится на карточке мастера в два нажатия, а вопрос в форме
-- регистрации — ещё один экран между человеком и работающим продуктом.
-- Умолчание, которое видно, честнее вопроса, на который отвечают
-- не глядя.
--
-- Почему `staff.user_id` = владелец: карточка привязывается к учётной
-- записи сразу. В КОНСПЕКТАХ это стояло отдельным долгом («staff.user_id
-- проставляется извне») — для владельца он этим закрывается.
--
-- ⚠️ ТЕЛО ВЗЯТО ИЗ 0084, а не из 0025. Функцию переписывали ПЯТЬ раз
-- (0016, 0025, 0027, 0084 плюс перевыдачи прав в 0030/0064/0081),
-- и действующая версия — 0084: там транслитерация переписана на
-- `replace` для двухбуквенных и `translate` для однобуквенных, потому
-- что попытка втиснуть «я → ja» в таблицу translate сдвинула её на
-- символ. Первая сборка этой миграции взяла тело 0025 — и тест 19
-- поймал возврат: «kavaedruga» вместо «kava-druga». Правило из
-- CLAUDE.md буквально: пишешь `or replace` — прочитай ДЕЙСТВУЮЩЕЕ
-- тело, а не первое найденное.

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
  v_staff uuid;
  v_name  text;
  v_wd    int;
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

  -- ── Новое в 0119: карточка мастера и рабочая неделя ──────────────────────
  -- Только для закладов с услугами: магазину товаров карточка мастера
  -- не нужна, и пустой раздел «Майстри» у него был бы мусором.
  if p_kind in ('services', 'both') then
    select nullif(btrim(coalesce(p.full_name, '')), '')
      into v_name
      from public.profiles p
     where p.id = v_actor;

    insert into public.staff (tenant_id, user_id, name, is_active, position)
    values (v_row.id, v_actor, coalesce(v_name, btrim(p_name)), true, 0)
    returning id into v_staff;

    -- 0 — воскресенье (0010), значит пн–пт это 1..5.
    foreach v_wd in array array[1, 2, 3, 4, 5] loop
      insert into public.working_hours (tenant_id, staff_id, weekday, starts_at, ends_at)
      values (v_row.id, v_staff, v_wd, time '09:00', time '18:00');
    end loop;
  end if;

  return v_row;
end;
$fn$;

comment on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) is
  'Создание заклада. Для kind services/both заодно заводится карточка '
  'мастера на владельца и рабочая неделя пн-пт 09:00-18:00 (0119): без '
  'них available_slots не отдаёт ни одного слота, и кнопка «Записатися» '
  'на витрине висит мёртвой.';

revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from public;
revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from anon;
revoke all on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) from authenticated;
grant execute on function public.register_tenant(text, public.tenant_kind, text, extensions.citext) to authenticated;
