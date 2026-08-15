-- 0053 — журнал изменения прав: «кто, когда, кому, что изменил».
--
-- ПРОВЕРЕНО ПЕРЕД ТЕМ, КАК ЧТО-ЛИБО ДЕЛАТЬ. Триггер audit_row уже висит на
-- tenant_members (0021) и с 0050 — на invitations. Снял реальную запись после
-- смены роли и персональных прав мастера владельцем:
--   кто    = daniilpadalko97@gmail.com (actor_email, берётся из profiles)
--   когда  = at
--   кому   = entity_id, это user_id участника (audit_row подставляет user_id,
--            если у строки нет собственного id — как раз случай tenant_members)
--   что    = changes = {"role":{"was":"operator","now":"viewer"},
--                       "permissions":{"was":{},"now":{"stock.read":"true",
--                                                      "finances.read":"false"}}}
-- Правка и удаление журнала отбиваются охранником audit_log_guard: «журнал дій
-- не редагується і не видаляється» — проверено попыткой UPDATE и DELETE.
--
-- ВЫВОД: требование плана закрыто уже существующим механизмом. ОТДЕЛЬНУЮ ТАБЛИЦУ
-- НЕ ЗАВОДИМ — это была бы вторая правда о том же событии.
--
-- ЧТО ВСЁ-ТАКИ ДОБАВЛЯЕМ, И ЗАЧЕМ. Две дырки в удобстве, не в данных:
--   1. Чтение audit_log закрыто политикой audit_log_read, а она требует
--      compliance.read И stock.read. Управление доступом — это team.read, и у
--      человека с team.read (например manager) может не быть compliance.read.
--      Экрана «кто кому что выдал» он не увидит вовсе.
--   2. В строке журнала «кому» — голый uuid: audit_row не заполняет label для
--      tenant_members (там нет ни name, ни title). Читать невозможно.
-- Представление public.team_access_log: те же строки журнала, отфильтрованные по
-- team.read, с подставленной почтой участника и с вырезанным token_hash из
-- событий по приглашениям. Ничего не пишет, ничего не меняет — только читает.
-- Сделано ровно по образцу представлений compliance_* (0014/0036): владелец
-- postgres, security_barrier, явный фильтр через tenants_with.
-- ПРОВЕРЕНО: владелец видит 4 события, viewer без team.read — 0, token_hash
-- в выдаче не встречается.
--
-- НЕ ТРОГАЕМ: audit_log, audit_row, audit_log_guard, compliance_* — ни строкой.

create view public.team_access_log with (security_barrier=true) as
select a.id, a.tenant_id, a.at, a.actor_id, a.actor_email, a.action,
       a.entity as subject_kind, a.entity_id as subject_id,
       coalesce(p.email::text, a.label) as subject_email,
       case when a.entity = 'invitations' then
              case when a.changes ? 'created'
                   then jsonb_set(a.changes, '{created}', (a.changes -> 'created') - 'token_hash')
                   when a.changes ? 'deleted'
                   then jsonb_set(a.changes, '{deleted}', (a.changes -> 'deleted') - 'token_hash')
                   else a.changes - 'token_hash' end
            else a.changes end as changes
  from public.audit_log a
  left join public.profiles p on p.id = a.entity_id
 where a.tenant_id in (select public.tenants_with('team.read'))
   and (a.entity in ('tenant_members','invitations')
        or (a.entity = 'staff' and (a.changes ? 'blocked_at' or a.changes ? 'created' or a.changes ? 'deleted')));

comment on view public.team_access_log is
  'Кто, когда, кому и что изменил в доступах. Срез audit_log по team.read; сам журнал неизменяем.';

grant select on public.team_access_log to authenticated;
