-- 0007_finance_reminders.sql
-- Финансы магазина и напоминания по клиентам.
--
-- Уроки прошлого проекта, зашитые сюда:
--
--   1. У КАЖДОЙ ФИНАНСОВОЙ ЗАПИСИ ЕСТЬ АВТОР. В боевой базе прошлого
--      проекта created_by у финансовых записей был необязательным —
--      запись о деньгах могла существовать без ответа «кто её внёс».
--      Здесь автор обязателен всегда.
--
--   2. ДОХОД ОТ ЗАКАЗА — РОВНО ОДИН. Автозапись дохода создаётся при
--      переходе заказа в «оплачен» и защищена уникальным индексом:
--      повторный переход (paid → cancelled → … → paid) не задвоит доход,
--      а скорректирует существующую запись.
--
--   3. ЗАПИСЬ О ДЕНЬГАХ НЕ РЕДАКТИРУЕТСЯ ЗАДНИМ ЧИСЛОМ. Сумму и вид
--      менять нельзя — ошибка исправляется встречной записью, как
--      в журнале движений остатков. Править можно только заметку
--      и категорию.
--
-- Напоминания — часть клиентской базы («перезвонить», «предложить
-- повтор», «день рождения»), поэтому и права у них клиентские:
-- customers.read / customers.write.

-- ─────────────────────────────────────────────────────────────────────────────
-- Категории и записи
-- ─────────────────────────────────────────────────────────────────────────────

create type public.finance_kind as enum ('income', 'expense');

create table public.finance_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kind       public.finance_kind not null,
  name       text not null check (length(btrim(name)) > 0),
  position   int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  unique (tenant_id, kind, name)
);

create index finance_categories_tenant_idx on public.finance_categories (tenant_id, kind)
  where is_active;

create table public.finance_records (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  kind        public.finance_kind not null,
  amount      numeric not null check (amount > 0),
  category_id uuid references public.finance_categories(id) on delete set null,

  -- Автодоход от заказа. Для ручных записей — null.
  order_id    uuid references public.orders(id) on delete set null,

  note        text,
  occurred_on date not null default current_date,

  -- Автор обязателен. Для автозаписи от гостевого заказа автором
  -- становится владелец магазина — деньги без ответственного не бывают.
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- Один автодоход на заказ. Это и есть защита от задвоения.
create unique index finance_records_order_income_idx
  on public.finance_records (order_id)
  where order_id is not null and kind = 'income';

create index finance_records_tenant_idx on public.finance_records (tenant_id, occurred_on desc);
create index finance_records_category_idx on public.finance_records (category_id)
  where category_id is not null;
create index finance_records_created_by_idx on public.finance_records (created_by);

-- Финансовая запись неизменяема в сумме и виде.
create or replace function public.finance_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'финансовая запись не удаляется — ошибка исправляется встречной записью';
  end if;
  if new.amount is distinct from old.amount
     or new.kind is distinct from old.kind
     or new.order_id is distinct from old.order_id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by then
    raise exception 'сумма, вид и принадлежность записи не правятся — только заметка и категория';
  end if;
  return new;
end;
$$;

create trigger finance_records_guard
  before update or delete on public.finance_records
  for each row execute function public.finance_records_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- Автодоход при оплате заказа
-- ─────────────────────────────────────────────────────────────────────────────
-- Триггер на переход в 'paid'. Автор записи: кто перевёл статус, а если
-- перевёл не человек (гостевые сценарии будущего) — владелец магазина.

create or replace function public.orders_income_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if new.status = 'paid' and old.status is distinct from new.status and new.total > 0 then
    v_actor := auth.uid();
    if v_actor is null then
      select tm.user_id into v_actor from public.tenant_members tm
       where tm.tenant_id = new.tenant_id and tm.role = 'owner' limit 1;
    end if;
    if v_actor is null then
      raise exception 'не найден автор для записи дохода по заказу %', new.number;
    end if;

    insert into public.finance_records (tenant_id, kind, amount, order_id, note, created_by)
    values (new.tenant_id, 'income', new.total, new.id,
            format('оплата заказа №%s', new.number), v_actor)
    on conflict (order_id) where order_id is not null and kind = 'income'
    do nothing;

    perform set_config('vitrina.allow_order_write', 'on', true);
    update public.orders set paid_amount = new.total where id = new.id;
  end if;
  return new;
end;
$$;

create trigger orders_income_record
  after update of status on public.orders
  for each row execute function public.orders_income_record();

-- ─────────────────────────────────────────────────────────────────────────────
-- Напоминания
-- ─────────────────────────────────────────────────────────────────────────────

create type public.reminder_status as enum ('pending', 'done', 'dismissed');

create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  title       text not null check (length(btrim(title)) > 0),
  body        text,
  due_at      timestamptz not null,
  status      public.reminder_status not null default 'pending',

  -- К кому/чему относится: клиент, заказ — по желанию.
  customer_id uuid references public.customers(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete cascade,

  -- Кому напомнить. null = всем, у кого есть customers.read в магазине.
  assignee    uuid references public.profiles(id) on delete cascade,

  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

create index reminders_due_idx      on public.reminders (tenant_id, due_at)
  where status = 'pending';
create index reminders_customer_idx on public.reminders (customer_id) where customer_id is not null;
create index reminders_order_idx    on public.reminders (order_id) where order_id is not null;
create index reminders_assignee_idx on public.reminders (assignee) where assignee is not null;
create index reminders_created_by_idx on public.reminders (created_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.finance_categories enable row level security;
alter table public.finance_records    enable row level security;
alter table public.reminders          enable row level security;

create policy finance_categories_read on public.finance_categories
  for select to authenticated
  using (tenant_id in (select public.tenants_with('finances.read')));

create policy finance_categories_insert on public.finance_categories
  for insert to authenticated
  with check (tenant_id in (select public.tenants_with('finances.write')));

create policy finance_categories_update on public.finance_categories
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('finances.write')))
  with check (tenant_id in (select public.tenants_with('finances.write')));

create policy finance_categories_delete on public.finance_categories
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('finances.write')));

create policy finance_records_read on public.finance_records
  for select to authenticated
  using (tenant_id in (select public.tenants_with('finances.read')));

create policy finance_records_insert on public.finance_records
  for insert to authenticated
  with check (
    tenant_id in (select public.tenants_with('finances.write'))
    and created_by = (select auth.uid())
  );

-- update разрешён (заметка/категория), остальное режет триггер-охранник.
create policy finance_records_update on public.finance_records
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('finances.write')))
  with check (tenant_id in (select public.tenants_with('finances.write')));

create policy reminders_read on public.reminders
  for select to authenticated
  using (tenant_id in (select public.tenants_with('customers.read')));

create policy reminders_insert on public.reminders
  for insert to authenticated
  with check (
    tenant_id in (select public.tenants_with('customers.write'))
    and created_by = (select auth.uid())
  );

create policy reminders_update on public.reminders
  for update to authenticated
  using      (tenant_id in (select public.tenants_with('customers.write')))
  with check (tenant_id in (select public.tenants_with('customers.write')));

create policy reminders_delete on public.reminders
  for delete to authenticated
  using (tenant_id in (select public.tenants_with('customers.write')));
