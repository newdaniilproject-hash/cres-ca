-- 0131. Заклад запускає САМ ВЛАСНИК — і тільки з чернетки.
--
-- ── ЩО БУЛО ЗЛАМАНО ────────────────────────────────────────────────────────
--
-- `register_tenant` (0025/0027) створює заклад зі статусом `draft`. Далі
-- статус не міняв НІХТО: жоден файл застосунку і жодна функція бази не
-- пишуть у `tenants.status` (перевірено пошуком 25.08.2026). TRINITY_DREADS
-- стоїть `active` тому, що його перевели руками через редактор бази.
--
-- Наслідок був не косметичний. `create_order`, `create_booking`
-- і `available_slots` відмовляють при `status <> 'active'` (0006, 0010,
-- 0087), а `storefront` віддає сторінку лише активному закладу. Тобто
-- КОЖЕН новий продавець отримував заклад, у якому вітрина не працює,
-- замовлення не приймаються, і виправити це з продукту було нічим.
--
-- ── ЧОМУ САМЕ ТРИГЕР, А НЕ «ДОЗВОЛИТИ UPDATE» ──────────────────────────────
--
-- Політика `tenants_member_update` дозволяє змінювати БУДЬ-ЯКУ колонку тому,
-- у кого є `settings.write`, — і `status` теж. Тобто діра вже існувала
-- і без нового екрана: заклад, ПРИЗУПИНЕНИЙ платформою (`suspended`),
-- міг зняти призупинення сам звичайним UPDATE. Просто цим ніхто не
-- користувався, бо жоден екран статус не чіпав.
--
-- Тому межа ставиться в базі, а не в екрані: дозволений рівно один перехід
-- `draft → active`. Усе інше — призупинення, архівація, повернення
-- з `suspended` — лишається за платформою і йде службовим підключенням,
-- де `auth.uid()` порожній.
--
-- Це те саме правило проекту: «якщо політика не віддає (чи віддає зайве) —
-- лагодиться політика, а не додається обхід в екрані».

create or replace function public.tenants_status_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Службові підключення: міграції, cron, вебхуки на сервісному ключі.
  -- Та сама щілина, що в 0052, і з тієї самої причини — платформа
  -- призупиняє і архівує заклади саме звідти.
  if auth.uid() is null then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'active' then
    return new;
  end if;

  raise exception 'Статус закладу так не змінюють'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.tenants_status_guard() from public;
revoke execute on function public.tenants_status_guard() from anon;
revoke execute on function public.tenants_status_guard() from authenticated;

drop trigger if exists tenants_status_guard on public.tenants;
create trigger tenants_status_guard
  before update of status on public.tenants
  for each row execute function public.tenants_status_guard();

comment on function public.tenants_status_guard() is
  'Власник запускає заклад сам: дозволений тільки перехід draft → active. '
  'Призупинення і архівацію робить платформа службовим підключенням.';
