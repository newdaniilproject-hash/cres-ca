-- 0123. Колір бренду закладу: одна вісь кастомізації, і тільки одна.
--
-- ── Навіщо ──────────────────────────────────────────────────────────────────
--
-- Рішення власника 19.08.2026: кожен клієнт має відчувати продукт своїм,
-- при тому що сервіс один, репозиторій один і викат один. Гілка на клієнта
-- заборонена — вона означає окрему збірку, окремий деплой і те, що на
-- п'ятому клієнті баги перестають чинитися. Різниця живе РЯДКОМ У БАЗІ.
--
-- ── Чому тільки ВІДТІНОК, а не палітра ──────────────────────────────────────
--
-- Це не обережність, а вже оплачений урок: палітр у продукті було ЧОТИРИ,
-- і три з них ніхто не міняв при зміні оформлення — клієнт ніс на перевірку
-- документ у кольорах, яких у застосунку немає. Віддати клієнту фон,
-- поверхні й межі означає завести N палітр замість чотирьох, і сторож
-- `check:tokens` перестане мати з чим звіряти.
--
-- Тому клієнт вибирає ВІДТІНОК, а не колір: із його значення береться
-- тільки `h`, а світлота й насиченість лишаються наші. Дві причини:
--   • контраст. Блідо-жовтий акцент зробив би білий текст на кнопці
--     нечитабельним, і жодна перевірка цього б не спіймала;
--   • акцент має лишатися акцентом. Пастель на кнопці дії — це не бренд,
--     це зламана кнопка.
-- Відчуття «мій фірмовий колір» при цьому зберігається повністю.
--
-- ── Межі ────────────────────────────────────────────────────────────────────
--
-- Бренд бачать УЧАСНИКИ закладу. Вітрини це не торкається: анонімних
-- точок вісім, список закритий (правило 7), і дев'ята заводиться окремим
-- рішенням, а не побічним ефектом кастомізації.

create table if not exists public.tenant_branding (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  -- Значення, яке вибрав клієнт. Зберігаємо як він вибрав, а не як ми його
  -- обрізали: інакше «поверни як було» не має що повертати. Обрізає його
  -- сторінка — рівно в момент показу.
  brand_color text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path   text,
  updated_at  timestamptz not null default now()
);

comment on table public.tenant_branding is
  'Відтінок бренду і логотип закладу. Кастомізується ОДНА вісь — акцент; '
  'фон, поверхні, межі й типографічна шкала спільні, бо вони і є продукт.';

comment on column public.tenant_branding.brand_color is
  'HEX, вибраний клієнтом. На екрані з нього береться ТІЛЬКИ відтінок: '
  'світлота й насиченість наші, інакше блідий акцент дає нечитабельну кнопку.';

-- `create table if not exists` вище робить файл повторюваним, а `create
-- trigger` — ні: другий прогін падає на «trigger already exists» і відкочує
-- усе, що йде НИЖЧЕ, тобто політики й гранти. Знято 20.08.2026, коли файл
-- запустили вдруге.
drop trigger if exists tenant_branding_touch on public.tenant_branding;
create trigger tenant_branding_touch
  before update on public.tenant_branding
  for each row execute function public.touch_updated_at();

alter table public.tenant_branding enable row level security;

-- Читають учасники закладу — тим самим правом, що й решту налаштувань.
drop policy if exists tenant_branding_read on public.tenant_branding;
create policy tenant_branding_read on public.tenant_branding
  for select to authenticated
  using (tenant_id in (select public.tenants_with('settings.read')));

drop policy if exists tenant_branding_write on public.tenant_branding;
create policy tenant_branding_write on public.tenant_branding
  for all to authenticated
  using (tenant_id in (select public.tenants_with('settings.write')))
  with check (tenant_id in (select public.tenants_with('settings.write')));

revoke all on public.tenant_branding from public, anon;
grant select, insert, update, delete on public.tenant_branding to authenticated;
