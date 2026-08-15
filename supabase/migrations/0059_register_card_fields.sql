-- 0059. Поля карточки реестра, которых не хватало экранам ТЗ 3.1.
--
-- ЗАЧЕМ. Пункт 3.1 ТЗ требует «Статус Нотифікації: Поле з ПОСИЛАННЯМ/кодом
-- внесення до Єдиної системи електронної нотифікації МОЗ». В базе был
-- только код (materials.notification_code) — свободный текст без ссылки
-- и без даты внесения. Инспектор по коду проверить ничего не может:
-- он должен открыть запись в реестре МОЗ. Поэтому ссылка и дата.
--
-- Дата изготовления партии — из макета карточки засобу. В ТЗ явно названы
-- «номер партії» и «термін придатності», но без даты изготовления PAO
-- проверить нечем: инспектор сверяет срок годности с датой выпуска.
--
-- Размер и тип файла у документа — чтобы список документов показывал
-- «1.2 MB · PDF» не запрашивая хранилище на каждую строку. Значение
-- пишет загрузчик, у старых строк остаётся null, и это честно: экран
-- покажет «PDF» без размера, а не выдуманный размер.
--
-- Ничего не переносится и не пересчитывается: все колонки необязательные.

alter table public.materials
  add column if not exists notification_url  text,
  add column if not exists notification_date date;

alter table public.material_batches
  add column if not exists manufactured_date date;

alter table public.material_documents
  add column if not exists size_bytes bigint,
  add column if not exists mime       text;

-- Ссылка обязана быть ссылкой. Иначе поле повторит судьбу кода:
-- станет вторым местом для свободного текста.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'materials_notification_url_http') then
    alter table public.materials
      add constraint materials_notification_url_http
      check (notification_url is null or notification_url ~* '^https?://');
  end if;

  -- Дата изготовления не может быть позже срока годности: это не опечатка,
  -- это перевёрнутая партия, и её нельзя пускать в реестр.
  if not exists (select 1 from pg_constraint where conname = 'material_batches_made_before_expiry') then
    alter table public.material_batches
      add constraint material_batches_made_before_expiry
      check (manufactured_date is null or manufactured_date <= expiry_date);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'material_documents_size_positive') then
    alter table public.material_documents
      add constraint material_documents_size_positive
      check (size_bytes is null or size_bytes > 0);
  end if;
end $$;

comment on column public.materials.notification_url  is 'Ссылка на запись в реестре нотификаций МОЗ (ТЗ 3.1)';
comment on column public.materials.notification_date is 'Дата внесения в реестр нотификаций МОЗ';
comment on column public.material_batches.manufactured_date is 'Дата изготовления партии';
comment on column public.material_documents.size_bytes is 'Размер файла в байтах, пишет загрузчик';
comment on column public.material_documents.mime is 'MIME-тип файла, пишет загрузчик';
