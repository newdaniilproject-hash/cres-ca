-- 0036-fix — заплатка к 0035/0036: собственный дефект, найденный проверкой
-- исполнением сразу после применения. Пишется отдельной миграцией, а не правкой
-- предыдущих: применённые миграции не переписываются.
--
-- ЧТО БЫЛО. Правило 5 в этом проекте сформулировано про функции: «Postgres
-- выдаёт EXECUTE роли PUBLIC по умолчанию». Оказалось, что на Supabase этого
-- мало. Там настроены ALTER DEFAULT PRIVILEGES, которые раздают на КАЖДЫЙ новый
-- объект в public:
--   • таблицам и представлениям — ALL для anon И для authenticated;
--   • функциям — EXECUTE для anon.
-- Эти права выданы ролям поимённо, а не через PUBLIC, поэтому
-- `revoke all ... from public` их НЕ снимает. В 0035 и 0036 revoke был написан
-- именно так, и после него у ролей осталось:
--   compliance_materials  — authenticated=arwdDxtm (то есть ALL);
--   compliance_containers — authenticated=arwdDxtm;
--   decant_container, container_label — anon=X.
--
-- ПОЧЕМУ ЭТО ДЕФЕКТ, А НЕ КОСМЕТИКА. compliance_materials — представление над
-- одной таблицей без агрегатов, то есть АВТООБНОВЛЯЕМОЕ. Оно намеренно не
-- security_invoker (иначе инспектор не обошёл бы RLS materials при чтении),
-- а значит запись через него выполняется от владельца — postgres — и RLS
-- таблицы materials не применяется вообще.
-- Проверено попыткой под JWT инспектора, у которого нет ни одного права записи:
--   update public.compliance_materials set name = ... → ПРОШЛО, 1 строка;
--   insert into public.compliance_materials (...)      → ПРОШЛО.
-- То есть миграция, которая закрывала инспектору чтение коммерции, попутно
-- открыла ему запись в реестр материалов. Ровно тот случай, ради которого
-- заведено правило проверять поведение после каждой применённой миграции.
--
-- ЧТО СТАЛО. У обоих представлений отозваны все права у public, anon и
-- authenticated, после чего authenticated выдан только SELECT. У функций
-- 0036 отозван EXECUTE у anon — как у соседних record_stock_movement и
-- scan_container, где anon в списке нет. У container_counters отозвана запись:
-- номер ёмкости двигает только decant_container, RLS это уже запрещала,
-- теперь запрещают ещё и права.
--
-- ВНИМАНИЕ НА БУДУЩЕЕ. Любое следующее представление в public получит ALL
-- для anon и authenticated в момент создания. Если оно не security_invoker
-- и построено над одной таблицей — это дыра на запись, а не «лишняя строчка
-- в ACL». Отзывать надо поимённо: from public, anon, authenticated.

revoke all on public.compliance_materials  from public, anon, authenticated;
revoke all on public.compliance_containers from public, anon, authenticated;

grant select on public.compliance_materials  to authenticated;
grant select on public.compliance_containers to authenticated;

revoke execute on function public.decant_container(uuid, numeric, text) from anon;
revoke execute on function public.container_label(uuid) from anon;

revoke all on public.container_counters from public, anon;
revoke insert, update, delete, truncate on public.container_counters from authenticated;
