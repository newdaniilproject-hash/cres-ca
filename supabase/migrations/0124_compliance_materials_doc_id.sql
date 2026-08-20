-- 0124. compliance_materials: не хватало колонки, экран документов
--       засоба отдавал 404 на КАЖДОМ засобе.
--
-- ── Как нашлось ──────────────────────────────────────────────────────────
--
-- Живой отчёт владельца 20.08.2026: «Документи і сертифікати» открывает
-- дефолтный next.js 404 у TRINITY_DREADS. Причина не в маршруте — файл
-- `app/app/inventory/materials/[id]/docs/page.tsx` существует и работает
-- с 0106 — а в запросе перед ним:
--
--   supabase.from('compliance_materials').select(`… notification_doc_id …`)
--
-- 0106 добавила `notification_doc_id` в таблицу `materials` и в SELECT
-- страницы в ОДНОМ коммите, но не добавила её в `create or replace view
-- compliance_materials` — а страница читает представление, не таблицу.
-- Запрос неизвестной колонки PostgREST отдавал ошибкой, `material`
-- оставался `undefined`, и код бил `notFound()` — то есть падение запроса
-- маскировалось под «сторінки не існує». Дыра жила с 0106 (17.08.2026)
-- на каждом заведении, у которого есть модуль compliance, и открылась
-- только на первом реальном клиенте, потому что раньше экран проверяли
-- на сидах с уже заполненной базой другим путём.
--
-- ЧЕМУ ЭТО УЧИТ. Правило проекта «create or replace стирает тело
-- целиком, переноси всё руками» касается не только функций — обычных
-- представлений тоже: колонка, добавленная в таблицу, сама по себе
-- в представление не попадает.

create or replace view public.compliance_materials as
select m.id, m.tenant_id, m.name, m.unit, m.category, m.brand, m.country_of_origin,
       m.inci, m.notification_code, m.notification_url, m.notification_date,
       m.pao_months, m.is_cosmetic, m.sku,
       m.is_active, m.created_at, m.updated_at,
       m.notification_confirmed_at,
       (m.is_cosmetic and m.notification_confirmed_at is not null) as notification_ok,
       m.image_path,
       -- Ровно то, чего не хватало: страница сверяет по нему, какой
       -- из загруженных документов — доказательство нотификации (0106).
       m.notification_doc_id
  from public.materials m
 where m.tenant_id in (select public.tenants_with('compliance.read'));

alter view public.compliance_materials set (security_barrier = true);

revoke all on public.compliance_materials from public;
revoke all on public.compliance_materials from anon;
revoke all on public.compliance_materials from authenticated;
grant select on public.compliance_materials to authenticated;
grant select on public.compliance_materials to service_role;
