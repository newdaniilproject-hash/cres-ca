-- 0016_search_geo_onboarding.sql
-- Поиск по всему маркетплейсу, гео продавцов для карты, самостоятельная
-- регистрация магазина.
--
-- Поиск устроен без отдельного поискового сервиса (ADR 0007: третий
-- сервис не заводится без измеренной причины): полнотекст Postgres
-- + триграммы для опечаток. На объёмах первого года этого достаточно
-- с запасом; когда станет тесно — узкое место будет видно в цифрах.
--
-- Конфигурация полнотекста — 'simple': украинского словаря в Postgres
-- нет, а стемминг чужого языка вредит хуже его отсутствия. Триграммы
-- добирают морфологию: «манікюр» найдётся и по «маникюр», и по «манікю».

create extension if not exists pg_trgm with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Публичный профиль магазина: адрес, координаты, обложка
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tenants
  add column city       text,
  add column address    text,
  -- Координаты для карты. Заполняются продавцом при онбординге,
  -- геокодирует крайний слой (не база).
  add column lat        double precision check (lat between -90 and 90),
  add column lng        double precision check (lng between -180 and 180),
  add column cover_path text,
  add column logo_path  text;

create index tenants_city_idx on public.tenants (city)
  where status = 'active' and storefront_enabled;
create index tenants_geo_idx on public.tenants (lat, lng)
  where lat is not null and status = 'active' and storefront_enabled;

-- ─────────────────────────────────────────────────────────────────────────────
-- Полнотекст и триграммы
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.offerings
  add column search_tsv tsvector
    generated always as (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(description, '')), 'C')
    ) stored;

create index offerings_search_idx on public.offerings using gin (search_tsv);
create index offerings_title_trgm_idx on public.offerings
  using gin (title extensions.gin_trgm_ops);

alter table public.tenants
  add column search_tsv tsvector
    generated always as (
      setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(tagline, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(city, '')), 'B')
    ) stored;

create index tenants_search_idx on public.tenants using gin (search_tsv);
create index tenants_name_trgm_idx on public.tenants
  using gin (name extensions.gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- Единый поиск: магазины и позиции одним вызовом
-- ─────────────────────────────────────────────────────────────────────────────
-- Отдаёт только опубликованное. Ранжирование: точное вхождение >
-- полнотекст > триграммная похожесть; магазины при равенстве выше
-- позиций — человек, ищущий «Ліхтарик», скорее ищет магазин с таким
-- именем, чем товар.

create or replace function public.search_all(
  p_query text,
  p_kind  public.offering_kind default null,
  p_city  text default null,
  p_limit int default 20
)
returns table (
  result_type text,          -- 'shop' | 'offering'
  id          uuid,
  title       text,
  subtitle    text,
  slug        citext,
  shop_slug   citext,
  shop_name   text,
  city        text,
  kind        text,       -- 'product' | 'service' | вид магазина
  price       numeric,
  currency    char(3),
  image_path  text,
  rank        real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery('simple', p_query) as tsq,
           lower(btrim(p_query)) as raw
  ),
  shops as (
    select 'shop'::text, t.id, t.name, coalesce(t.tagline, t.city),
           t.slug, t.slug, t.name, t.city,
           t.kind::text, null::numeric, null::char(3),
           coalesce(t.logo_path, t.cover_path),
           (ts_rank(t.search_tsv, q.tsq) * 2
            + extensions.similarity(lower(t.name), q.raw) * 2
            + case when lower(t.name) like q.raw || '%' then 1 else 0 end)::real as score
      from public.tenants t, q
     where t.status = 'active' and t.storefront_enabled
       and (p_city is null or t.city = p_city)
       and (t.search_tsv @@ q.tsq or extensions.similarity(lower(t.name), q.raw) > 0.25)
  ),
  offs as (
    select 'offering'::text, o.id, o.title, o.subtitle,
           o.slug, t.slug, t.name, t.city,
           o.kind::text, o.price, o.currency,
           (select m.path from public.offering_media m
             where m.offering_id = o.id order by m.position limit 1),
           (ts_rank(o.search_tsv, q.tsq)
            + extensions.similarity(lower(o.title), q.raw) * 1.5
            + case when lower(o.title) like q.raw || '%' then 0.5 else 0 end)::real as score
      from public.offerings o
      join public.tenants t on t.id = o.tenant_id, q
     where o.status = 'active' and o.listed
       and t.status = 'active' and t.storefront_enabled and t.listed_in_catalog
       and (p_kind is null or o.kind = p_kind)
       and (p_city is null or t.city = p_city)
       and (o.search_tsv @@ q.tsq or extensions.similarity(lower(o.title), q.raw) > 0.25)
  )
  select * from (
    select * from shops
    union all
    select * from offs
  ) r
  where r.score > 0.02
  order by r.score desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke execute on function public.search_all(text, public.offering_kind, text, int) from public;
grant  execute on function public.search_all(text, public.offering_kind, text, int) to anon, authenticated;

-- Магазины для карты: только опубликованные и только с координатами.
create or replace function public.map_tenants(
  p_kind public.offering_kind default null,
  p_city text default null
)
returns table (
  id uuid, slug citext, name text, tagline text, city text, address text,
  lat double precision, lng double precision,
  kind public.tenant_kind, logo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.slug, t.name, t.tagline, t.city, t.address,
         t.lat, t.lng, t.kind, t.logo_path
    from public.tenants t
   where t.status = 'active' and t.storefront_enabled
     and t.lat is not null and t.lng is not null
     and (p_city is null or t.city = p_city)
     and (p_kind is null
          or t.kind = 'both'
          or t.kind::text = p_kind::text || 's'
          or (p_kind = 'product' and t.kind = 'goods')
          or (p_kind = 'service' and t.kind = 'services'))
   limit 500;
$$;

revoke execute on function public.map_tenants(public.offering_kind, text) from public;
grant  execute on function public.map_tenants(public.offering_kind, text) to anon, authenticated;

-- Города, в которых есть опубликованные магазины, — для фильтра.
create or replace function public.active_cities()
returns table (city text, shops bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.city, count(*)
    from public.tenants t
   where t.status = 'active' and t.storefront_enabled and t.city is not null
   group by t.city
   order by count(*) desc, t.city
   limit 50;
$$;

revoke execute on function public.active_cities() from public;
grant  execute on function public.active_cities() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Самостоятельная регистрация магазина
-- ─────────────────────────────────────────────────────────────────────────────
-- Вошедший пользователь создаёт магазин и становится его владельцем —
-- одной транзакцией, без участия платформы. Черновик: витрина закрыта,
-- публикация после проверки (docs/DOMAIN.md).
--
-- ВАЖНО ПРО ТОКЕН: членство попадает в JWT при следующей выдаче токена,
-- поэтому интерфейс сразу после регистрации обязан вызвать
-- supabase.auth.refreshSession() — иначе владелец «не увидит» свой
-- магазин до истечения часа. Это записано и в docs/SETUP.md.

create or replace function public.register_tenant(
  p_name text,
  p_kind public.tenant_kind default 'goods',
  p_city text default null,
  p_slug citext default null
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_slug  public.citext;
  v_row   public.tenants;
  v_try   int := 0;
begin
  if v_actor is null then
    raise exception 'регистрация магазина требует входа';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'название магазина слишком короткое';
  end if;
  -- Один человек не может наплодить магазины пачкой: три черновика —
  -- достаточно для любых честных сценариев, дальше — через поддержку.
  if (select count(*) from public.tenant_members tm
       join public.tenants t on t.id = tm.tenant_id
      where tm.user_id = v_actor and tm.role = 'owner' and t.status = 'draft') >= 3 then
    raise exception 'у вас уже три неопубликованных магазина — опубликуйте или удалите их';
  end if;

  -- Слаг: из названия, транслитерация минимальная, при занятости — суффикс.
  v_slug := coalesce(p_slug, lower(regexp_replace(
    translate(btrim(p_name),
      'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяыэё ',
      'abvggdeezzyiijklmnoprstufhccss__ja__e-'),
    '[^a-z0-9-]', '', 'g')));
  if length(v_slug) < 3 then
    v_slug := 'shop-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  v_slug := substr(v_slug, 1, 38);

  loop
    begin
      insert into public.tenants (slug, name, kind, city, status)
      values (case when v_try = 0 then v_slug
                   else (substr(v_slug, 1, 34) || '-' || substr(gen_random_uuid()::text, 1, 3))::public.citext end,
              btrim(p_name), p_kind, p_city, 'draft')
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 3 then raise; end if;
    end;
  end loop;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_row.id, v_actor, 'owner');

  return v_row;
end;
$$;

revoke execute on function public.register_tenant(text, public.tenant_kind, text, citext) from public, anon;
grant  execute on function public.register_tenant(text, public.tenant_kind, text, citext) to authenticated;

-- Витрина магазина для публичной страницы: одна функция вместо трёх
-- запросов с клиента (см. docs/PERFORMANCE.md, правило 3).
create or replace function public.storefront(p_slug citext)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shop', to_jsonb(t.*) - 'search_tsv' - 'tax_id' - 'legal_name'
              - 'contact_email' - 'contact_phone',
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'slug', o.slug, 'title', o.title, 'subtitle', o.subtitle,
        'kind', o.kind, 'price', o.price, 'compare_at', o.compare_at,
        'currency', o.currency,
        'image', (select m.path from public.offering_media m
                   where m.offering_id = o.id order by m.position limit 1),
        'rating_avg', o.rating_avg, 'rating_count', o.rating_count
      ) order by o.published_at desc nulls last)
      from public.offerings o
      where o.tenant_id = t.id and o.status = 'active'
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'title', s.title, 'avatar', s.avatar_path
      ) order by s.position)
      from public.staff s where s.tenant_id = t.id and s.is_active
    ), '[]'::jsonb)
  )
  from public.tenants t
  where t.slug = p_slug and t.status = 'active' and t.storefront_enabled;
$$;

revoke execute on function public.storefront(citext) from public;
grant  execute on function public.storefront(citext) to anon, authenticated;
