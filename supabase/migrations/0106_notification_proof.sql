-- ===========================================================================
-- 0106. Подтверждение нотификации: доказательство от поставщика,
--       о котором нельзя забыть. Шаг 17 плана, прямой пункт ТЗ.
-- ===========================================================================
--
-- ЧТО ТРЕБУЕТ ТЗ и почему это главный аргумент при продаже. Переходный период
-- Технического регламента №65 КМУ закончился 3 августа 2026 года: с этого дня
-- косметическое средство без нотификации в обороте — нарушение, а штраф
-- Держпродспоживслужби измеряется десятками тысяч.
--
-- ЧЕГО СДЕЛАТЬ НЕЛЬЗЯ, И ЭТО НАДО ПОНИМАТЬ ДО НАЧАЛА. Автоматической
-- проверки в реестре МОЗ НЕ СУЩЕСТВУЕТ и не появится: нотифицируют
-- производители и импортёры, полный состав реестра доступен только
-- уполномоченным органам в закрытой части системы. Публичного поиска нет —
-- парсить нечего. Обещать клиенту автоподгрузку нельзя.
--
-- Поэтому задача переформулирована: не «проверить в реестре», а
-- ХРАНИТЬ ДОКАЗАТЕЛЬСТВО ОТ ПОСТАВЩИКА И НЕ ДАТЬ О НЁМ ЗАБЫТЬ.
--
-- ── ЧТО УЖЕ БЫЛО ────────────────────────────────────────────────────────────
--
-- `materials.notification_code` (0014), `notification_url` и
-- `notification_date` (0059) — то есть КОД записан. Документ-подтверждение
-- можно было приложить в `material_documents` с видом `notification` (0014).
-- Не хватало связи между ними: карточка не знала, что подтверждение есть,
-- и отличить «код вписан со слов поставщика» от «документ лежит в папке»
-- было нельзя ничем, кроме как открыть список документов глазами.
--
-- ── ЧТО ДОБАВЛЯЕТСЯ ─────────────────────────────────────────────────────────
--
--   notification_doc_id      — какой именно документ является подтверждением;
--   notification_confirmed_at — когда подтверждение приняли.
--
-- Две колонки, а не одна: дата без ссылки на документ — это утверждение
-- без доказательства, а ссылка без даты не отвечает на вопрос инспектора
-- «с какого момента у вас это есть».
--
-- ── ПОЧЕМУ СВЯЗЬ ЧЕРЕЗ ФУНКЦИЮ, А НЕ ПРЯМЫМ UPDATE ──────────────────────────
--
-- Документ обязан принадлежать ЭТОМУ ЖЕ средству и ЭТОМУ ЖЕ заведению,
-- и вид его обязан быть `notification`. Прямой UPDATE проверить это не может:
-- внешний ключ на `material_documents` гарантирует лишь существование строки,
-- а не то, что она про этот засіб. Подтверждение, указывающее на MSDS
-- соседнего средства, — это ровно тот случай, когда экран показывает
-- зелёную галочку, а на проверке выясняется, что доказательства нет.
--
-- ── ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО ────────────────────────────────────────────────
--
-- Нет запрета заводить косметику без нотификации. Продавец физически
-- получает средство раньше, чем документ от поставщика, и запрет заставил бы
-- его либо ждать, либо врать в карточке. Вместо запрета — видимость:
-- представление `compliance_materials` отдаёт признак, экран красит строку.
--
-- Отчёта для проверки здесь НЕТ намеренно: он переписывает чужую функцию
-- `compliance_report` целиком, и мешать это с колонками в одном файле —
-- значит получить миграцию, которую нельзя откатить по частям. Он идёт
-- следующим номером, 0107.
-- ===========================================================================

-- ── 1. Колонки ──────────────────────────────────────────────────────────────

alter table public.materials
  add column if not exists notification_doc_id uuid
    references public.material_documents(id) on delete set null,
  add column if not exists notification_confirmed_at timestamptz;

comment on column public.materials.notification_doc_id is
  'Документ-подтверждение нотификации от поставщика (material_documents с видом notification). Проставляется только функцией confirm_notification: она сверяет, что документ про этот же засіб и это же заведение.';
comment on column public.materials.notification_confirmed_at is
  'Когда подтверждение приняли. Отдельно от ссылки: инспектор спрашивает «с какого момента», и ссылка на этот вопрос не отвечает.';

-- `on delete set null`, а не каскад: удаление файла не должно уносить
-- карточку засоба. Признак при этом честно гаснет — подтверждения больше
-- нет, и экран обязан снова показать это красным.

create index if not exists materials_notification_missing_idx
  on public.materials (tenant_id)
  where is_cosmetic and notification_confirmed_at is null;

-- Индекс частичный и ровно под один запрос — экран «засоби без
-- підтвердження нотифікації». Полный индекс по колонке здесь бесполезен:
-- спрашивают всегда одно и то же подмножество.

-- ── 2. Приём подтверждения ──────────────────────────────────────────────────

create or replace function public.confirm_notification(
  p_material_id uuid,
  p_document_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_tenant uuid;
  v_kind   public.material_doc_kind;
  v_doc_material uuid;
begin
  select m.tenant_id into v_tenant
    from public.materials m where m.id = p_material_id;
  if v_tenant is null then
    raise exception 'засобу % не існує', p_material_id;
  end if;

  if not public.tenant_can(v_tenant, 'compliance.write') then
    raise exception 'недостатньо прав: compliance.write у закладі %', v_tenant;
  end if;

  select d.kind, d.material_id into v_kind, v_doc_material
    from public.material_documents d
   where d.id = p_document_id and d.tenant_id = v_tenant;

  if v_kind is null then
    raise exception 'документа % немає в цьому закладі', p_document_id;
  end if;

  -- Документ ДРУГОГО средства — самая правдоподобная ошибка: список
  -- документов заведения длинный, и промахнуться легко. Зелёная галочка
  -- на чужом документе хуже, чем её отсутствие: она снимает вопрос,
  -- не отвечая на него.
  if v_doc_material is distinct from p_material_id then
    raise exception 'документ належить іншому засобу';
  end if;

  if v_kind <> 'notification' then
    raise exception 'підтвердженням нотифікації може бути лише документ виду notification, а не %', v_kind;
  end if;

  update public.materials
     set notification_doc_id = p_document_id,
         notification_confirmed_at = now()
   where id = p_material_id;
end;
$fn$;

comment on function public.confirm_notification(uuid, uuid) is
  'Принять документ поставщика как подтверждение нотификации. Сверяет заведение, принадлежность документа тому же засобу и его вид — прямой UPDATE этого не проверяет.';

create or replace function public.revoke_notification(p_material_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_tenant uuid;
begin
  select m.tenant_id into v_tenant
    from public.materials m where m.id = p_material_id;
  if v_tenant is null then
    raise exception 'засобу % не існує', p_material_id;
  end if;
  if not public.tenant_can(v_tenant, 'compliance.write') then
    raise exception 'недостатньо прав: compliance.write у закладі %', v_tenant;
  end if;

  update public.materials
     set notification_doc_id = null,
         notification_confirmed_at = null
   where id = p_material_id;
end;
$fn$;

comment on function public.revoke_notification(uuid) is
  'Снять подтверждение нотификации. Нужна, когда документ оказался не тем: удалять файл ради этого нельзя, он часть истории.';

-- Правило 7. Три отзыва, потом выдача: `authenticated` получает право
-- на каждую новую функцию через `alter default privileges`, и отзыв
-- у public его не снимает (0036, 0061, 0094, 0095).
revoke all on function public.confirm_notification(uuid, uuid) from public;
revoke all on function public.confirm_notification(uuid, uuid) from anon;
revoke all on function public.confirm_notification(uuid, uuid) from authenticated;
grant execute on function public.confirm_notification(uuid, uuid) to authenticated;

revoke all on function public.revoke_notification(uuid) from public;
revoke all on function public.revoke_notification(uuid) from anon;
revoke all on function public.revoke_notification(uuid) from authenticated;
grant execute on function public.revoke_notification(uuid) to authenticated;

-- ── 3. Инспектор обязан видеть состояние ────────────────────────────────────
--
-- Представление переписывается целиком, а не «дополняется»: `create or
-- replace view` требует того же набора колонок в том же порядке, и тело
-- перенесено из 0035 дословно с добавлением трёх колонок в конец.
--
-- Это то место, ради которого весь модуль: инспектор смотрит НЕ карточку,
-- а `compliance_*` (0083). Не отдать ему признак — значит показать реестр,
-- по которому нельзя понять, есть подтверждение или нет.

-- ⚠️ ПОРЯДОК КОЛОНОК ВЗЯТ С БОЯ, А НЕ ИЗ 0035. `create or replace view`
-- требует того же набора и того же ПОРЯДКА ведущих колонок, а 0059 вставила
-- `notification_url` и `notification_date` в середину — между
-- `notification_code` и `pao_months`. Скопировав список из 0035, получаешь
-- «cannot change name of view column» на накате с нуля, а на бою — молчаливое
-- расхождение. Список ниже снят запросом к information_schema боевой базы.
create or replace view public.compliance_materials as
select m.id, m.tenant_id, m.name, m.unit, m.category, m.brand, m.country_of_origin,
       m.inci, m.notification_code, m.notification_url, m.notification_date,
       m.pao_months, m.is_cosmetic, m.sku,
       m.is_active, m.created_at, m.updated_at,
       m.notification_confirmed_at,
       -- Готовый ответ на вопрос проверки, а не сырьё для него. Считать
       -- это на экране значило бы завести второй источник правды о том,
       -- что считается подтверждённым.
       (m.is_cosmetic and m.notification_confirmed_at is not null) as notification_ok
  from public.materials m
 where m.tenant_id in (select public.tenants_with('compliance.read'));

alter view public.compliance_materials set (security_barrier = true);

revoke all on public.compliance_materials from public;
revoke all on public.compliance_materials from anon;
revoke all on public.compliance_materials from authenticated;
grant select on public.compliance_materials to authenticated;
