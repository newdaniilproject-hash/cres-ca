-- ===========================================================================
-- 0083. Компланс-проекции, которых не хватало роли «инспектор»
-- ===========================================================================
--
-- Роль `inspector` после 0035 и 0043 имеет РОВНО одно право —
-- `compliance.read`. Всё, что она видит, обязано приходить либо из таблиц,
-- чья политика стоит на этом праве, либо из представлений `compliance_*`
-- (`security_invoker = off`, свой WHERE по `tenants_with('compliance.read')`,
-- только `select`). Ни того, ни другого не было в трёх местах, и каждое
-- ломалось МОЛЧА — не отказом в доступе, а пустотой и null'ами. Такой
-- дефект дороже отказа: пустой реестр читается как «в салоне ничего нет»,
-- а не как «вам это не показывают».
--
-- ── А. `compliance_containers` не покрывала свой собственный экран ────────
--
-- Экран «Відкриття та фасування» (`app/app/inventory/materials/[id]/pao`)
-- показывает СВОЙ срок разлитого дозатора: у ёмкости-потомка бывает
-- собственный `pao_months`, отличный от PAO засоба (0014, ТЗ 3.2).
-- В представлении этой колонки не было, поэтому экран читал
-- `material_containers` напрямую. Пока политика таблицы стоит на
-- `compliance.read`, это работает — и ровно поэтому опасно: день, когда
-- ёмкости закроют на `stock.read`, как закрыли партии в 0043, экран
-- встретит тем же молчаливым нулём. Представление, не покрывающее свой
-- экран, — приглашение обойти его.
--
-- Колонка дописывается В КОНЕЦ намеренно: `create or replace view` умеет
-- только это, а drop/create потянул бы за собой пересборку прав (грабли
-- 0036, 0060, 0072, 0082 — шесть раз подряд одно и то же). Цена решения —
-- порядок колонок в определении больше не совпадает с порядком в таблице.
--
-- ── Б. Техкарта у инспектора без названия услуги ──────────────────────────
--
-- 0015 выдавал инспектору `catalog.read` ОДНОЙ названной причиной —
-- «чтобы читать названия услуг в техкартах». 0035 право забрала (и была
-- права: вместе с названиями инспектор видел цены, себестоимость и статусы
-- всей коммерции), но замены не оставила. С тех пор техкарта — документ
-- из ТЗ 3.4 — приезжает проверяющему без названия услуги, к которой она
-- относится. Не с ошибкой: вложенный join к закрытой `offerings` отдаёт
-- null, а не отказ.
--
-- `compliance_offerings` — узкая проекция ровно под этот вопрос: три
-- колонки, из них две служебные. Ни цены, ни себестоимости, ни статуса,
-- ни описания. Строки — все позиции арендатора, а не только привязанные
-- к картам: `compliance_materials` тоже отдаёт весь реестр, а не только
-- засоби с партиями, и разнобой здесь стоил бы дороже лишней строки.
--
-- ── В. Журнал без исполнителя — не журнал ─────────────────────────────────
--
-- Найдено при разборе отчёта для проверки, не тестом. `profiles` читается
-- политикой `profiles_self_read` (0001) ТОЛЬКО про себя. Значит вложенный
-- `profiles(full_name)` в отчёте отдавал null не инспектору, а ВСЕМ, кроме
-- случая «исполнитель и есть смотрящий»: колонка «Виконавець» в трёх
-- санитарных журналах была прочерком у владельца тоже. При этом подвал
-- отчёта прямо утверждает: «У кожного запису зафіксовано час та виконавця».
-- Документ с юридическим весом обещал то, чего не показывал.
--
-- `compliance_actors` — имя и только имя, по тому же `compliance.read`.
-- Почта не отдаётся: она в этой роли не нужна. Оговорка о границе:
-- проекция строится от `tenant_members`, поэтому имя держится, пока
-- держится членство. В бою участника не удаляют, а блокируют (0051, 0079,
-- 0081) — при удалении членства старый журнал снова остался бы без имени.
--
-- ── Г. Мелочь того же рода ────────────────────────────────────────────────
--
-- `compliance_batch_history` (0043) единственная из компланс-представлений
-- не имеет ЯВНОГО `security_invoker = off`. Сейчас она работает на
-- умолчании — то есть на том, что никто не переключит умолчание и не
-- перепишет представление. Ровно так и была потеряна опция в 0060.
-- Выставляется явно по причине, записанной в 0062.
-- ===========================================================================

-- ── А. Собственный PAO ёмкости в компланс-проекции ────────────────────────

create or replace view public.compliance_containers as
select c.id, c.tenant_id, c.code, c.material_id, m.name as material_name,
       c.batch_id, b.batch_number, b.expiry_date as batch_expiry,
       c.parent_id, c.volume, c.unit, c.status, c.opened_at, c.opened_by,
       c.use_by, c.disposed_at, c.note, c.created_at, c.decanted_at,
       -- В конец списка, а не на своё место: см. причину в шапке файла.
       c.pao_months
  from public.material_containers c
  join public.materials m on m.id = c.material_id
  left join public.material_batches b on b.id = c.batch_id
 where c.tenant_id in (select public.tenants_with('compliance.read'));

-- `create or replace` права не сбрасывает, но правило 7 требует явной
-- строки в каждой миграции, а не рассуждения о том, что она не нужна.
revoke all on public.compliance_containers from public, anon, authenticated;
grant select on public.compliance_containers to authenticated, service_role;

alter view public.compliance_containers set (security_invoker = off);
alter view public.compliance_containers set (security_barrier = true);

comment on view public.compliance_containers is
  'Ёмкости для инспектора: наклейка, партия, срок, собственный PAO разлива. security_invoker = off — арендатора отсекает собственный WHERE по compliance.read (0062).';

-- ── Б. Названия услуг для техкарт ─────────────────────────────────────────

create or replace view public.compliance_offerings as
select o.id, o.tenant_id, o.title
  from public.offerings o
 where o.tenant_id in (select public.tenants_with('compliance.read'));

-- Порядок обязателен: сначала снять ВСЁ (в облаке Supabase на схеме
-- висит alter default privileges, отдающий новому объекту all для anon
-- и authenticated), потом вернуть только чтение.
revoke all on public.compliance_offerings from public, anon, authenticated;
grant select on public.compliance_offerings to authenticated, service_role;

alter view public.compliance_offerings set (security_invoker = off);
alter view public.compliance_offerings set (security_barrier = true);

comment on view public.compliance_offerings is
  'Названия услуг для техкарт. Замена catalog.read, забранного у инспектора в 0035: три колонки без цен, себестоимости и статуса (0083).';

-- ── В. Имена исполнителей журналов ────────────────────────────────────────

create or replace view public.compliance_actors as
select tm.tenant_id, p.id as user_id, p.full_name
  from public.tenant_members tm
  join public.profiles p on p.id = tm.user_id
 where tm.tenant_id in (select public.tenants_with('compliance.read'));

revoke all on public.compliance_actors from public, anon, authenticated;
grant select on public.compliance_actors to authenticated, service_role;

alter view public.compliance_actors set (security_invoker = off);
alter view public.compliance_actors set (security_barrier = true);

comment on view public.compliance_actors is
  'Имена исполнителей санитарных журналов. profiles читается только про себя (0001), поэтому вложенный join отдавал null всем ролям, а не только инспектору. Почта не отдаётся (0083).';

-- ── Г. Явная опция там, где она держалась на умолчании ────────────────────

alter view public.compliance_batch_history set (security_invoker = off);
