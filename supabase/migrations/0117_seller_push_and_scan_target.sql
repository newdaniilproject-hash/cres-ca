-- 0117. Пуш продавцу о заказе и записи. Скан ведёт на карточку.
--
-- ── Пуш продавцу — вторая половина уже построенного ─────────────────────────
--
-- Найдено аудитом пушей 19.08.2026: `enqueue_staff_alert` жёстко ставила
-- ТОЛЬКО 'email'. Весь нативный слой — перехват пуша на переднем плане,
-- переход по `data.url`, полоска-баннер — писался ровно под сценарий
-- «продавец в складе узнаёт о заказе», а события под него не было:
-- продавец не получал пуш о новом заказе НИКОГДА, только письмо.
--
-- Теперь та же функция ставит обе строки: email и push. Обработчик очереди
-- у них общий; у кого нет подписки OneSignal — push честно уйдёт в failed,
-- письмо дойдёт как раньше. Ключ дедупликации у push свой (':push'),
-- иначе вторая строка съедала бы первую по ON CONFLICT.
--
-- `create or replace` поверх 0028: тело прочитано, всё нетронутое
-- перенесено дословно (0034 функцию не переписывала — только комментарий).

create or replace function public.enqueue_staff_alert(
  p_tenant     uuid,
  p_event      text,
  p_dedupe     text,
  p_payload    jsonb,
  p_permission text,
  p_ref_type   text,
  p_ref_id     uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select tm.user_id, p.email as email, coalesce(p.locale, 'uk') as locale
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.tenant_id = p_tenant
       and tm.role <> 'inspector'
       and p.email is not null
       and exists (
         select 1 from public.role_grants rg
          where rg.role = tm.role and rg.permission = p_permission)
  loop
    perform public.enqueue_notification(
      p_tenant, p_event, 'email',
      p_dedupe || ':' || r.user_id::text,
      p_payload, null,
      r.user_id, null, null, r.email, p_ref_type, p_ref_id, r.locale);
    perform public.enqueue_notification(
      p_tenant, p_event, 'push',
      p_dedupe || ':push:' || r.user_id::text,
      p_payload, null,
      r.user_id, null, null, null, p_ref_type, p_ref_id, r.locale);
  end loop;
end;
$$;

revoke execute on function public.enqueue_staff_alert(uuid, text, text, jsonb, text, text, uuid) from public;
revoke execute on function public.enqueue_staff_alert(uuid, text, text, jsonb, text, text, uuid) from anon;
revoke execute on function public.enqueue_staff_alert(uuid, text, text, jsonb, text, text, uuid) from authenticated;

-- Пуш-шаблоны продавца. Без них обработчик не найдёт текста и пометит
-- строку failed — то есть «включили канал» без шаблона значит включили
-- очередь ошибок.
insert into public.notification_templates (tenant_id, event, channel, locale, subject, body) values
  (null, 'seller.order_created',   'push', 'uk', null,
   'Нове замовлення №{{number}} на {{total}} {{currency}}'),
  (null, 'seller.booking_created', 'push', 'uk', null,
   'Новий запис: {{title}} — {{when}}')
on conflict do nothing;

-- ── Скан ведёт на карточку ──────────────────────────────────────────────────
--
-- Результат скана товара был справочной строкой без выхода: название и
-- остаток, ни кнопки, ни ссылки. Для ссылки на карточку каталога экрану
-- нужен offering_id — вариант его не знает. Колонка добавляется ПОСЛЕДНЕЙ.
--
-- `returns table` нельзя расширить через `or replace` — только drop+create.
-- Поэтому здесь ЗАНОВО выставляется всё, что функция несла: search_path
-- 'extensions' (0084 — иначе citext-сравнение снова станет регистровым
-- и уйдёт мимо индекса) и права (правило 7).

drop function if exists public.scan_lookup(uuid, extensions.citext);

create function public.scan_lookup(p_tenant_id uuid, p_code extensions.citext)
returns table (
  kind        text,        -- 'variant' | 'material'
  id          uuid,
  title       text,
  subtitle    text,
  unit        text,
  stock_qty   numeric,
  available   numeric,
  location    text,
  low_stock   boolean,
  offering_id uuid         -- у 'variant' — карточка каталога; у 'material' null
)
language sql
stable
security definer
set search_path to 'extensions'
as $$
  select 'variant',
         v.id,
         o.title,
         v.name,
         v.unit,
         v.stock_qty::numeric,
         greatest(v.stock_qty - v.reserved_qty, 0)::numeric,
         l.name,
         v.track_stock and v.stock_qty <= v.min_stock_threshold,
         v.offering_id
    from public.offering_variants v
    join public.offerings o on o.id = v.offering_id
    left join public.storage_locations l on l.id = v.location_id
   where v.tenant_id = p_tenant_id
     and public.tenant_can(p_tenant_id, 'stock.read')
     and (v.barcode = p_code or v.sku = p_code or o.sku = p_code)

  union all

  select 'material',
         m.id,
         m.name,
         m.category,
         m.unit,
         m.current_stock,
         m.current_stock,
         l.name,
         m.current_stock <= m.min_stock_threshold,
         null::uuid
    from public.materials m
    left join public.storage_locations l on l.id = m.location_id
   where m.tenant_id = p_tenant_id
     and public.tenant_can(p_tenant_id, 'stock.read')
     and exists (select 1 from public.material_barcodes b
                  where b.material_id = m.id and b.barcode = p_code)
  limit 10;
$$;

revoke execute on function public.scan_lookup(uuid, extensions.citext) from public;
revoke execute on function public.scan_lookup(uuid, extensions.citext) from anon;
revoke execute on function public.scan_lookup(uuid, extensions.citext) from authenticated;
grant  execute on function public.scan_lookup(uuid, extensions.citext) to authenticated;
