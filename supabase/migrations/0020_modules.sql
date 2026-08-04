-- Модули арендатора: что именно он купил и видит.
--
-- Зачем отдельная сущность, а не роль. Роль отвечает на вопрос «что этому
-- человеку можно делать» — она про сотрудника. Модуль отвечает на вопрос
-- «что этот бизнес вообще приобрёл» — он про арендатора целиком. Владелец
-- с полными правами всё равно не должен видеть каталог, если его заведение
-- взяло только склад. Смешивать эти две оси нельзя: получится, что доступ
-- к оплаченному разделу выдаётся правкой прав сотрудника.
--
-- Прямая причина появления: первому платящему клиенту (салон плетения
-- канекалона) отдаётся ТОЛЬКО склад с журналами. Он логинится и видит
-- склад, больше ничего. Остальное подключается по одному, когда он
-- к этому готов и когда за это заплачено.
--
-- Хранится массивом на арендаторе, а не таблицей связей: модулей меньше
-- двадцати, они меняются пакетом при смене тарифа, и джойн на каждый
-- рендер навигации здесь дороже, чем польза от нормализации.

create type public.tenant_module as enum (
  'inventory',    -- склад, расходники, ёмкости, приёмка, инвентаризация
  'compliance',   -- журналы, документы, техкарты, отчёт для проверки
  'bookings',     -- запись на услуги, слоты, напоминания
  'catalog',      -- товары и услуги, витрина
  'orders',       -- заказы и доставка
  'finance',      -- доходы, расходы, себестоимость
  'customers',    -- база клиентов и напоминания
  'storefront',   -- публичная страница и попадание в общий поиск
  'marketing'     -- рассылки, промокоды, реферальные ссылки
);

-- По умолчанию новый продавец получает набор, с которым продукт полезен
-- сразу, без нашего участия: витрина, каталог, заказы, клиенты. Это
-- «single-player mode» из стратегии — ценность до того, как площадка
-- привела хоть одного покупателя.
alter table public.tenants
  add column modules public.tenant_module[] not null
  default array['catalog','orders','customers','storefront']::public.tenant_module[];

comment on column public.tenants.modules is
  'Что арендатор купил и видит. Не путать с ролями: роль — про человека, модуль — про бизнес.';

-- Проверка модуля. Читает из того же токена, что и права: членства уже
-- там, а модули дописывает хук (см. 0001_tenancy.sql, custom_access_token_hook).
-- Обращения к таблице на каждой строке здесь нет — это правило 3.
create or replace function public.tenant_has_module(
  p_tenant_id uuid,
  p_module    public.tenant_module
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p_module::text = any(
       select jsonb_array_elements_text(
         coalesce(
           (current_setting('request.jwt.claims', true)::jsonb
             -> 'app_metadata' -> 'modules' -> p_tenant_id::text),
           '[]'::jsonb)))),
    false);
$$;

revoke execute on function public.tenant_has_module(uuid, public.tenant_module) from public;
-- Исключение по правилу 7: хелпер разбирает только токен, к таблицам
-- не обращается. Тот же признак допустимости, что у tenant_can.
grant execute on function public.tenant_has_module(uuid, public.tenant_module) to anon, authenticated;

-- Хук дописывает модули в токен рядом с правами.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims      jsonb;
  v_memberships jsonb;
  v_perms       jsonb;
  v_modules     jsonb;
  v_is_staff    boolean;
  v_uid         uuid := (event->>'user_id')::uuid;
begin
  select coalesce(jsonb_object_agg(tm.tenant_id::text, tm.role::text), '{}'::jsonb)
    into v_memberships
    from public.tenant_members tm
   where tm.user_id = v_uid;

  select coalesce(jsonb_object_agg(x.tenant_id::text, x.perms), '{}'::jsonb)
    into v_perms
    from (
      select tm.tenant_id,
             case
               when tm.role = 'owner' then '["*"]'::jsonb
               else coalesce((
                 select jsonb_agg(p.permission)
                   from (
                     select g.permission
                       from public.role_grants g
                      where g.role = tm.role
                        and coalesce(tm.permissions ->> g.permission, 'true') <> 'false'
                     union
                     select o.key
                       from jsonb_each_text(tm.permissions) as o(key, value)
                      where o.value = 'true'
                   ) p
               ), '[]'::jsonb)
             end as perms
        from public.tenant_members tm
       where tm.user_id = v_uid
    ) x;

  select coalesce(jsonb_object_agg(t.id::text, to_jsonb(t.modules)), '{}'::jsonb)
    into v_modules
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
   where tm.user_id = v_uid;

  select coalesce(p.is_staff, false)
    into v_is_staff
    from public.profiles p
   where p.id = v_uid;

  v_claims := coalesce(event->'claims', '{}'::jsonb);

  if v_claims->'app_metadata' is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  v_claims := jsonb_set(v_claims, '{app_metadata,memberships}', v_memberships);
  v_claims := jsonb_set(v_claims, '{app_metadata,perms}', v_perms);
  v_claims := jsonb_set(v_claims, '{app_metadata,modules}', v_modules);
  v_claims := jsonb_set(v_claims, '{app_metadata,is_staff}', to_jsonb(coalesce(v_is_staff, false)));

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Специализация продавца — для поиска.
--
-- Свободный текст в поиске не работает: «перукар», «парикмахер»,
-- «барбер» и «стрижка» — это один и тот же мастер, а покупатель наберёт
-- любое из четырёх. Поэтому специальность выбирается из справочника,
-- а совпадение ищется по синонимам, которые к ней привязаны.
create table public.specialities (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  kind       public.offering_kind not null,
  synonyms   text[] not null default '{}',
  position   int not null default 0,
  is_active  boolean not null default true
);

alter table public.specialities enable row level security;

create policy specialities_read on public.specialities
  for select to anon, authenticated using (is_active);

insert into public.specialities (slug, name, kind, synonyms, position) values
  ('hair',        'Перукар, стиліст',        'service', array['перукар','парикмахер','стилист','барбер','стрижка','зачіска','фарбування'], 10),
  ('braiding',    'Плетіння кіс, канекалон', 'service', array['коси','плетіння','канекалон','афрокоси','брейди','дреди'], 20),
  ('nails',       'Манікюр, педикюр',        'service', array['манікюр','маникюр','нігті','педикюр','гель-лак'], 30),
  ('brows',       'Брови та вії',            'service', array['брови','вії','ламінування','нарощування вій'], 40),
  ('cosmetology', 'Косметологія',            'service', array['косметолог','чистка обличчя','пілінг','догляд'], 50),
  ('massage',     'Масаж',                   'service', array['масаж','масажист','спина','релакс'], 60),
  ('tattoo',      'Тату та пірсинг',         'service', array['тату','татуювання','пірсинг','майстер тату'], 70),
  ('repair',      'Ремонт і побут',          'service', array['ремонт','майстер','сантехнік','електрик','полиця','меблі'], 80),
  ('auto',        'Автосервіс',              'service', array['авто','сто','автосервіс','шиномонтаж','механік'], 90),
  ('tutor',       'Навчання, репетитор',     'service', array['репетитор','вчитель','курси','англійська','італійська'], 100),
  ('photo',       'Фото та відео',           'service', array['фотограф','зйомка','відеограф','фотосесія'], 110),
  ('clothing',    'Одяг',                    'product', array['одяг','куртка','сукня','бренд','пальто'], 200),
  ('accessories', 'Аксесуари та прикраси',   'product', array['прикраси','сережки','сумка','аксесуари'], 210),
  ('cosmetics',   'Косметика',               'product', array['косметика','догляд','крем','шампунь'], 220),
  ('handmade',    'Хендмейд',                'product', array['хендмейд','ручна робота','подарунок'], 230),
  ('food',        'Їжа та напої',            'product', array['їжа','випічка','кава','торт','десерт'], 240),
  ('home',        'Дім і декор',             'product', array['дім','декор','свічки','посуд','текстиль'], 250),
  ('kids',        'Дитяче',                  'product', array['дитяче','діти','іграшки','одяг для дітей'], 260),
  ('parts',       'Автозапчастини',          'product', array['запчастини','авто','деталі'], 270),
  ('other',       'Інше',                    'product', array[]::text[], 900);

alter table public.tenants
  add column speciality_id uuid references public.specialities(id),
  add column speciality_note text;

comment on column public.tenants.speciality_note is
  'Чем именно занимается, своими словами. Идёт в поиск дополнительно к синонимам специальности.';

-- Синонимы специальности попадают в поисковый вектор арендатора: тогда
-- запрос «парикмахер» находит мастера, который у себя написал «перукар».
--
-- Раньше search_tsv был вычисляемой колонкой (GENERATED ALWAYS). Такая
-- колонка умеет ссылаться только на СВОЮ строку, а синонимы лежат в другой
-- таблице — поэтому колонку приходится снять и вести триггером. Ничего,
-- кроме источника значения, не меняется: имя, состав и веса те же.
alter table public.tenants drop column search_tsv;
alter table public.tenants add column search_tsv tsvector;

create or replace function public.tenants_search_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_syn text := '';
begin
  if new.speciality_id is not null then
    select coalesce(array_to_string(s.synonyms, ' '), '') || ' ' || coalesce(s.name, '')
      into v_syn
      from public.specialities s where s.id = new.speciality_id;
  end if;

  new.search_tsv :=
      setweight(to_tsvector('simple', coalesce(new.name, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.tagline, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(v_syn, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(new.city, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(new.speciality_note, '')), 'C');
  return new;
end;
$$;

revoke execute on function public.tenants_search_refresh() from public, anon, authenticated;

create trigger tenants_search
  before insert or update of name, tagline, city, speciality_id, speciality_note
  on public.tenants
  for each row execute function public.tenants_search_refresh();

create index tenants_search_idx on public.tenants using gin (search_tsv);

-- Пересчитать уже заведённых.
update public.tenants set name = name;
