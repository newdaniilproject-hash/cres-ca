-- ===========================================================================
-- 0104. Отзывы и рейтинг. Колонки есть с 0002, писать в них нечему.
-- ===========================================================================
--
-- ЧТО БЫЛО. `offerings.rating_avg` и `rating_count` лежат с самого начала
-- каталога (0002), `storefront()` их отдаёт (0016), фронт их даже типизирует
-- (`app/t/[slug]/page.tsx`) — и нигде не показывает. Значений в них тоже
-- нет: ни одной строки, которая бы туда писала. Рейтинг существовал
-- как мёртвые данные три уровня подряд: колонка → RPC → тип, и ни разу
-- не значение.
--
-- ── ЕДИНСТВЕННАЯ ЗАЩИТА РЕЙТИНГА, КОТОРАЯ РАБОТАЕТ ─────────────────────────
--
-- Отзыв — только от того, у кого есть ВЫПОЛНЕННЫЙ заказ или запись.
-- Без этого условия рейтинг ничего не значит: любой вошедший мог бы
-- накрутить пятёрки своему заведению или обвалить чужое. Проверка идёт
-- не по «купил когда-то», а по КОНКРЕТНОМУ документу: `order_items.id`
-- или `bookings.id`, и на каждый документ — не больше одного отзыва.
-- Купил снова — можно оставить ещё один, честно, по новому опыту.
--
-- ── ОТЗЫВ ПРИВЯЗАН К ПОЗИЦИИ ЗАКАЗА, А НЕ К ЗАКАЗУ ЦЕЛИКОМ ─────────────────
--
-- Заказ может содержать несколько разных товаров/услуг с общим рейтингом
-- каждый. `order_items.id`, а не `orders.id`: иначе отзыв на заказ из трёх
-- позиций непонятно, к какой из них относить.
--
-- ── КОЛОНКИ РЕЙТИНГА ЗАЩИЩЕНЫ ОТ ПРЯМОЙ ПРАВКИ ─────────────────────────────
--
-- До этой миграции `rating_avg`/`rating_count` не были мёртвыми только
-- по недосмотру — `guard_stock_columns` (0003) их не касается вовсе,
-- то есть любой, у кого есть `catalog.write`, мог выставить своему товару
-- 5.00 из воздуха обычным UPDATE. Рейтинг, который продавец правит себе
-- сам, — не механизм доверия, а его подделка. Отдельный сторож,
-- по образцу `guard_stock_columns`: калитка открывается ровно на один
-- UPDATE самим триггером пересчёта и закрывается обратно (0049/0090).
--
-- ── ОТЗЫВЫ НЕИЗМЕНЯЕМЫ ──────────────────────────────────────────────────────
--
-- Тот же приём, что у `finance_records` (0007) и возвратов (0103): продавец
-- не может выпросить у покупателя правку задним числом, а разгневанный
-- покупатель не может тихо смягчить или ужесточить оценку после спора.
-- Опечатку в тексте не исправить — это цена доверия к цифре, а не оплошность.
-- ===========================================================================

-- ── 1. Таблица отзывов ───────────────────────────────────────────────────

create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  offering_id   uuid not null references public.offerings(id) on delete cascade,

  -- Ровно один источник: позиция заказа ИЛИ запись. Оба ссылаются
  -- на КОНКРЕТНЫЙ купленный опыт, а не на «когда-то у этого продавца».
  order_item_id uuid references public.order_items(id) on delete set null,
  booking_id    uuid references public.bookings(id) on delete set null,

  buyer_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Снимок имени на момент отзыва, а не join на profiles: имя могло
  -- смениться, а витрина должна показывать то же, что покупатель видел
  -- в своём заказе. Тот же приём, что contact_name у orders/bookings.
  author_name   text not null,

  rating        smallint not null check (rating between 1 and 5),
  text          text,

  created_at    timestamptz not null default now(),

  check ((order_item_id is not null) <> (booking_id is not null))
);

-- Один отзыв на купленный опыт. Частичные индексы, а не составной unique
-- с coalesce: `order_item_id`/`booking_id` у другого источника всегда null,
-- и обычный unique пропустил бы вторую строку с тем же null молча.
--
-- `tenant_id` в индексе первым столбцом — правило 1: все уникальные
-- ограничения составные. `order_item_id`/`booking_id` и без того глобально
-- уникальны (это чужие первичные ключи), но правило одно на весь проект
-- без исключений — и именно так его проверяет `06_isolation.sql`.
create unique index if not exists reviews_order_item_uidx
  on public.reviews (tenant_id, order_item_id) where order_item_id is not null;
create unique index if not exists reviews_booking_uidx
  on public.reviews (tenant_id, booking_id) where booking_id is not null;

create index if not exists reviews_offering_idx on public.reviews (offering_id, created_at desc);
create index if not exists reviews_tenant_idx   on public.reviews (tenant_id);
create index if not exists reviews_buyer_idx    on public.reviews (buyer_user_id);

alter table public.reviews enable row level security;

-- ── 2. Неизменяемость ────────────────────────────────────────────────────

create or replace function public.reviews_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception 'відгук не редагується і не видаляється: помилку залишає новий відгук, а не правка старого';
end;
$$;

drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard
  before update or delete on public.reviews
  for each row execute function public.reviews_guard();

revoke all on function public.reviews_guard() from public;
revoke all on function public.reviews_guard() from anon;
revoke all on function public.reviews_guard() from authenticated;

-- ── 3. Политики: читают продавец (по каталогу) и сам автор; пишет функция ──

drop policy if exists reviews_read_staff on public.reviews;
create policy reviews_read_staff on public.reviews
  for select using (tenant_id in (select public.tenants_with('catalog.read')));

drop policy if exists reviews_read_own on public.reviews;
create policy reviews_read_own on public.reviews
  for select using (buyer_user_id = auth.uid());

-- Политик на INSERT нет: отзыв заводится только через `create_review`,
-- которая проверяет купленный опыт, статус и авторство. Прямая вставка
-- обошла бы все три проверки разом.

revoke all on table public.reviews from public;
revoke all on table public.reviews from anon;
revoke all on table public.reviews from authenticated;
grant select on table public.reviews to authenticated;

-- ── 4. Рейтинг товара защищён от прямой правки ──────────────────────────

create or replace function public.offerings_rating_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(current_setting('vitrina.allow_rating_write', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.rating_avg, 0) <> 0 or coalesce(new.rating_count, 0) <> 0 then
      raise exception
        'товар заводиться з нульовим рейтингом: rating_avg/rating_count рахуються з відгуків';
    end if;
    return new;
  end if;

  if new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception
      'rating_avg/rating_count рахуються з таблиці reviews — не редагуються напряму';
  end if;

  return new;
end;
$$;

drop trigger if exists offerings_rating_guard on public.offerings;
create trigger offerings_rating_guard
  before insert or update on public.offerings
  for each row execute function public.offerings_rating_guard();

revoke all on function public.offerings_rating_guard() from public;
revoke all on function public.offerings_rating_guard() from anon;
revoke all on function public.offerings_rating_guard() from authenticated;

-- ── 5. Пересчёт рейтинга — тем же приёмом, что запись остатка (0003) ────

create or replace function public.reviews_recompute_rating()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_prev text;
begin
  v_prev := coalesce(current_setting('vitrina.allow_rating_write', true), '');
  perform set_config('vitrina.allow_rating_write', 'on', true);

  update public.offerings o
     set rating_avg = coalesce((select round(avg(r.rating), 2)
                                   from public.reviews r
                                  where r.offering_id = o.id), 0),
         rating_count = (select count(*) from public.reviews r
                           where r.offering_id = o.id)
   where o.id = new.offering_id;

  perform set_config('vitrina.allow_rating_write', v_prev, true);
  return new;
end;
$$;

drop trigger if exists reviews_recompute_rating on public.reviews;
create trigger reviews_recompute_rating
  after insert on public.reviews
  for each row execute function public.reviews_recompute_rating();

revoke all on function public.reviews_recompute_rating() from public;
revoke all on function public.reviews_recompute_rating() from anon;
revoke all on function public.reviews_recompute_rating() from authenticated;

-- ── 6. Оставить отзыв ────────────────────────────────────────────────────

create or replace function public.create_review(
  p_tenant_id uuid,
  p_kind      text,       -- 'order' | 'booking'
  p_source_id uuid,       -- order_items.id либо bookings.id
  p_rating    integer,
  p_text      text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $fn$
declare
  v_actor      uuid := auth.uid();
  v_offering   uuid;
  v_author     text;
  v_status     text;
  v_id         uuid;
begin
  if v_actor is null then
    raise exception 'відгук залишає лише авторизований покупець';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'оцінка — ціле число від 1 до 5';
  end if;

  if p_kind = 'order' then
    select oi.offering_id, o.contact_name, o.status::text
      into v_offering, v_author, v_status
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.id = p_source_id and o.tenant_id = p_tenant_id;
    if not found then
      raise exception 'позиції замовлення % немає в закладі %', p_source_id, p_tenant_id;
    end if;
    if v_status <> 'completed' then
      raise exception 'відгук можна залишити лише на виконане замовлення';
    end if;
    if not exists (
      select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
       where oi.id = p_source_id and o.buyer_user_id = v_actor
    ) then
      raise exception 'відгук залишає лише покупець цього замовлення';
    end if;
    if exists (select 1 from public.reviews where order_item_id = p_source_id) then
      raise exception 'відгук на цю позицію вже залишено';
    end if;

  elsif p_kind = 'booking' then
    select b.offering_id, b.contact_name, b.status::text
      into v_offering, v_author, v_status
      from public.bookings b
     where b.id = p_source_id and b.tenant_id = p_tenant_id;
    if not found then
      raise exception 'запису % немає в закладі %', p_source_id, p_tenant_id;
    end if;
    if v_status <> 'completed' then
      raise exception 'відгук можна залишити лише на виконаний запис';
    end if;
    if not exists (
      select 1 from public.bookings where id = p_source_id and buyer_user_id = v_actor
    ) then
      raise exception 'відгук залишає лише клієнт цього запису';
    end if;
    if exists (select 1 from public.reviews where booking_id = p_source_id) then
      raise exception 'відгук на цей запис вже залишено';
    end if;

  else
    raise exception 'невідоме джерело відгуку: %', p_kind;
  end if;

  insert into public.reviews
    (tenant_id, offering_id, order_item_id, booking_id, buyer_user_id, author_name, rating, text)
  values (
    p_tenant_id, v_offering,
    case when p_kind = 'order' then p_source_id end,
    case when p_kind = 'booking' then p_source_id end,
    v_actor, coalesce(v_author, ''), p_rating, nullif(btrim(coalesce(p_text, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.create_review(uuid, text, uuid, integer, text) is
  'Отзыв от покупателя с выполненным заказом или записью, один на купленный опыт. Пересчёт рейтинга — триггером reviews_recompute_rating.';

revoke all on function public.create_review(uuid, text, uuid, integer, text) from public;
revoke all on function public.create_review(uuid, text, uuid, integer, text) from anon;
revoke all on function public.create_review(uuid, text, uuid, integer, text) from authenticated;
grant execute on function public.create_review(uuid, text, uuid, integer, text) to authenticated;
