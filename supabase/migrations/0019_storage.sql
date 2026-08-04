-- Хранилище файлов. До этой миграции в проекте не было НИ ОДНОГО бакета:
-- offering_media.path, tenants.logo_path, staff.avatar_path и
-- material_documents.storage_path ссылались в пустоту — загрузить
-- файл было физически некуда.
--
-- Бакета два, и разделены они не по типу файла, а по тому, кому файл виден.
-- Смешивать их нельзя: сертификат на косметику и фото куртки требуют
-- принципиально разных ответов на вопрос «кто может это скачать».
--
--   media     — публичный. Фото товаров, логотипы, обложки, аватары мастеров.
--               Раздаётся с CDN без подписи: подписывать каждую миниатюру
--               в каталоге — это лишний запрос на картинку и приговор
--               бюджету отрисовки (правило 6). Честная плата за это: файл
--               ещё не опубликованного товара доступен тому, кто откуда-то
--               узнал полный путь с двумя UUID. Считаем допустимым —
--               это фото одежды, а не персональные данные.
--
--   documents — приватный. MSDS, сертификаты качества, заключения СЭС,
--               то есть то, что по ТЗ салона показывают инспектору.
--               Наружу не отдаётся никогда: только подписанная ссылка
--               с коротким сроком, и только тому, у кого есть право
--               compliance.read у ЭТОГО арендатора.
--
-- Разграничение — по первому сегменту пути: '<tenant_id>/...'. Это тот же
-- принцип, что и правило 1 (у каждой строки есть tenant_id), просто
-- выраженный в имени объекта, потому что своей колонки у storage.objects нет.

-- Разбор tenant_id из пути. Без исключения на кривом имени: файл
-- '../hack.pdf' даст null, а null не совпадёт ни с одним арендатором,
-- то есть доступ будет закрыт, а не свалится с ошибкой.
create or replace function public.storage_tenant(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

revoke execute on function public.storage_tenant(text) from public;
-- Исключение по правилу 7: функцию вызывают сами политики хранилища,
-- применяемые в том числе к анониму. К таблицам не обращается — разбирает
-- строку. Тот же признак допустимости, что у хелперов RLS.
grant execute on function public.storage_tenant(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', true, 10485760,
   array['image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml']),
  ('documents', 'documents', false, 20971520,
   array['application/pdf','image/jpeg','image/png','image/webp',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- media: читают все, пишет только команда магазина
-- ─────────────────────────────────────────────────────────────────────────────

create policy media_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media');

create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.tenants_with('catalog.write'))
  );

create policy media_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'media'
              and public.storage_tenant(name) in (select public.tenants_with('catalog.write')))
  with check (bucket_id = 'media'
              and public.storage_tenant(name) in (select public.tenants_with('catalog.write')));

create policy media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.tenants_with('catalog.write'))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- documents: и чтение, и запись — только по праву compliance
-- ─────────────────────────────────────────────────────────────────────────────
-- Инспектор (роль из 0015) имеет compliance.read и потому может СКАЧАТЬ
-- сертификат, но не может ни загрузить, ни подменить, ни удалить его —
-- ровно это и требует раздел «Inspector View» в ТЗ салона.

create policy documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.storage_tenant(name) in (select public.tenants_with('compliance.read'))
  );

create policy documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.storage_tenant(name) in (select public.tenants_with('compliance.write'))
  );

create policy documents_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'documents'
              and public.storage_tenant(name) in (select public.tenants_with('compliance.write')))
  with check (bucket_id = 'documents'
              and public.storage_tenant(name) in (select public.tenants_with('compliance.write')));

create policy documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.storage_tenant(name) in (select public.tenants_with('compliance.write'))
  );
