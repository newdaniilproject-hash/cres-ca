-- 0130. Своё фото у человека.
--
-- ── ЗАЧЕМ ──────────────────────────────────────────────────────────────────
--
-- Колонка `profiles.avatar_url` заведена с 0001 и всё это время МЁРТВАЯ:
-- ни один файл приложения её не читает и не пишет (проверено поиском
-- 25.08.2026). Экран профиля показывал первую букву имени в кружке —
-- и на переданном владельцем эталоне видно, ради чего фото нужно: без
-- него карточка человека это серый круг с буквой, то есть заглушка,
-- а не «я».
--
-- ── ПОЧЕМУ ПОТРЕБОВАЛАСЬ МИГРАЦИЯ, А НЕ ТОЛЬКО ЭКРАН ───────────────────────
--
-- Запись в бакет `media` разрешена политикой `media_insert` тем, у кого
-- есть `catalog.write`. Это верно для фото товара и логотипа — и неверно
-- для лица человека: мастер без права на каталог не смог бы поставить
-- себе фото, а владелец получил бы «загрузите за него». Право на СВОЮ
-- фотографию — это не право на каталог заведения.
--
-- Отсюда отдельная политика, и в ней граница проведена не по праву,
-- а по ПУТИ: писать можно только `<tenant_id>/avatars/<свой user_id>.<ext>`
-- и только в своё заведение. Чужой аватар переписать нельзя — имя файла
-- обязано совпасть с `auth.uid()`. Это то же правило 1 («первый сегмент
-- пути — арендатор»), просто с ещё одним звеном.
--
-- ⚠️ ЧТЕНИЕ ОСТАЁТСЯ ПУБЛИЧНЫМ, и это осознанно. Бакет `media` раздаётся
-- с CDN без подписи — так устроен весь каталог, и подписывать каждую
-- миниатюру значит платить за подпись на каждой отрисовке. Фото мастера
-- и так публично на витрине (`staff.avatar_path`). Адрес при этом
-- неугадываем: в нём два uuid подряд.

-- Запись своего файла.
drop policy if exists media_avatar_insert on storage.objects;
create policy media_avatar_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.my_tenants())
    and split_part(name, '/', 2) = 'avatars'
    -- Имя файла — свой `user_id` плюс расширение. `split_part(...,'.',1)`
    -- берёт часть ДО первой точки: расширение любое, идентификатор один.
    and split_part(split_part(name, '/', 3), '.', 1) = (select auth.uid())::text
  );

-- Замена своего файла. Отдельная политика, потому что загрузка поверх
-- существующего объекта — это UPDATE, а не INSERT, и без неё второе
-- фото не встало бы, а первое осталось бы навсегда.
drop policy if exists media_avatar_update on storage.objects;
create policy media_avatar_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.my_tenants())
    and split_part(name, '/', 2) = 'avatars'
    and split_part(split_part(name, '/', 3), '.', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.my_tenants())
    and split_part(name, '/', 2) = 'avatars'
    and split_part(split_part(name, '/', 3), '.', 1) = (select auth.uid())::text
  );

-- Удаление своего файла — «прибрати фото».
drop policy if exists media_avatar_delete on storage.objects;
create policy media_avatar_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and public.storage_tenant(name) in (select public.my_tenants())
    and split_part(name, '/', 2) = 'avatars'
    and split_part(split_part(name, '/', 3), '.', 1) = (select auth.uid())::text
  );

comment on column public.profiles.avatar_url is
  'Путь файла в бакете media: <tenant_id>/avatars/<user_id>.<ext>. '
  'Не полный адрес: домен проекта меняется, путь — нет.';
