-- 0063. Вернуть security_barrier, потерянный при пересоздании в 0060.
--
-- У compliance_containers барьер стоял с самого начала: без него
-- планировщик вправе протолкнуть чужую функцию в условие ДО фильтра
-- по арендатору, и она увидит строки соседа. У compliance_materials
-- и compliance_batches после drop/create опция обнулилась.
-- Ставится всем трём, чтобы поведение не зависело от того, какое
-- представление когда переписывали.

alter view public.compliance_materials  set (security_barrier = true);
alter view public.compliance_batches    set (security_barrier = true);
alter view public.compliance_containers set (security_barrier = true);
