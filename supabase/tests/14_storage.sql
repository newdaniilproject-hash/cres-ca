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
