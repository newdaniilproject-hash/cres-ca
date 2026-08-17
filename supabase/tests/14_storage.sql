-- 14_storage.sql — хранилище файлов (миграция 0019).
--
-- Своей колонки tenant_id у storage.objects нет, поэтому правило 1
-- выражено первым сегментом пути: '<tenant_id>/...'. Всё разграничение
-- держится на одной функции разбора и восьми политиках. Значит проверять
-- надо ровно это: разбор кривого пути и ПОПЫТКУ дотянуться до чужого.
--
-- Почему тест не пишет и не читает сами файлы: на стенде storage — две
-- таблицы-заглушки (00_stubs.sql). Но политики применяются к реестру
-- storage.objects, а не к байтам, поэтому проверяется именно то, что
-- решает вопрос «кто может это скачать».
--
-- Чего этот набор НЕ покрывает: срок жизни подписанной ссылки (пять
-- минут) задаётся в приложении — lib/…/material-docs.tsx,
-- createSignedUrl(path, 300). База о нём не знает, из SQL его не видно.

\set ON_ERROR_STOP on

\echo '--- 0019: разбор пути — кривой путь даёт NULL, а не ошибку и не чужой доступ'
-- Обещание из шапки 0019 дословно: «файл ../hack.pdf даст null, а null
-- не совпадёт ни с одним арендатором, то есть доступ будет закрыт,
-- а не свалится с ошибкой».
select public.storage_tenant('aaaaaaaa-0000-0000-0000-000000000001/media/palto.jpg')
         = 'aaaaaaaa-0000-0000-0000-000000000001'                as свій_шлях_ожид_t,
       public.storage_tenant('../hack.pdf')            is null   as вихід_вгору_ожид_t,
       public.storage_tenant('media/hack.pdf')         is null   as без_орендаря_ожид_t,
       public.storage_tenant('')                       is null   as порожній_ожид_t,
       public.storage_tenant('aaaaaaaa-0000-0000-0000-00000000000/x') is null as недоuuid_ожид_t,
       public.storage_tenant('AAAAAAAA-0000-0000-0000-000000000001/x')
         = 'aaaaaaaa-0000-0000-0000-000000000001'                as регістр_ожид_t;

-- ─────────────────────────────────────────────────────────────────────────
-- media: читают все, пишет только команда магазина
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0019: владелец кладёт картинку в свой путь'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
insert into storage.objects (bucket_id, name, owner)
values ('media','aaaaaaaa-0000-0000-0000-000000000001/offerings/palto.jpg',
        '11111111-1111-1111-1111-111111111111');
select count(*) as своя_картинка_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/offerings/palto.jpg';

\echo '--- 0019: владелец НЕ кладёт картинку в путь чужого заклада'
-- «Магазин 2» (…0091) не имеет ни одного участника: чужой по-настоящему.
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000091/offerings/chuzhe.jpg');
  raise exception 'ПРОВАЛ: файл записано в шлях чужого закладу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0019: путь без арендатора не проходит вовсе'
do $$
begin
  insert into storage.objects (bucket_id, name) values ('media','hack.jpg');
  raise exception 'ПРОВАЛ: файл без орендаря у шляху записано';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

\echo '--- 0019: свой файл нельзя ПЕРЕНЕСТИ в чужой заклад'
-- Отдельная проверка: у update две половины, using и with check.
-- Забытый with check выглядит как рабочая политика ровно до этой строки.
do $$
begin
  update storage.objects
     set name = 'aaaaaaaa-0000-0000-0000-000000000091/offerings/palto.jpg'
   where name = 'aaaaaaaa-0000-0000-0000-000000000001/offerings/palto.jpg';
  raise exception 'ПРОВАЛ: файл перенесено в чужий заклад';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0019: без catalog.write картинку не положишь'
-- Инспектор (0015) в закладе есть, но каталог не его дело.
\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;
do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('media','aaaaaaaa-0000-0000-0000-000000000001/offerings/ot-inspektora.jpg');
  raise exception 'ПРОВАЛ: інспектор поклав картинку в каталог';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

\echo '--- 0019: media публичный — аноним картинку видит'
-- Это осознанная плата, записанная в шапке 0019: фото раздаётся с CDN
-- без подписи. Проверка стоит затем, чтобы «починка» приватности media
-- не прошла молча — она сломает отрисовку каталога.
set role anon;
select count(*) as картинка_анониму_ожид_1 from storage.objects
 where bucket_id = 'media'
   and name = 'aaaaaaaa-0000-0000-0000-000000000001/offerings/palto.jpg';
reset role;

-- ─────────────────────────────────────────────────────────────────────────
-- documents: сертификаты и MSDS. Наружу не отдаётся никогда.
-- ─────────────────────────────────────────────────────────────────────────

\echo '--- 0019: владелец кладёт сертификат в свой путь, и в чужой — нет'
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
insert into storage.objects (bucket_id, name, owner)
values ('documents','aaaaaaaa-0000-0000-0000-000000000001/docs/sertyfikat.pdf',
        '11111111-1111-1111-1111-111111111111');

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('documents','aaaaaaaa-0000-0000-0000-000000000091/docs/chuzhyj.pdf');
  raise exception 'ПРОВАЛ: сертифікат записано в шлях чужого закладу';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;
reset role;

-- Кладём чужой документ от имени системы (auth.uid() пуст — миграционный
-- путь, политики к нему не применяются): без него нечего пытаться украсть.
insert into storage.objects (bucket_id, name)
values ('documents','aaaaaaaa-0000-0000-0000-000000000091/docs/chuzhyj.pdf');

\echo '--- 0019: аноним не видит приватный бакет ВООБЩЕ'
set role anon;
select count(*) as документів_анониму_ожид_0 from storage.objects
 where bucket_id = 'documents';
reset role;

\echo '--- 0019: путь чужого арендатора не читается'
-- Главная проверка набора. У владельца «Магазин 1» полные права
-- в СВОЁМ закладе — и ни одного в чужом. Строка чужого документа
-- в реестре есть, но её не должно быть видно.
\set QUIET on
select test.login('11111111-1111-1111-1111-111111111111');
\set QUIET off
set role authenticated;
select count(*) as чужий_документ_ожид_0 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000091/docs/chuzhyj.pdf';
select count(*) as свій_документ_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/docs/sertyfikat.pdf';

\echo '--- 0019: чужой документ нельзя и стереть'
-- DELETE под RLS не падает, а молча ничего не находит — поэтому
-- проверяется не исключение, а то, что строка на месте.
delete from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000091/docs/chuzhyj.pdf';
reset role;
select count(*) as чужий_документ_на_місці_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000091/docs/chuzhyj.pdf';

\echo '--- 0019: инспектор скачивает сертификат, но не подменяет его'
-- Это дословное требование раздела «Inspector View» в ТЗ салона:
-- compliance.read даёт скачать, compliance.write у инспектора нет.
\set QUIET on
select test.login('44444444-4444-4444-4444-444444444444');
\set QUIET off
set role authenticated;
select count(*) as інспектор_бачить_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/docs/sertyfikat.pdf';

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('documents','aaaaaaaa-0000-0000-0000-000000000001/docs/pidrobka.pdf');
  raise exception 'ПРОВАЛ: інспектор завантажив свій документ';
exception when others then
  if sqlerrm like 'ПРОВАЛ%' then raise; end if;
  raise notice 'ok — %', sqlerrm;
end $$;

delete from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/docs/sertyfikat.pdf';
reset role;
select count(*) as сертифікат_після_інспектора_ожид_1 from storage.objects
 where name = 'aaaaaaaa-0000-0000-0000-000000000001/docs/sertyfikat.pdf';

\echo '--- 0019: посторонний из другого заклада не видит ни байта'
\set QUIET on
select test.login('33333333-3333-3333-3333-333333333333');
\set QUIET off
set role authenticated;
select count(*) as документів_чужаку_ожид_0 from storage.objects
 where bucket_id = 'documents';
reset role;

-- ─────────────────────────────────────────────────────────────────────────
-- 0088: что бакеты вообще принимают
-- ─────────────────────────────────────────────────────────────────────────
--
-- `allowed_mime_types` — единственное, что отделяет публичный CDN проекта
-- от чужого скрипта на его домене. Проверяется СПИСКОМ ЦЕЛИКОМ, а не
-- «нет ли svg»: список, сверяемый по одному значению, тихо расползается
-- при следующей правке, и появление там `text/html` никто не заметит.
-- Эталон — `MEDIA_EXT_BY_MIME` и `DOC_EXT_BY_MIME` из `lib/upload/guard.ts`,
-- то есть ровно то, что грузят экраны.

\echo '--- 0088: media не принимает svg и вообще ничего исполняемого'
do $$
declare v_types text[]; v_bad text;
begin
  select allowed_mime_types into v_types from storage.buckets where id = 'media';

  if 'image/svg+xml' = any(v_types) then
    raise exception 'ПРОВАЛ: svg повернувся у публічний бакет media — це збережена XSS на домені сховища';
  end if;

  select string_agg(t, ', ') into v_bad from (
    select unnest(v_types) as t
    except select unnest(array['image/jpeg','image/png','image/webp','image/avif','image/gif'])) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: media приймає зайве — %. Жоден екран цього не вантажить', v_bad;
  end if;

  select string_agg(t, ', ') into v_bad from (
    select unnest(array['image/jpeg','image/png','image/webp','image/avif','image/gif']) as t
    except select unnest(v_types)) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: media перестав приймати те, що вантажить форма фото — %', v_bad;
  end if;

  raise notice 'ok — media приймає рівно пʼять растрових типів';
end $$;

\echo '--- 0088: documents принимает ровно то, что грузят оба экрана документов'
do $$
declare v_types text[]; v_bad text;
  v_ok text[] := array['application/pdf','image/jpeg','image/png','image/webp',
                       'application/msword',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
begin
  select allowed_mime_types into v_types from storage.buckets where id = 'documents';

  if 'image/svg+xml' = any(v_types) or 'text/html' = any(v_types) then
    raise exception 'ПРОВАЛ: у documents зʼявився тип зі скриптами';
  end if;

  select string_agg(t, ', ') into v_bad from (
    select unnest(v_types) as t except select unnest(v_ok)) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: documents приймає зайве — %', v_bad;
  end if;

  select string_agg(t, ', ') into v_bad from (
    select unnest(v_ok) as t except select unnest(v_types)) q;
  if v_bad is not null then
    raise exception 'ПРОВАЛ: documents перестав приймати потрібне — %', v_bad;
  end if;

  raise notice 'ok — documents приймає рівно шість типів, жодного зі скриптами';
end $$;

\echo '--- 0088: media лишился svg, но остался публичным и с тем же лимитом'
-- Сужение типов не должно было побочно поменять ни публичность, ни размер:
-- первое сломало бы раздачу фото каталога, второе — загрузку крупных фото.
select id as бакет, public as публічний, file_size_limit as ліміт
  from storage.buckets order by id;
