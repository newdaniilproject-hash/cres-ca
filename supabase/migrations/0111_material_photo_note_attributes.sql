-- 0111. Расходник получает фото, заметку и произвольные поля.
--
-- ── Откуда ──────────────────────────────────────────────────────────────────
--
-- Требование владельца 19.08.2026 дословно: «Человек может на склад добавить
-- расходники — перчатки, растворы, — загрузить картинку, если надо ему этого
-- элемента. Описание дать, кастомизировать, заметки сделать, вписать всё что
-- угодно. Это его склад. Он может делать с ним всё, что хочет».
--
-- Сегодня в карточке засоба нет ни одного из трёх: ни фото, ни заметки,
-- ни места под своё поле. Паспорт по Техрегламенту №65 есть весь (бренд,
-- артикул, INCI, страна, партия, срок, PAO, нотификация) — но он ОБЯЗАТЕЛЬНЫЙ
-- и одинаковый у всех. Своего у продавца в карточке не было ничего.
--
-- ── Три колонки и почему именно три ─────────────────────────────────────────
--
-- `image_path` — фото в ПУБЛИЧНОМ бакете `media`, тем же путём и правилом,
--   что у фотографий товаров: первый сегмент — `tenant_id` (правило 1).
--   Публичный, а не приватный: подписывать каждую миниатюру списка —
--   приговор бюджету отрисовки (CLAUDE.md, «Файлы»). Фото банки коммерческой
--   тайной не является; документы (MSDS, сертификаты) как лежали в приватном
--   бакете, так и лежат.
--
-- `note` — свободный текст продавца. Одно поле, а не «описание» плюс
--   «заметки»: два поля свободного текста рядом означают, что человек
--   каждый раз выбирает, в какое писать, и через месяц половина сведений
--   в одном, половина в другом.
--
-- `attributes` — произвольные поля (`{"постачальник другий": "...",
--   "полиця": "B3"}`). Ровно тот же приём, которым в каталоге описаны
--   характеристики товара (правило 4: характеристики лежат в `jsonb`,
--   схема не знает, чем торгует продавец). Это и есть «вписать всё что
--   угодно», сделанное данными, а не двадцатью колонками про запас.
--
-- ── Чего эта миграция НЕ делает ─────────────────────────────────────────────
--
-- Не трогает права: и колонки, и бакет уже покрыты политиками `stock.write`
-- и `storage_tenant`. Не заводит вторую сущность «фото» — одна картинка
-- на засіб, потому что это опознавательный знак банки на полке, а не
-- галерея товара.

alter table public.materials
  add column if not exists image_path text,
  add column if not exists note       text,
  add column if not exists attributes jsonb not null default '{}'::jsonb;

comment on column public.materials.image_path is
  'Фото засобу в публичном бакете media. Первый сегмент пути — tenant_id.';
comment on column public.materials.note is
  'Свободная заметка продавца. Одно поле на всё: два поля свободного текста '
  'рядом заставляют выбирать, куда писать.';
comment on column public.materials.attributes is
  'Произвольные поля продавца. Тот же приём, что у характеристик каталога.';

-- Сторож: `attributes` — это ОБЪЕКТ, а не массив и не строка. Без проверки
-- туда однажды ляжет `[]` или `"текст"`, и экран, который обходит ключи,
-- молча покажет пусто.
alter table public.materials
  drop constraint if exists materials_attributes_object;
alter table public.materials
  add constraint materials_attributes_object
  check (jsonb_typeof(attributes) = 'object');

-- Путь к файлу обязан начинаться с идентификатора арендатора — правило 1
-- в его файловом виде. Проверка здесь, а не только в политике хранилища:
-- политика следит за ЗАГРУЗКОЙ, а эта колонка хранит ссылку, и записать
-- в неё чужой путь можно было бы обычным UPDATE, не трогая хранилище вовсе.
create or replace function public.materials_image_path_guard()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  if new.image_path is not null
     and new.image_path !~ ('^' || new.tenant_id::text || '/') then
    raise exception 'шлях до фото має починатися з ідентифікатора закладу';
  end if;
  return new;
end $fn$;

drop trigger if exists materials_image_path_guard on public.materials;
create trigger materials_image_path_guard
  before insert or update of image_path on public.materials
  for each row execute function public.materials_image_path_guard();

revoke execute on function public.materials_image_path_guard() from public;
revoke execute on function public.materials_image_path_guard() from anon;
revoke execute on function public.materials_image_path_guard() from authenticated;
grant  execute on function public.materials_image_path_guard() to service_role;

-- Инспектор видит фото, но не видит заметок продавца: заметка — это
-- внутренняя кухня заведения («брать у другого поставщика», «Оксана
-- жалуется на запах»), и в режиме проверки ей делать нечего. Произвольные
-- поля — туда же: они могут содержать что угодно, включая цены.
--
-- ⚠️ КОЛОНКА ДОБАВЛЯЕТСЯ В КОНЕЦ И ТОЛЬКО В КОНЕЦ. `create or replace view`
-- требует того же набора и того же ПОРЯДКА ведущих колонок; вставка
-- в середину даёт «cannot change name of view column» на накате с нуля,
-- а на бою — молчаливое расхождение. Эта грабля уже описана в 0106,
-- список ниже скопирован оттуда дословно и дополнен последней строкой.
--
-- `security_invoker` здесь НЕ ставится: представления `compliance_*`
-- намеренно работают правами владельца — это то, что даёт инспектору
-- видеть реестр, не имея прав на таблицу (CLAUDE.md, «Соответствие
-- Техрегламенту»). Не «чинить».
create or replace view public.compliance_materials as
select m.id, m.tenant_id, m.name, m.unit, m.category, m.brand, m.country_of_origin,
       m.inci, m.notification_code, m.notification_url, m.notification_date,
       m.pao_months, m.is_cosmetic, m.sku,
       m.is_active, m.created_at, m.updated_at,
       m.notification_confirmed_at,
       (m.is_cosmetic and m.notification_confirmed_at is not null) as notification_ok,
       m.image_path
  from public.materials m
 where m.tenant_id in (select public.tenants_with('compliance.read'));

alter view public.compliance_materials set (security_barrier = true);

revoke all on public.compliance_materials from public;
revoke all on public.compliance_materials from anon;
revoke all on public.compliance_materials from authenticated;
grant select on public.compliance_materials to authenticated;
grant select on public.compliance_materials to service_role;
