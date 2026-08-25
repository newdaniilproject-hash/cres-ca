-- 0129. Налаштування сповіщень — право адміністратора з ТЗ 2.
--
-- ── ЩО ВИМАГАЄ ТЗ І ЧОГО НЕ БУЛО ───────────────────────────────────────────
--
-- ТЗ 2 перелічує права ролі «Адміністратор / Керівник» і серед них дослівно
-- «НАЛАШТУВАННЯ СПОВІЩЕНЬ». Такого екрана не існувало взагалі: отримувачі
-- обчислювались усередині `enqueue_expiry_for` як «всі, у кого stock.read»,
-- канали були прибиті намертво (email + push кожному), і вимкнути або
-- перенаправити їх із продукту було нічим. Знайдено аудитом ТЗ 25.08.2026.
--
-- Практично це означало: у салоні з чотирма майстрами попередження про
-- термін придатності о шостій ранку дзвонить у чотирьох телефонах разом.
-- Власник не має способу сказати «шліть тільки мені».
--
-- ── ЧОГО ТУТ СВІДОМО НЕМАЄ: ПОРОГІВ 14 І 7 ─────────────────────────────────
--
-- Спокуса — винести їх у налаштування «заодно». Не винесено, і це рішення,
-- а не пропуск. Числа 14 і 7 названі в ТЗ (розділ 3.2) і є частиною того,
-- ЩО МИ ОБІЦЯЄМО ПЕРЕВІРЦІ. Заклад, який поставить собі «за 1 день»,
-- отримає формально працюючу систему і зіпсований сенс: попередження,
-- яке приходить, коли зробити вже нічого не можна. А відповідати за це
-- будемо ми, бо поле дали ми.
--
-- Даними тут стає те, що є СПРАВОЮ ЗАКЛАДУ — кому і куди слати. Кодом
-- лишається те, що є вимогою регламенту, — коли слати. Це рівно межа
-- з CLAUDE.md: «даними — те, що змінюється; кодом — те, що інваріантне».
--
-- ── ЧОМУ ВІДСУТНІЙ РЯДОК = СЬОГОДНІШНЯ ПОВЕДІНКА ───────────────────────────
--
-- Міграція чіпає ЄДИНИЙ шлях сповіщень, який реально працює на бою
-- (перевірено: `cosmetics.expiry_7d` — 11 листів і 11 пушів зі статусом
-- `sent`). Помилка тут означає, що попередження про термін придатності
-- перестають ходити взагалі — найдорожча відмова в цьому продукті.
--
-- Тому: таблиця порожня, `coalesce` дає ті самі значення, що зашиті
-- сьогодні, і жоден заклад не помічає накату. Налаштування починає діяти
-- рівно тоді, коли людина його змінила.

create table if not exists public.notification_settings (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,

  -- Канали попереджень про термін придатності.
  expiry_email boolean not null default true,
  expiry_push  boolean not null default true,

  -- Кому слати. Закритий список, а не довільний масив користувачів:
  -- масив розійшовся б зі складом команди мовчки — людину вивели,
  -- а вона лишилась у списку отримувачів (та сама граблі, що й у 0080
  -- з раннім виходом по списку колонок).
  --   stock_read — усі, хто бачить склад. Так було до 0129 і так лишається
  --                за замовчуванням.
  --   owner_only — тільки власник закладу.
  expiry_recipients text not null default 'stock_read'
    check (expiry_recipients in ('stock_read', 'owner_only')),

  updated_at timestamptz not null default now()
);

comment on table public.notification_settings is
  'Кому і куди слати попередження про термін придатності. Пороги 14/7 '
  'сюди НЕ винесені навмисно: вони з ТЗ і є частиною обіцянки перевірці.';

drop trigger if exists notification_settings_touch on public.notification_settings;
create trigger notification_settings_touch
  before update on public.notification_settings
  for each row execute function public.touch_updated_at();

alter table public.notification_settings enable row level security;

drop policy if exists notification_settings_read on public.notification_settings;
create policy notification_settings_read on public.notification_settings
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read')));

drop policy if exists notification_settings_write on public.notification_settings;
create policy notification_settings_write on public.notification_settings
  for all to authenticated
  using (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

revoke all on public.notification_settings from public, anon;
grant select, insert, update, delete on public.notification_settings to authenticated;

-- ── Черга попереджень читає налаштування ───────────────────────────────────
--
-- ⚠️ `create or replace` СТИРАЄ ТІЛО ЦІЛКОМ. Правило проекту: «пишеш
-- or replace — прочитай чинне тіло і перенеси руками все, чого не збирався
-- чіпати». Тіло нижче — це чинне тіло з бою, знято `pg_get_functiondef`
-- 25.08.2026, і в ньому змінено РІВНО ДВА місця: умова добору отримувачів
-- і дві перевірки каналу. Догоняюча гілка «завели пізно — йде одразу»,
-- ключі дедуплікації, формат payload і порядок аргументів `enqueue_
-- notification` перенесені без жодної правки.
create or replace function public.enqueue_expiry_for(
  p_tenant uuid, p_ref_type text, p_ref_id uuid,
  p_code text, p_material text, p_use_by date)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r         record;
  v_payload jsonb;
  v_email   boolean;
  v_push    boolean;
  v_who     text;
begin
  if p_use_by is null then
    return;
  end if;

  -- Відсутній рядок = поведінка до 0129. Саме тому coalesce, а не join.
  select coalesce(s.expiry_email, true), coalesce(s.expiry_push, true),
         coalesce(s.expiry_recipients, 'stock_read')
    into v_email, v_push, v_who
    from (select 1) z
    left join public.notification_settings s on s.tenant_id = p_tenant;

  -- Обидва канали вимкнені — слати нічого. Виходимо до циклу: інакше
  -- прогін по команді робився б ні за чим.
  if not v_email and not v_push then
    return;
  end if;

  v_payload := jsonb_build_object(
    'material', coalesce(p_material, '—'),
    'code',     coalesce(p_code, '—'),
    'use_by',   to_char(p_use_by, 'DD.MM.YYYY'));

  for r in
    select tm.user_id, p.email, coalesce(p.locale, 'uk') as locale
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.tenant_id = p_tenant
       and (
            -- Власник отримує завжди: це його заклад і його штраф.
            tm.role = 'owner'
         or (v_who = 'stock_read' and (
              tm.permissions ->> 'stock.read' = 'true'
           or (
                exists (select 1 from public.role_grants rg
                         where rg.role = tm.role and rg.permission = 'stock.read')
                and coalesce(tm.permissions ->> 'stock.read', 'true') <> 'false'
              )))
       )
  loop
    -- За 14 дней. Срок уже прошёл — не досылаем: см. шапку.
    if (p_use_by - 14)::timestamptz > now() then
      if v_email and r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_14d', 'email',
          format('%s:%s:d14:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 14)::timestamptz,
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      if v_push then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_14d', 'push',
          format('%s:%s:d14:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 14)::timestamptz,
          r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
      end if;
    end if;

    -- За 7 дней, с догоняющей веткой: завели поздно — уходит сразу.
    if (p_use_by - 7)::timestamptz > now() then
      if v_email and r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('%s:%s:d7:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 7)::timestamptz,
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      if v_push then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'push',
          format('%s:%s:d7:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, (p_use_by - 7)::timestamptz,
          r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
      end if;
    elsif p_use_by >= current_date then
      if v_email and r.email is not null then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'email',
          format('%s:%s:d7:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, now(),
          r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
      end if;
      if v_push then
        perform public.enqueue_notification(
          p_tenant, 'cosmetics.expiry_7d', 'push',
          format('%s:%s:d7:push:%s:%s', p_ref_type, p_ref_id, p_use_by, r.user_id),
          v_payload, now(),
          r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
      end if;
    end if;
  end loop;
end;
$function$;

revoke execute on function
  public.enqueue_expiry_for(uuid, text, uuid, text, text, date) from public;
revoke execute on function
  public.enqueue_expiry_for(uuid, text, uuid, text, text, date) from anon;
revoke execute on function
  public.enqueue_expiry_for(uuid, text, uuid, text, text, date) from authenticated;
