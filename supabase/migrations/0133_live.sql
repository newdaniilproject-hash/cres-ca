-- 0133. Живі дані: зміна в закладі видно одразу і на всіх пристроях.
--
-- ── ЩО ПРОСИЛИ ─────────────────────────────────────────────────────────────
--
-- Власник 25.08.2026: «зроби миттєвість повністю і правильно, без милиць,
-- щоб працювало ЗАВЖДИ, а не тільки на тих екранах, де я часто працюю,
-- і робота з різних пристроїв синхронізувалась миттєво».
--
-- ── ЧОМУ НЕ ПІДПИСКА НА КОЖНУ ТАБЛИЦЮ ──────────────────────────────────────
--
-- Очевидний шлях — підписати застосунок на `postgres_changes` кожної
-- потрібної таблиці. Таблиць із `tenant_id` шістдесят дві. Це означає
-- список таблиць у ДВОХ місцях: у публікації бази і в коді підписки.
-- Два списки одного набору розходяться завжди і мовчки — рівно те, від
-- чого йде правило «один источник правды, и сторож при каждом».
-- Забули додати нову таблицю — новий екран просто не оживає, і помітить
-- це власник через місяць, а не збірка.
--
-- ── ЩО ЗАМІСТЬ ─────────────────────────────────────────────────────────────
--
-- ОДИН рядок на заклад — `tenant_pulse` — і лічильник у ньому. Будь-яка
-- зміна будь-де в закладі його підіймає. Застосунок слухає ОДНУ таблицю
-- з ОДНИМ фільтром `tenant_id`, і цього достатньо для всіх екранів
-- одразу: змінилось будь-що — екран перезапитує себе.
--
-- Три властивості, заради яких вибрано саме це:
--
--   1. НОВИЙ ЕКРАН ОЖИВАЄ САМ. Нічого не треба дописувати ні в підписку,
--      ні в публікацію: він читає ті самі таблиці, а вони вже пульсують.
--   2. НОВА ТАБЛИЦЯ не ламає нічого, навіть якщо про неї забули: екран
--      поводиться як сьогодні, не гірше. Але й забути не вийде —
--      сторож нижче падає, якщо таблиця з `tenant_id` лишилась без
--      тригера і не названа у винятках.
--   3. МЕЖА ДОСТУПУ та сама, що скрізь: RLS. Пульс віддається лише
--      учасникам свого закладу, і в ньому НЕМАЄ нічого, крім часу
--      та лічильника, — навіть якби він витік, там нема чого читати.
--
-- Ціна названа чесно: будь-яка зміна в закладі перезапитує ВСІ відкриті
-- екрани цього закладу, навіть ті, що цих даних не показують. Для салону
-- з чотирма майстрами це одиниці запитів на хвилину. Обмінюємо цю дрібницю
-- на те, що жодного екрана не треба «підключати» окремо.

create table if not exists public.tenant_pulse (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Лічильник, а не тільки час: два записи в одну мілісекунду дали б
  -- однаковий рядок, і подія про зміну не пішла б.
  rev bigint not null default 0,
  at  timestamptz not null default now()
);

comment on table public.tenant_pulse is
  'Один рядок на заклад. Будь-яка зміна в закладі підіймає rev; застосунок '
  'слухає саме цю таблицю і перезапитує екран. Даних тут немає навмисно.';

alter table public.tenant_pulse enable row level security;

drop policy if exists tenant_pulse_read on public.tenant_pulse;
create policy tenant_pulse_read on public.tenant_pulse
  for select to authenticated
  using (tenant_id in (select public.my_tenants()));

-- Пише ТІЛЬКИ тригер (він security definer). Людині писати нема чого:
-- підняти чужий пульс — це змусити чужі екрани перезапитуватись.
revoke all on public.tenant_pulse from public, anon, authenticated;
grant select on public.tenant_pulse to authenticated;

-- `replica identity full` обовʼязкове: без нього рядок у події DELETE
-- і фільтр `tenant_id=eq.…` для UPDATE не працюють, і Supabase не зможе
-- ні відфільтрувати подію, ні перевірити на ній RLS.
alter table public.tenant_pulse replica identity full;

-- Публікація realtime. `add table` двічі падає помилкою, тому перевіряємо.
--
-- Публікацію створюємо, якщо її немає: у хмарі Supabase вона є завжди,
-- а на чистому Postgres (стенд `supabase/tests/run.sh`, який накатує все
-- з нуля) — ні, і без цього рядка прогін падав би на порожньому місці.
-- `if not exists` для публікацій Postgres не має, тому через перевірку.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'tenant_pulse'
  ) then
    alter publication supabase_realtime add table public.tenant_pulse;
  end if;
end $$;

-- ── Тригер, що підіймає пульс ──────────────────────────────────────────────
--
-- `security definer`, бо пише в таблицю, куди тому, хто змінив дані,
-- писати не дозволено.
--
-- ── ЧОМУ НА ОПЕРАЦІЮ, А НЕ НА РЯДОК ────────────────────────────────────────
--
-- Тригер `for each row` виглядає простішим, і перша редакція була саме
-- такою. Він неправильний, і причина не в швидкості.
--
-- Кожне підняття пульсу — це UPDATE одного рядка, тобто ОДНА подія
-- realtime. Приймання документом на двадцять позицій пише позиції, рухи
-- складу і собівартість окремими записами: тридцять подій на одну дію
-- людини. Імпорт каталогу на пʼять тисяч рядків — пʼять тисяч подій
-- в один канал. Це впирається не в наш сервер, а в обмеження каналу
-- Supabase, і рятувати це затримкою на боці застосунку означає
-- складати милицю поверх милиці.
--
-- `for each statement` із перехідними таблицями робить рівно одне
-- підняття на ОПЕРАЦІЮ, скільки б рядків вона не зачепила. Тому три
-- тригери на таблицю замість одного: перехідні таблиці в Postgres
-- оголошуються під конкретну подію, і на кілька подій разом тригер
-- із ними завести не можна.
--
-- Імена перехідних таблиць (`pulse_new`, `pulse_old`) однакові скрізь,
-- тому функція одна. Гілка, що не виконується, у plpgsql і не готується,
-- тому звертання до `pulse_old` в гілці INSERT нікому не заважає.
create or replace function public.bump_pulse()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- ЗАКЛАДУ ВЖЕ МОЖЕ НЕ БУТИ, і це не виняткова ситуація.
  --
  -- Видалення акаунта (`delete_my_account` → `purge_tenant_rows`, 0058)
  -- знімає заклад, а каскад від `tenants` тягне за собою дочірні рядки —
  -- і кожне таке видалення приходить сюди. Пульс закладу, якого більше
  -- немає, — це рядок із зовнішнім ключем у нікуди: вставка падає,
  -- а разом із нею падає ВСЕ видалення акаунта. Так воно й впало
  -- на 09_team.sql з першого ж прогону.
  --
  -- Тому не перевірка з `raise`, а звичайне зʼєднання з `tenants`:
  -- закладу немає — рядка в вибірці немає — вставляти нема чого.
  -- Сенсу пульсувати тут теж немає: екранів у видаленого закладу нема.
  if tg_op = 'INSERT' then
    insert into public.tenant_pulse (tenant_id, rev, at)
    select s.tenant_id, 1, now()
      from (select distinct tenant_id from pulse_new where tenant_id is not null) s
      join public.tenants t on t.id = s.tenant_id
    on conflict (tenant_id) do update
      set rev = public.tenant_pulse.rev + 1, at = now();
  elsif tg_op = 'DELETE' then
    insert into public.tenant_pulse (tenant_id, rev, at)
    select s.tenant_id, 1, now()
      from (select distinct tenant_id from pulse_old where tenant_id is not null) s
      join public.tenants t on t.id = s.tenant_id
    on conflict (tenant_id) do update
      set rev = public.tenant_pulse.rev + 1, at = now();
  else
    -- UPDATE: беремо обидві сторони. Рядок, у якого змінився `tenant_id`,
    -- зник в одного закладу і зʼявився в іншого — оживити треба обидва.
    insert into public.tenant_pulse (tenant_id, rev, at)
    select s.tenant_id, 1, now()
      from (select distinct tenant_id from (
              select tenant_id from pulse_new
              union all
              select tenant_id from pulse_old) u
             where tenant_id is not null) s
      join public.tenants t on t.id = s.tenant_id
    on conflict (tenant_id) do update
      set rev = public.tenant_pulse.rev + 1, at = now();
  end if;
  return null;
end;
$$;

-- Окремо для самої `tenants`: там заклад називається `id`, а не `tenant_id`.
--
-- Вішається ТІЛЬКИ на insert і update — див. тригери нижче. DELETE тут
-- не обробляється навмисно: пульс видаленого закладу нікому не потрібен,
-- а вставити його вже й неможливо.
create or replace function public.bump_pulse_self()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.tenant_pulse (tenant_id, rev, at)
  select distinct id, 1, now() from pulse_new
  on conflict (tenant_id) do update
    set rev = public.tenant_pulse.rev + 1, at = now();
  return null;
end;
$$;

revoke execute on function public.bump_pulse() from public, anon, authenticated;
revoke execute on function public.bump_pulse_self() from public, anon, authenticated;

-- ── На які таблиці вішаємо ─────────────────────────────────────────────────
--
-- На всі з `tenant_id`, крім названих. Виняток — це рішення, а не пропуск,
-- і кожен має причину:
--
--   audit_log, security_events, permission_audit, integration_access_log
--     — журнали, які пишуться ТРИГЕРОМ на ті самі зміни. Пульс від них
--       подвоїв би кожну подію рівно ні за чим.
--   *_counters — підіймаються разом зі своїм документом, який пульсує сам.
--   attribution_events — це переходи анонімів по вітрині. Сотня переходів
--       за годину смикала б екрани майстрів без жодної причини.
--   ai_jobs, import_jobs, import_errors — фонові черги, екранів не мають.
--   tenant_pulse — сам себе, інакше нескінченний цикл.
do $$
declare
  r record;
  v_skip text[] := array[
    'audit_log', 'security_events', 'permission_audit', 'integration_access_log',
    'booking_counters', 'order_counters', 'container_counters', 'return_counters',
    'attribution_events', 'ai_jobs', 'import_jobs', 'import_errors',
    'tenant_pulse'
  ];
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
                         and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r'
       and not (c.relname = any (v_skip))
  loop
    -- `pulse` без суфікса — з першої редакції, що вішала один тригер
    -- на рядок. Знімаємо, інакше на вже накатаній базі лишився б обидва
    -- механізми одразу.
    execute format('drop trigger if exists pulse on public.%I', r.relname);
    execute format('drop trigger if exists pulse_ins on public.%I', r.relname);
    execute format('drop trigger if exists pulse_upd on public.%I', r.relname);
    execute format('drop trigger if exists pulse_del on public.%I', r.relname);
    execute format(
      'create trigger pulse_ins after insert on public.%I '
      'referencing new table as pulse_new '
      'for each statement execute function public.bump_pulse()', r.relname);
    execute format(
      'create trigger pulse_upd after update on public.%I '
      'referencing new table as pulse_new old table as pulse_old '
      'for each statement execute function public.bump_pulse()', r.relname);
    execute format(
      'create trigger pulse_del after delete on public.%I '
      'referencing old table as pulse_old '
      'for each statement execute function public.bump_pulse()', r.relname);
  end loop;
end $$;

-- Без `delete`: видалений заклад пульсувати не може — на нього дивиться
-- зовнішній ключ самої `tenant_pulse`, і спроба впала б разом з усім
-- видаленням акаунта.
drop trigger if exists pulse on public.tenants;
drop trigger if exists pulse_ins on public.tenants;
drop trigger if exists pulse_upd on public.tenants;
create trigger pulse_ins after insert on public.tenants
  referencing new table as pulse_new
  for each statement execute function public.bump_pulse_self();
create trigger pulse_upd after update on public.tenants
  referencing new table as pulse_new
  for each statement execute function public.bump_pulse_self();

-- ── СТОРОЖ ─────────────────────────────────────────────────────────────────
--
-- Таблиця з `tenant_id` без тригера і без запису у винятках — це екран,
-- який мовчки не оживає. Такий дефект не видно ніяк: усе працює, просто
-- не миттєво. Тому накат падає одразу.
--
-- Список винятків живе ТУТ ЖЕ, поруч із циклом вище: два списки одного
-- набору розійшлися б, і це та сама помилка, від якої вся ця міграція.
do $$
declare
  v_missing text;
  v_skip text[] := array[
    'audit_log', 'security_events', 'permission_audit', 'integration_access_log',
    'booking_counters', 'order_counters', 'container_counters', 'return_counters',
    'attribution_events', 'ai_jobs', 'import_jobs', 'import_errors',
    'tenant_pulse'
  ];
begin
  -- Тригерів має бути ТРИ, а не «хоча б один»: перехідні таблиці
  -- оголошуються під конкретну подію, тож пропущений `pulse_del` означав би
  -- рівно те, що видалення нічого не оживляє, — і мовчки.
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
                       and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind = 'r'
     and not (c.relname = any (v_skip))
     and (select count(*) from pg_trigger t
           where t.tgrelid = c.oid and not t.tgisinternal
             and t.tgname in ('pulse_ins', 'pulse_upd', 'pulse_del')) <> 3;
  if v_missing is not null then
    raise exception 'Таблиці з tenant_id лишились без пульсу: %', v_missing;
  end if;
end $$;
