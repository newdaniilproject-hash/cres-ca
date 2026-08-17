-- ===========================================================================
-- 0090. Шаг 7, пункт Б: журнал доступа к чувствительным данным.
-- ===========================================================================
--
-- ЧТО БЫЛО. audit_log (0021) пишет только ИЗМЕНЕНИЯ: триггер audit_row вешается
-- на insert, update и delete, а ограничение action прямо перечисляет эти три
-- значения и никаких других. Кто ОТКРЫВАЛ карточку клиента, кто выгрузил базу
-- контактов и кто скачал документ — не пишется нигде.
--
-- ЧЕМ ЭТО ОПАСНО. При утечке это единственный способ понять её источник.
-- И это же единственное доказательство обратного: когда клиент придёт
-- с вопросом «откуда у конкурента мои телефоны», ответить будет нечем.
-- Уволенный мастер, выгрузивший базу перед уходом, — самый частый сценарий
-- в этом сегменте, и он не оставляет ни одного следа.
--
-- ПОЧЕМУ ПИШЕМ ИЗ БАЗЫ, А НЕ ИЗ ИНТЕРФЕЙСА. Интерфейс обходится: supabase-js
-- бьёт в PostgREST напрямую, и любой, у кого есть токен, читает customers
-- запросом мимо нашего экрана. Журнал, который ведёт экран, в этом случае
-- молчит. Значит чтение обязано идти через функцию, и она же пишет строку.
--
-- ПОЧЕМУ НЕ ЛОГИРУЕМ КАЖДЫЙ SELECT. Журнал на миллион строк в день не читает
-- никто, и он сам становится вторым хранилищем персональных данных. Пишутся
-- ровно четыре действия: открыл карточку, выгрузил список, скачал документ,
-- сформировал отчёт проверяющему.
--
-- ПОЧЕМУ РАСШИРЯЕМ audit_log, А НЕ ЗАВОДИМ ВТОРОЙ ЖУРНАЛ. Второй журнал
-- пришлось бы отдельно защищать от правки, отдельно чистить по сроку и
-- отдельно показывать. У audit_log всё это уже есть: audit_log_guard роняет
-- update и delete, политика чтения разобрана в 0035.
-- ===========================================================================

-- ── 1. Ограничение action: добавляются действия чтения ──────────────────────

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert','update','delete','viewed','exported','downloaded','reported'));

comment on column public.audit_log.action is
  'insert/update/delete — изменение, пишет триггер audit_row. viewed/exported/downloaded/reported — доступ к чувствительным данным, пишет log_data_access.';

-- ── 2. Единственная точка записи ────────────────────────────────────────────

create or replace function public.log_data_access(
  p_tenant    uuid,
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_label     text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  if p_action not in ('viewed','exported','downloaded','reported') then
    raise exception 'log_data_access: дія % не є доступом до даних', p_action;
  end if;

  if v_actor is null then
    raise exception 'log_data_access: анонім не читає чужі дані';
  end if;

  if p_tenant is null or p_tenant not in (select public.my_tenants()) then
    raise exception 'log_data_access: заклад недоступний';
  end if;

  insert into public.audit_log
    (tenant_id, actor_id, actor_email, action, entity, entity_id, label, changes)
  values (
    p_tenant,
    v_actor,
    (select p.email from public.profiles p where p.id = v_actor),
    p_action,
    p_entity,
    p_entity_id,
    -- Подпись идёт в журнал, значит подпадает под правило 14: сама подпись
    -- не имеет права быть персональными данными.
    public.mask_text_pii(left(p_label, 200)),
    jsonb_build_object('access', p_action));
end;
$fn$;

comment on function public.log_data_access(uuid, text, text, uuid, text) is
  'Единственная точка записи доступа к чувствительным данным. Проверяет членство в заведении: журнал, в который может писать посторонний, доказательством не является.';

-- ── 3. Карточка клиента ─────────────────────────────────────────────────────
--
-- Маскировка контактов повторяет решение 0078: телефон и почту видит тот,
-- у кого есть customers.contacts, остальные видят карточку без них.
-- Здесь она повторена, а не переиспользована из v_bookings, потому что
-- представление отдаёт записи, а не карточку.

create or replace function public.customer_card(p_tenant_id uuid, p_customer_id uuid)
returns table (
  id            uuid,
  name          text,
  phone         text,
  email         text,
  note          text,
  tags          text[],
  orders_count  integer,
  total_spent   numeric,
  last_order_at timestamptz,
  created_at    timestamptz)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_contacts boolean;
begin
  if not public.tenant_can(p_tenant_id, 'customers.read') then
    raise exception 'картка клієнта недоступна';
  end if;

  v_contacts := public.tenant_can(p_tenant_id, 'customers.contacts');

  perform public.log_data_access(
    p_tenant_id, 'viewed', 'customers', p_customer_id,
    case when v_contacts then 'картка з контактами' else 'картка без контактів' end);

  return query
    select c.id,
           c.name,
           case when v_contacts then c.phone else public.mask_phone(c.phone) end,
           case when v_contacts then c.email::text else public.mask_email(c.email::text) end,
           c.note,
           c.tags,
           c.orders_count,
           c.total_spent,
           c.last_order_at,
           c.created_at
      from public.customers c
     where c.tenant_id = p_tenant_id
       and c.id = p_customer_id;
end;
$fn$;

comment on function public.customer_card(uuid, uuid) is
  'Карточка клиента с записью в журнал доступа. Контакты открыты только праву customers.contacts.';

-- ── 4. Выгрузка списка ──────────────────────────────────────────────────────
--
-- Выгрузка — самое опасное действие из четырёх: одним нажатием уходит вся
-- база контактов. Поэтому она требует customers.contacts ОТДЕЛЬНО: без него
-- функция отдаёт список, но с закрытыми контактами, и это видно в журнале.

create or replace function public.customers_export(p_tenant_id uuid)
returns table (
  id            uuid,
  name          text,
  phone         text,
  email         text,
  orders_count  integer,
  total_spent   numeric,
  last_order_at timestamptz,
  created_at    timestamptz)
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_contacts boolean;
  v_count    integer;
begin
  if not public.tenant_can(p_tenant_id, 'customers.read') then
    raise exception 'вивантаження недоступне';
  end if;

  v_contacts := public.tenant_can(p_tenant_id, 'customers.contacts');

  select count(*) into v_count from public.customers c where c.tenant_id = p_tenant_id;

  perform public.log_data_access(
    p_tenant_id, 'exported', 'customers', null,
    v_count::text || ' записів, контакти: ' || case when v_contacts then 'відкриті' else 'приховані' end);

  return query
    select c.id,
           c.name,
           case when v_contacts then c.phone else public.mask_phone(c.phone) end,
           case when v_contacts then c.email::text else public.mask_email(c.email::text) end,
           c.orders_count,
           c.total_spent,
           c.last_order_at,
           c.created_at
      from public.customers c
     where c.tenant_id = p_tenant_id
     order by c.created_at;
end;
$fn$;

comment on function public.customers_export(uuid) is
  'Выгрузка базы клиентов с записью в журнал. Число строк попадает в подпись: по журналу видно, выгрузили одну карточку или всю базу.';

-- ── 5. Скачивание документа ─────────────────────────────────────────────────
--
-- Подписанную ссылку выдаёт хранилище, а не база, поэтому функция отдаёт
-- путь и пишет строку. Приложение обязано брать путь ОТСЮДА, а не из таблицы:
-- иначе скачивание снова перестанет попадать в журнал. Это записано
-- в КОНСПЕКТЫ.md как условие переноса модуля.

create or replace function public.document_access(p_tenant_id uuid, p_document_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_path  text;
  v_title text;
begin
  if not public.tenant_can(p_tenant_id, 'compliance.read') then
    raise exception 'документ недоступний';
  end if;

  select d.path, d.title into v_path, v_title
    from public.material_documents d
   where d.tenant_id = p_tenant_id
     and d.id = p_document_id;

  if v_path is null then
    raise exception 'документ не знайдено';
  end if;

  perform public.log_data_access(p_tenant_id, 'downloaded', 'material_documents', p_document_id, v_title);

  return v_path;
end;
$fn$;

comment on function public.document_access(uuid, uuid) is
  'Путь к приватному документу плюс строка в журнале. Приложение обязано подписывать ссылку по пути ОТСЮДА, иначе скачивание в журнал не попадёт.';

-- ── 6. Экран владельцу ──────────────────────────────────────────────────────
--
-- security_invoker намеренно НЕ включён: представление само фильтрует
-- по tenants_with('settings.read') и по собственному идентификатору. Это тот
-- же приём, что в compliance_* (0035) и team_access_log (0053).
-- Мастер видит СВОИ строки в любом заведении — иначе он не может проверить,
-- что журнал не приписал ему чужое.

drop view if exists public.data_access_log;

create view public.data_access_log
with (security_barrier = true) as
select a.id,
       a.tenant_id,
       a.at,
       a.actor_id,
       a.actor_email,
       a.action,
       a.entity,
       a.entity_id,
       a.label
  from public.audit_log a
 where a.action in ('viewed','exported','downloaded','reported')
   and (a.tenant_id in (select public.tenants_with('settings.read'))
        or a.actor_id = (select auth.uid()));

comment on view public.data_access_log is
  'Кто открывал карточки, выгружал списки и скачивал документы. Владельцу — по заведению, сотруднику — свои строки.';

revoke all on public.data_access_log from public;
revoke all on public.data_access_log from anon;
grant select on public.data_access_log to authenticated;

-- ── 7. Права ────────────────────────────────────────────────────────────────

revoke all on function public.log_data_access(uuid, text, text, uuid, text) from public;
revoke all on function public.log_data_access(uuid, text, text, uuid, text) from anon;
grant execute on function public.log_data_access(uuid, text, text, uuid, text) to authenticated;

revoke all on function public.customer_card(uuid, uuid) from public;
revoke all on function public.customer_card(uuid, uuid) from anon;
grant execute on function public.customer_card(uuid, uuid) to authenticated;

revoke all on function public.customers_export(uuid) from public;
revoke all on function public.customers_export(uuid) from anon;
grant execute on function public.customers_export(uuid) to authenticated;

revoke all on function public.document_access(uuid, uuid) from public;
revoke all on function public.document_access(uuid, uuid) from anon;
grant execute on function public.document_access(uuid, uuid) to authenticated;
