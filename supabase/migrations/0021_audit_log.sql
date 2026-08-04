-- 0021_audit_log.sql
-- Неизменяемый журнал действий — Audit Trail из п.4 ТЗ салона.
--
-- Зачем отдельная таблица, когда уже есть stock_movements и order_events:
-- те журналы отвечают на вопрос «что стало с остатком» и «что стало
-- с заказом». Проверяющий спрашивает другое — «кто и когда изменил
-- запись». Правку карточки косметики, срока партии, техкарты или
-- состава команды до этой миграции не фиксировал никто.
--
-- Приём тот же, что у санитарных журналов (0014): строка не редактируется
-- и не удаляется. Ошибка исправляется новой строкой, а не подчисткой
-- старой — иначе журнал перестаёт быть доказательством и становится
-- файлом, который переписали накануне проверки.

create table public.audit_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null,
  actor_id     uuid,
  actor_email  extensions.citext,
  action       text not null check (action in ('insert','update','delete')),
  entity       text not null,
  entity_id    uuid,
  label        text,
  changes      jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

-- Внешних ключей здесь нет, и это не упрощение, а условие работы.
-- tenant_id → tenants on delete cascade вместе с запретом DELETE означал бы,
-- что заведение больше нельзя удалить: каскад упирается в запрет.
-- actor_id → profiles on delete set null — то же самое: set null это UPDATE,
-- тоже запрещённый. Для журнала-доказательства правильно обратное:
-- он переживает и заведение, и увольнение сотрудника, а имя и почта
-- автора записаны строкой рядом.
comment on table public.audit_log is
  'Незмінюваний журнал дій (ТЗ п.4). Рядок не редагується і не видаляється: помилка виправляється новим рядком.';
comment on column public.audit_log.actor_id is
  'Хто саме. Посилання на profiles навмисно немає: журнал переживає звільнення співробітника.';
comment on column public.audit_log.label is
  'Людське імʼя обʼєкта на момент дії: карточку могли перейменувати, а журнал має читатися й через рік.';
comment on column public.audit_log.changes is
  'Тільки поля, що змінилися: {"поле": {"was": …, "now": …}}. Кеші залишків і updated_at не пишуться — це шум.';

create index audit_log_tenant_at_idx on public.audit_log (tenant_id, at desc);
create index audit_log_entity_idx    on public.audit_log (tenant_id, entity, entity_id, at desc);
create index audit_log_actor_idx     on public.audit_log (tenant_id, actor_id, at desc);

alter table public.audit_log enable row level security;

-- Читает тот же, у кого есть право на соответствие: владелец и инспектор.
-- Писать пользователь не может вообще — строку кладёт только триггер.
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (tenant_id in (select public.tenants_with('compliance.read')));

-- Второй замок поверх отсутствия политик: без него сервисный ключ
-- в фоновой задаче смог бы переписать историю.
create or replace function public.audit_log_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'журнал дій не редагується і не видаляється';
end;
$$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

revoke execute on function public.audit_log_guard() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Общий писатель журнала
-- ─────────────────────────────────────────────────────────────────────────────
-- Работает через jsonb, а не через new.поле: одна функция вешается на
-- полтора десятка таблиц с разным набором колонок, и обращение к
-- несуществующему полю уронило бы её на первой же из них.
--
-- to_jsonb и остальные пишутся без схемы намеренно: они живут в pg_catalog,
-- а он подставляется всегда, даже при пустом search_path.

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j_old    jsonb;
  j_new    jsonb;
  rec      jsonb;
  v_diff   jsonb := '{}'::jsonb;
  k        text;
  v_actor  uuid := auth.uid();
  v_tenant uuid;
begin
  j_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  j_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  rec   := coalesce(j_new, j_old);

  -- У таблицы tenants арендатор — она сама, поэтому id идёт вторым шансом.
  v_tenant := nullif(coalesce(rec ->> 'tenant_id', rec ->> 'id'), '')::uuid;
  if v_tenant is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(j_new) loop
      -- Кеши остатков ведёт журнал движений, updated_at и поисковый вектор
      -- меняются сами: в журнале действий это шум, который закрывает собой
      -- настоящие правки.
      if k in ('updated_at','search_tsv','current_stock','stock_qty',
               'reserved_qty','rating_avg','rating_count') then
        continue;
      end if;
      if (j_new -> k) is distinct from (j_old -> k) then
        v_diff := v_diff || jsonb_build_object(
          k, jsonb_build_object('was', j_old -> k, 'now', j_new -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := jsonb_build_object('created', j_new);
  else
    v_diff := jsonb_build_object('deleted', j_old);
  end if;

  insert into public.audit_log
    (tenant_id, actor_id, actor_email, action, entity, entity_id, label, changes)
  values (
    v_tenant,
    v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    lower(tg_op),
    tg_table_name,
    -- У таблиц без собственного id (состав команды) ключом служит сотрудник.
    nullif(coalesce(rec ->> 'id', rec ->> 'user_id'), '')::uuid,
    coalesce(rec ->> 'name', rec ->> 'title', rec ->> 'code',
             rec ->> 'batch_number', rec ->> 'agent_name', rec ->> 'device'),
    v_diff
  );

  return null;
end;
$$;

revoke execute on function public.audit_row() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Куда вешаем. Список закрытый и осознанный: журнал должен отвечать
-- на вопрос проверяющего и на вопрос владельца «кто это поменял»,
-- а не писать каждое движение мышью. Санитарные журналы сюда не входят —
-- они сами по себе неизменяемы и являются записью факта.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'materials','material_batches','material_containers','material_documents',
    'material_barcodes','tech_cards','offerings','offering_variants',
    'suppliers','storage_locations','staff','tenant_members','cleaning_tasks',
    'customers','tenants','variant_materials'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row()',
      'audit_' || t, t);
  end loop;
end;
$$;
