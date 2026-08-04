-- 0014_compliance.sql
-- Санитарный учёт косметики: партии, PAO, журналы дезинфекции, техкарты.
--
-- Повод — первый клиент: брейдинг-салон с ТЗ на compliant-учёт по
-- Техрегламенту №65 КМУ (гармонизирован с EU 1223/2009) и нормам
-- Держпродспоживслужбы. Но модуль строится НЕ под один салон: партия
-- с термином придатності и «вскрытая ёмкость с PAO» нужны любому, кто
-- расходует косметику, — маникюр, массаж, барбершоп, татуаж. Поэтому
-- это слой платформы поверх materials, а не отдельное приложение.
--
-- Что здесь опирается на уже построенное:
--   расходники и их остатки  → materials + журнал движений (0003)
--   поставщики               → suppliers (0009)
--   сканер QR/штрихкодов     → scan_lookup (0009), расширяется ёмкостями
--   уведомления «за 14/7 дней» → notification_outbox (0011): та же
--     механика, что напоминания о записи — ставятся В МОМЕНТ вскрытия
--     со временем отправки в будущем, а не ежечасным перебором
--   неизменяемый журнал (Audit Trail из ТЗ) → тот же приём, что
--     в finance_records: append-only, запрет UPDATE/DELETE триггером,
--     автор обязателен
--
-- Роль «Инспектор» из ТЗ — это НАША роль в матрице прав: видит реестр
-- косметики, журналы и статусы, не видит ни клиентов, ни финансы,
-- ни заказы. Права как данные (ADR 0002) — ни строчки кода.

-- ─────────────────────────────────────────────────────────────────────────────
-- Косметический паспорт расходника
-- ─────────────────────────────────────────────────────────────────────────────
-- Поля из карточки ТЗ 3.1. Все nullable: обычной нитке они не нужны,
-- косметике — заполняются.

alter table public.materials
  add column brand             text,
  add column country_of_origin text,
  add column inci              text,     -- состав по международной номенклатуре
  -- Код в Единой системе электронной нотификации косметической
  -- продукции МОЗ. Требование техрегламента к продукции на рынке.
  add column notification_code text,
  -- PAO с крышечки: сколько месяцев годен после вскрытия.
  add column pao_months        int check (pao_months > 0),
  add column is_cosmetic       boolean not null default false;

-- Документы к средству: паспорт безопасности MSDS, сертификат качества,
-- заключение СЭС. Файл лежит в Storage, здесь — учётная запись о нём.
create type public.material_doc_kind as enum
  ('msds', 'quality_cert', 'ses_conclusion', 'notification', 'other');

create table public.material_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,

  kind        public.material_doc_kind not null default 'other',
  title       text not null check (length(btrim(title)) > 0),
  path        text not null,             -- путь в Storage
  uploaded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index material_documents_material_idx on public.material_documents (material_id);
create index material_documents_tenant_idx   on public.material_documents (tenant_id);
create index material_documents_uploaded_by_idx on public.material_documents (uploaded_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- Партии: номер и срок годности
-- ─────────────────────────────────────────────────────────────────────────────
-- Прослеживаемость по требованию регламента: какая партия, до какого
-- числа годна, от какого поставщика пришла. Количество ЖИВЁТ В ЖУРНАЛЕ
-- ДВИЖЕНИЙ, как и раньше, — партия это метаданные прослеживаемости,
-- а не второй, параллельный учёт остатка.

create table public.material_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  material_id  uuid not null references public.materials(id) on delete cascade,

  batch_number text not null check (length(btrim(batch_number)) > 0),
  expiry_date  date not null,
  received_at  date not null default current_date,
  supplier_id  uuid references public.suppliers(id) on delete set null,
  note         text,

  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),

  unique (tenant_id, material_id, batch_number)
);

create index material_batches_material_idx on public.material_batches (material_id, expiry_date);
create index material_batches_tenant_idx   on public.material_batches (tenant_id, expiry_date);
create index material_batches_supplier_idx on public.material_batches (supplier_id) where supplier_id is not null;
create index material_batches_created_by_idx on public.material_batches (created_by);

-- Строка приёмки может указывать, какая партия пришла.
alter table public.stock_receipt_lines
  add column batch_id uuid references public.material_batches(id) on delete set null;

create index stock_receipt_lines_batch_idx on public.stock_receipt_lines (batch_id)
  where batch_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ёмкости: вскрытие, PAO, розлив, QR
-- ─────────────────────────────────────────────────────────────────────────────
-- Физическая банка или рабочий дозатор, в который отлили из большой
-- ёмкости (ТЗ 3.2). У каждой — свой код для наклейки, статус и срок
-- «использовать до», который база считает сама: вскрытая банка годна
-- до МЕНЬШЕЙ из дат «срок партии» и «вскрытие + PAO». Рука мастера
-- в этой формуле не участвует — значит и ошибиться в ней нельзя.

create type public.container_status as enum ('sealed', 'opened', 'finished', 'disposed');

create table public.material_containers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  material_id  uuid not null references public.materials(id) on delete cascade,
  batch_id     uuid references public.material_batches(id) on delete restrict,

  -- Код на наклейке. Печатается при заведении/розливе, сканируется
  -- мастером. Уникален в пределах магазина.
  code         text not null,
  -- Розлив: из какой ёмкости отлито (ТЗ: «розлив в рабочий дозатор»).
  parent_id    uuid references public.material_containers(id) on delete set null,
  volume       numeric check (volume > 0),
  unit         text,

  status       public.container_status not null default 'sealed',
  opened_at    timestamptz,
  opened_by    uuid references public.profiles(id),
  -- Перекрытие PAO для конкретной ёмкости; null = берём с материала.
  pao_months   int check (pao_months > 0),
  -- Считается триггером. Прямой правке не подлежит.
  use_by       date,

  disposed_at  timestamptz,
  disposed_by  uuid references public.profiles(id),
  note         text,

  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, code)
);

create index material_containers_material_idx on public.material_containers (material_id, status);
create index material_containers_tenant_idx   on public.material_containers (tenant_id, status);
create index material_containers_batch_idx    on public.material_containers (batch_id) where batch_id is not null;
create index material_containers_parent_idx   on public.material_containers (parent_id) where parent_id is not null;
create index material_containers_useby_idx    on public.material_containers (tenant_id, use_by)
  where status = 'opened';
create index material_containers_opened_by_idx  on public.material_containers (opened_by)  where opened_by is not null;
create index material_containers_disposed_by_idx on public.material_containers (disposed_by) where disposed_by is not null;
create index material_containers_created_by_idx on public.material_containers (created_by);

create trigger material_containers_touch
  before update on public.material_containers
  for each row execute function public.touch_updated_at();

-- Инварианты ёмкости + расчёт use_by + постановка предупреждений.
create or replace function public.containers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pao    int;
  v_expiry date;
  v_name   text;
begin
  -- Факт вскрытия не переписывается и не стирается: это запись журнала,
  -- а не поле настроек. Ошиблись банкой — списывают её и заводят новую.
  if tg_op = 'UPDATE' and old.opened_at is not null
     and new.opened_at is distinct from old.opened_at then
    raise exception 'дата вскрытия не редактируется: ошибочную ёмкость списывают, а не переоткрывают';
  end if;

  if new.status in ('opened') and new.opened_at is null then
    new.opened_at := now();
  end if;
  if new.opened_at is not null and new.opened_by is null then
    new.opened_by := auth.uid();
  end if;
  if new.opened_at is not null and new.status = 'sealed' then
    new.status := 'opened';
  end if;
  if new.status = 'disposed' and new.disposed_at is null then
    new.disposed_at := now();
    new.disposed_by := coalesce(new.disposed_by, auth.uid());
  end if;

  -- use_by: меньшая из дат «срок партии» и «вскрытие + PAO».
  select coalesce(new.pao_months, m.pao_months), m.name
    into v_pao, v_name
    from public.materials m where m.id = new.material_id;
  select b.expiry_date into v_expiry
    from public.material_batches b where b.id = new.batch_id;

  new.use_by := least(
    v_expiry,
    case when new.opened_at is not null and v_pao is not null
         then (new.opened_at + make_interval(months => v_pao))::date
         end
  );

  -- Срок изменился (например, привязали другую партию) — старые
  -- предупреждения с прежней датой больше не верны, гасим.
  if tg_op = 'UPDATE' and new.use_by is distinct from old.use_by then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  -- Предупреждения за 14 и 7 дней до конца срока — в очередь 0011,
  -- тем же приёмом, что напоминания о записи. Ключ идемпотентности
  -- не даст поставить их дважды.
  if new.use_by is not null and new.status in ('sealed','opened') then
    perform public.enqueue_notification(
      new.tenant_id, 'cosmetics.expiry_14d', 'push',
      format('container:%s:d14:%s', new.id, new.use_by),
      jsonb_build_object('material', v_name, 'code', new.code, 'use_by', new.use_by),
      (new.use_by - 14)::timestamptz, null, null, null, null,
      'container', new.id)
    where (new.use_by - 14)::timestamptz > now();

    perform public.enqueue_notification(
      new.tenant_id, 'cosmetics.expiry_7d', 'push',
      format('container:%s:d7:%s', new.id, new.use_by),
      jsonb_build_object('material', v_name, 'code', new.code, 'use_by', new.use_by),
      (new.use_by - 7)::timestamptz, null, null, null, null,
      'container', new.id)
    where (new.use_by - 7)::timestamptz > now();
  end if;

  -- Списанная/закончившаяся ёмкость гасит свои неотправленные предупреждения.
  if new.status in ('finished','disposed') then
    update public.notification_outbox
       set status = 'cancelled'
     where ref_type = 'container' and ref_id = new.id and status = 'pending';
  end if;

  return new;
end;
$$;

create trigger material_containers_guard
  before insert or update on public.material_containers
  for each row execute function public.containers_guard();

revoke execute on function public.containers_guard() from public, anon, authenticated;

-- Шаблоны предупреждений.
insert into public.notification_templates (tenant_id, event, channel, locale, subject, body) values
  (null, 'cosmetics.expiry_14d', 'push', 'uk', null,
   '{{material}} ({{code}}): термін придатності спливає {{use_by}} — за 14 днів'),
  (null, 'cosmetics.expiry_7d', 'push', 'uk', null,
   '{{material}} ({{code}}): термін придатності спливає {{use_by}} — за 7 днів!'),
  (null, 'cosmetics.expiry_14d', 'email', 'uk', 'Термін придатності: 14 днів',
   'Засіб {{material}}, ємність {{code}}: використати до {{use_by}}.'),
  (null, 'cosmetics.expiry_7d', 'email', 'uk', 'Термін придатності: 7 днів',
   'Засіб {{material}}, ємність {{code}}: використати до {{use_by}}. Сплануйте заміну.')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Журналы санитарии (ТЗ 3.3) — append-only, как финансовые записи
-- ─────────────────────────────────────────────────────────────────────────────
-- Общий охранник: запись журнала не редактируется и не удаляется.
-- Ошибка исправляется новой записью с примечанием. Это и есть
-- «незмінюваний журнал подій» из требований ТЗ — то, что проверяющий
-- может считать доказательством, а не файлом, который переписали
-- вечером перед проверкой.

create or replace function public.journal_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'запись санитарного журнала неизменяема — ошибка исправляется новой записью';
end;
$$;

revoke execute on function public.journal_guard() from public, anon, authenticated;

-- Приготовление дезрастворов: средство, концентрация, объём, срок
-- годности рабочего раствора.
create table public.sanitation_solutions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,

  agent_name     text not null check (length(btrim(agent_name)) > 0),
  -- Номер госрегистрации дезсредства в Украине (проверка из ТЗ).
  registration   text,
  concentration  text not null,          -- «0,5%»
  volume         numeric not null check (volume > 0),
  unit           text not null default 'л',
  prepared_at    timestamptz not null default now(),
  expires_at     timestamptz not null,

  prepared_by    uuid not null references public.profiles(id),
  note           text,
  created_at     timestamptz not null default now(),

  check (expires_at > prepared_at)
);

create index sanitation_solutions_tenant_idx on public.sanitation_solutions (tenant_id, prepared_at desc);
create index sanitation_solutions_prepared_by_idx on public.sanitation_solutions (prepared_by);

create trigger sanitation_solutions_lock
  before update or delete on public.sanitation_solutions
  for each row execute function public.journal_guard();

-- Уборка и кварцевание: чек-лист задаёт продавец, отметки — журнал.
create table public.cleaning_tasks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  -- Периодичность словами для чек-листа: «щодня», «щотижня», «після клієнта».
  schedule   text,
  position   int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  unique (tenant_id, name)
);

create index cleaning_tasks_tenant_idx on public.cleaning_tasks (tenant_id, position) where is_active;

create table public.cleaning_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  task_id      uuid not null references public.cleaning_tasks(id) on delete restrict,
  performed_at timestamptz not null default now(),
  performed_by uuid not null references public.profiles(id),
  note         text,
  created_at   timestamptz not null default now()
);

create index cleaning_entries_tenant_idx on public.cleaning_entries (tenant_id, performed_at desc);
create index cleaning_entries_task_idx   on public.cleaning_entries (task_id);
create index cleaning_entries_performed_by_idx on public.cleaning_entries (performed_by);

create trigger cleaning_entries_lock
  before update or delete on public.cleaning_entries
  for each row execute function public.journal_guard();

-- Стерилизация инструментов: циклы сухожара/автоклава.
create table public.sterilization_cycles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,

  device         text not null,                  -- «сухожарова шафа», «автоклав»
  temperature_c  int  not null check (temperature_c > 0),
  duration_minutes int not null check (duration_minutes > 0),
  -- Индикатор: сменил ли цвет. Провал цикла — тоже запись, это журнал.
  indicator_ok   boolean not null,
  indicator_note text,

  performed_at   timestamptz not null default now(),
  performed_by   uuid not null references public.profiles(id),
  note           text,
  created_at     timestamptz not null default now()
);

create index sterilization_cycles_tenant_idx on public.sterilization_cycles (tenant_id, performed_at desc);
create index sterilization_cycles_performed_by_idx on public.sterilization_cycles (performed_by);

create trigger sterilization_cycles_lock
  before update or delete on public.sterilization_cycles
  for each row execute function public.journal_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- Технологические карты обработки (ТЗ 3.4)
-- ─────────────────────────────────────────────────────────────────────────────
-- Регламент вымачивания/подготовки волокна: растворы, пропорции, время.
-- ВЕРСИОННЫЕ: изменение регламента = новая версия, старая остаётся —
-- иначе не доказать, по какой карте работали в прошлом месяце.
-- Не путать с variant_materials (0003): та отвечает «сколько списать»,
-- эта — «как делать безопасно».

create table public.tech_cards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- К какой услуге относится; null = общая для салона.
  offering_id uuid references public.offerings(id) on delete set null,

  title       text not null check (length(btrim(title)) > 0),
  version     int  not null default 1 check (version > 0),
  -- Шаги: [{"step": "замочування", "solution": "...", "proportion": "1:10",
  --         "minutes": 15, "note": "..."}]
  steps       jsonb not null default '[]'::jsonb,

  is_active   boolean not null default true,
  approved_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),

  unique (tenant_id, title, version)
);

create index tech_cards_tenant_idx   on public.tech_cards (tenant_id) where is_active;
create index tech_cards_offering_idx on public.tech_cards (offering_id) where offering_id is not null;
create index tech_cards_approved_by_idx on public.tech_cards (approved_by);

-- Утверждённая версия неизменна: правка = новая версия.
create or replace function public.tech_cards_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'техкарта не удаляется: снимите флаг is_active';
  end if;
  if new.steps is distinct from old.steps
     or new.title is distinct from old.title
     or new.version is distinct from old.version then
    raise exception 'утверждённая версия техкарты неизменна — заведите следующую версию';
  end if;
  return new;
end;
$$;

create trigger tech_cards_lock
  before update or delete on public.tech_cards
  for each row execute function public.tech_cards_guard();

revoke execute on function public.tech_cards_guard() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Сканер: ёмкость по коду с наклейки
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.scan_container(p_tenant_id uuid, p_code text)
returns table (
  id uuid, material text, code text, status public.container_status,
  batch_number text, use_by date, days_left int, expired boolean,
  opened_at timestamptz, volume numeric, unit text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, m.name, c.code, c.status,
         b.batch_number, c.use_by,
         (c.use_by - current_date)::int,
         coalesce(c.use_by < current_date, false),
         c.opened_at, c.volume, coalesce(c.unit, m.unit)
    from public.material_containers c
    join public.materials m on m.id = c.material_id
    left join public.material_batches b on b.id = c.batch_id
   where c.tenant_id = p_tenant_id
     and c.code = p_code
     and public.tenant_can(p_tenant_id, 'compliance.read')
   limit 1;
$$;

revoke execute on function public.scan_container(uuid, text) from public, anon;
grant  execute on function public.scan_container(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Права: новая зона compliance
-- ─────────────────────────────────────────────────────────────────────────────
-- Отдельная зона, а не stock.*: у инспектора будет доступ к санитарии
-- и реестру, но не к остаткам в деньгах и не к клиентам.

insert into public.role_grants (role, permission) values
  ('admin','compliance.read'),    ('admin','compliance.write'),
  ('manager','compliance.read'),  ('manager','compliance.write'),
  -- Мастер сканирует, отмечает вскрытие и дезинфекцию — ему нужна запись.
  ('operator','compliance.read'), ('operator','compliance.write'),
  ('viewer','compliance.read');

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.material_documents   enable row level security;
alter table public.material_batches     enable row level security;
alter table public.material_containers  enable row level security;
alter table public.sanitation_solutions enable row level security;
alter table public.cleaning_tasks       enable row level security;
alter table public.cleaning_entries     enable row level security;
alter table public.sterilization_cycles enable row level security;
alter table public.tech_cards           enable row level security;

-- Один шаблон на все восемь таблиц: чтение по compliance.read,
-- запись по compliance.write. У журналов UPDATE/DELETE-политик нет
-- вовсе — их неизменяемость двойная: нет политики И стоит триггер.

create policy material_documents_read on public.material_documents
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy material_documents_insert on public.material_documents
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and uploaded_by = (select auth.uid()));
create policy material_documents_delete on public.material_documents
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('compliance.write')));

create policy material_batches_read on public.material_batches
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy material_batches_insert on public.material_batches
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and created_by = (select auth.uid()));
create policy material_batches_update on public.material_batches
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('compliance.write')))
  with check (tenant_id in (select public.tenants_with('compliance.write')));

create policy material_containers_read on public.material_containers
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy material_containers_insert on public.material_containers
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and created_by = (select auth.uid()));
create policy material_containers_update on public.material_containers
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('compliance.write')))
  with check (tenant_id in (select public.tenants_with('compliance.write')));

create policy sanitation_solutions_read on public.sanitation_solutions
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy sanitation_solutions_insert on public.sanitation_solutions
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and prepared_by = (select auth.uid()));

create policy cleaning_tasks_read on public.cleaning_tasks
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy cleaning_tasks_insert on public.cleaning_tasks
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write')));
create policy cleaning_tasks_update on public.cleaning_tasks
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('compliance.write')))
  with check (tenant_id in (select public.tenants_with('compliance.write')));

create policy cleaning_entries_read on public.cleaning_entries
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy cleaning_entries_insert on public.cleaning_entries
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and performed_by = (select auth.uid()));

create policy sterilization_cycles_read on public.sterilization_cycles
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy sterilization_cycles_insert on public.sterilization_cycles
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and performed_by = (select auth.uid()));

create policy tech_cards_read on public.tech_cards
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));
create policy tech_cards_insert on public.tech_cards
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('compliance.write'))
              and approved_by = (select auth.uid()));
create policy tech_cards_update on public.tech_cards
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('compliance.write')))
  with check (tenant_id in (select public.tenants_with('compliance.write')));

-- ─────────────────────────────────────────────────────────────────────────────
-- Роль «инспектор»: значение перечисления
-- ─────────────────────────────────────────────────────────────────────────────
-- Последним стейтментом файла сознательно: новое значение enum нельзя
-- ИСПОЛЬЗОВАТЬ в транзакции, где оно создано, — набор его прав живёт
-- в 0015. Именно в таком виде файл применён в бой.
alter type public.member_role add value if not exists 'inspector';
