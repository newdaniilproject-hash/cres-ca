-- 0038 — дезинфекция не попадала в единый журнал событий.
--
-- ЧТО БЫЛО. ТЗ: «всі дії (відкриття банки, проходження дезінфекції, зміна
-- даних) зберігаються у незмінюваному журналі подій (Audit Log)».
-- Триггер audit_row висел на 16 таблицах — materials, material_containers,
-- material_batches, material_documents, tech_cards, cleaning_tasks, suppliers,
-- offerings и так далее. Из перечисленного в ТЗ покрыто было ровно два пункта:
-- вскрытие банки (material_containers) и изменение данных.
-- ТРЕТЬЕГО — прохождения дезинфекции — не было: на cleaning_entries,
-- sanitation_solutions и sterilization_cycles триггера аудита НЕТ.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ. Сами журналы неизменяемы (journal_guard плюс отсутствие
-- политик update/delete), и на первый взгляд аудит им не нужен. Но ТЗ требует
-- ЕДИНЫЙ журнал событий: проверяющий и владелец смотрят одну ленту «что
-- происходило в заведении», а не три таблицы по отдельности, каждую своим
-- запросом. Уборка, приготовление дезраствора и цикл стерилизации в этой ленте
-- не появлялись вообще — как будто в салоне их не делают.
-- Показательно: audit_row УЖЕ умеет подписывать эти строки — в списке полей
-- для label стоят 'agent_name' и 'device', а такие колонки есть ровно
-- у sanitation_solutions и sterilization_cycles. Триггер писали с расчётом
-- на эти таблицы и забыли навесить.
--
-- ЧЕМ ГРОЗИЛО. Сводка «что делалось по санитарии за период» — половина
-- ценности продукта для проверки. Собрать её из одного audit_log было нельзя.
--
-- ЧТО СТАЛО. Триггер навешен на все три журнала. Ветки update/delete в
-- определении оставлены не для красоты: если однажды journal_guard обойдут
-- через app.purging_account (удаление аккаунта), это тоже попадёт в аудит.
--
-- ПРОВЕРЕНО ИСПОЛНЕНИЕМ (в транзакции с откатом):
--   • запись уборки под ролью с compliance.write → в audit_log 1 строка
--     entity='cleaning_entries';
--   • дезраствор → 1 строка, label='Тест-розчин' (подхватился agent_name);
--   • цикл стерилизации → 1 строка, label='Сухожар тест' (подхватился device);
--   • update и delete этой же записи под authenticated → затронуто 0 строк
--     (RLS: политик на изменение у журналов нет), запись на месте;
--   • update и delete от владельца таблицы, где RLS не применяется, →
--     отказ journal_guard «запись санитарного журнала неизменяема».
--   То есть неизменяемость журналов не пострадала ни на одном из двух путей.

create trigger audit_cleaning_entries
  after insert or update or delete on public.cleaning_entries
  for each row execute function public.audit_row();

create trigger audit_sanitation_solutions
  after insert or update or delete on public.sanitation_solutions
  for each row execute function public.audit_row();

create trigger audit_sterilization_cycles
  after insert or update or delete on public.sterilization_cycles
  for each row execute function public.audit_row();

-- ЗАМЕЧАНИЕ. Уже существующие записи журналов (6 уборок, 3 раствора,
-- 3 цикла) задним числом в audit_log НЕ добавляются: аудит — это протокол
-- наблюдения, а не реконструкция. Дописать в него события, которых никто
-- не наблюдал, значит сделать журнал недостоверным целиком.
