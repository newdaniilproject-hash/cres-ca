-- 0127. TRUNCATE у anon і authenticated: періметр незмінюваних журналів.
--
-- ── ЯК ЗНАЙШЛОСЬ ────────────────────────────────────────────────────────────
--
-- Незалежним аудитом ТЗ 25.08.2026, запитом до БОЄВОЇ бази:
--
--   select has_table_privilege('authenticated','public.audit_log','TRUNCATE');
--   -- true
--
-- Те саме для `anon`, і те саме на `cleaning_entries`, `sanitation_solutions`,
-- `sterilization_cycles`, `stock_movements`, `finance_records` — тобто на
-- ВСІХ журналах, які продукт називає незмінюваними.
--
-- ── ЧОМУ ЦЕ ВАЖЛИВО, ХОЧА СЬОГОДНІ НЕ ЕКСПЛУАТУЄТЬСЯ ────────────────────────
--
-- Незмінюваність журналу тримається на тригері `BEFORE DELETE OR UPDATE`
-- (`journal_guard`, `audit_log_immutable`) плюс відсутності політик UPDATE
-- і DELETE. `TRUNCATE` НЕ ПІДНІМАЄ рядкові тригери і НЕ ПРОХОДИТЬ через RLS:
-- він знімає всю таблицю однією командою, і жоден сторож про це не дізнається.
--
-- Через PostgREST виклику TRUNCATE немає, тому діри, яку можна відкрити
-- з браузера, тут і сьогодні немає. Але:
--
--   1) періметр — це не «що можна зробити сьогодні», а «що буде можна,
--      коли зʼявиться перша ж `security invoker` функція з динамічним SQL
--      або прямий доступ до бази у співробітника»;
--   2) і головне: клієнту і перевіряючому продукт КАЖЕ, що журнал технічно
--      незмінюваний. З цією привілеєю це твердження неправдиве. Ціна
--      неправдивого твердження про журнал — не бага, а зірваний акт.
--
-- Джерело те саме, що ловилось тут уже сім разів для функцій і представлень
-- (0036, 0060, 0072, 0076, 0082): `alter default privileges … grant all …
-- to anon, authenticated` у хмарі Supabase. На САМИХ ТАБЛИЦЯХ його не
-- відкликали жодного разу.
--
-- ── ПРАВИЛО ПРОЕКТУ, ЯКОГО ТУТ ДОТРИМАНО ────────────────────────────────────
--
-- «Відкликати разом по всій схемі, а не поіменно: список імен застаріває
-- в той день, коли заведуть наступну таблицю» (правило 7). Тому нижче
-- відкликання по СХЕМІ, а не перелік журналів, — плюс подія на створення
-- нової таблиці, щоб завтрашня таблиця не отримала того самого.
--
-- Міграція звужуюча, і за правилом 3 («сужающая идёт ОТДЕЛЬНЫМ шагом
-- ПОСЛЕ выката») її треба накатувати після викату. Тут це безпечно
-- в будь-якому порядку: TRUNCATE не викликає ні застосунок, ні PostgREST,
-- ні жодна наша функція — вони працюють правами власника.

-- ── 1. Відкликаємо на всьому, що вже є ──────────────────────────────────────
--
-- Разом із TRUNCATE знімаємо TRIGGER і REFERENCES: вони так само не потрібні
-- ролям запиту і так само видані за замовчуванням. SELECT / INSERT / UPDATE
-- / DELETE НЕ ЧІПАЄМО — на них стоїть весь продукт, і саме їх фільтрує RLS.
revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;

-- ── 2. Щоб завтрашня таблиця не отримала того самого ────────────────────────
--
-- Дві незалежні страховки, бо кожна з них може не спрацювати сама.
--
-- Перша — типові привілеї. Вони належать РОЛІ, що їх видала, і ми не знаємо
-- напевно, яка роль виставила хмарний дефолт (`postgres` чи `supabase_admin`).
-- Тому виконуємо для поточної ролі й не претендуємо, що цього достатньо.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- Друга — подія на створення таблиці, поруч із наявним `ensure_rls` (0096)
-- і з тієї ж причини: страховка ставиться на той випадок, коли хтось забуде.
--
-- Через виняток — так само, як у 0096: подієвий тригер створює не всяка роль,
-- і міграція, що роняє весь накат через необовʼязкову страховку, гірша
-- за відсутність страховки.
create or replace function public.revoke_truncate_on_new_table()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $fn$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
       and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format(
          'revoke truncate, trigger, references on %s from anon, authenticated',
          cmd.object_identity);
      exception when others then
        raise log 'revoke_truncate_on_new_table: % — %', cmd.object_identity, sqlerrm;
      end;
    end if;
  end loop;
end;
$fn$;

-- Правило 7: Postgres видає EXECUTE ролі PUBLIC на КОЖНУ нову функцію.
-- Відкликати треба у всіх трьох — `public` не покриває `anon`
-- і `authenticated`, яким Supabase видає окремо. Спіймано тестом
-- `06_isolation.sql` при першому ж прогоні цієї міграції: список функцій,
-- відкритих анониму, — закритий, і нова в ньому опинилась одразу.
--
-- Викликати її ззовні все одно нічого не дає (подієва функція без аргументів
-- поза контекстом DDL не робить нічого), але список тим і цінний, що не має
-- винятків «ця не страшна»: виняток одразу стає прецедентом.
revoke execute on function public.revoke_truncate_on_new_table() from public;
revoke execute on function public.revoke_truncate_on_new_table() from anon;
revoke execute on function public.revoke_truncate_on_new_table() from authenticated;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'revoke_truncate') then
    create event trigger revoke_truncate on ddl_command_end
      execute function public.revoke_truncate_on_new_table();
  end if;
exception when others then
  raise log '0127: подієвий тригер revoke_truncate не створено — %', sqlerrm;
end;
$$;

-- ── 3. Сторож ───────────────────────────────────────────────────────────────
--
-- Перевіряється СПРОБА порушення, а не наявність команди вище: правило
-- проекту про тести читається і для міграцій. Якщо відкликання чомусь
-- не спрацювало (інший власник таблиці, права ролі накату), накат падає
-- тут, а не робить вигляд, що періметр закрито.
do $$
declare v_left text;
begin
  select string_agg(format('%s (%s)', c.relname, r.rolname), ', ' order by c.relname)
    into v_left
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (values ('anon'), ('authenticated')) as r(rolname)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege(r.rolname, c.oid, 'TRUNCATE');

  if v_left is not null then
    raise exception 'TRUNCATE лишився виданим: %', v_left;
  end if;
end;
$$;
