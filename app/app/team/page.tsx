import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { TeamClient } from './team-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('team.meta.title') }
}

// Экран команды. Ролей и функций под него было шесть штук с 0050 по 0079,
// а входа к ним не существовало ни одного: приглашение сотрудника
// оформлялось «напишите мне, я заведу руками».
//
// `team_overview` с 0082 отдаёт ДВА разных состояния блокировки раздельно
// (`blocked_at` — нет доступа, `staff_blocked_at` — не работает) плюс
// `staff_is_active`. Колонки здесь не перечисляются намеренно: функция
// возвращает готовую таблицу, и список полей живёт в одном месте —
// в её объявлении. Разбирает их TeamClient.
//
// Всё читается ЗДЕСЬ, на сервере, и уходит вниз готовым. Причина не
// в моде на серверные компоненты: `team_overview` и `team_sessions` —
// SECURITY DEFINER, они отдают почту и адреса сеансов, и их результат
// не должен лежать в клиентском кэше дольше одного отрисовывания.
export default async function TeamPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'team.read')) redirect('/app')

  const supabase = await createClient()

  const [{ data: members }, { data: invites }, { data: sessions },
         { data: templates }, { data: grants }, { data: caps }, { data: auth },
         { data: audit }, { data: security }, { data: access }] =
    await Promise.all([
      supabase.rpc('team_overview', { p_tenant_id: m.tenantId }),
      supabase.from('invitations')
        .select('id, email, role, status, created_at, expires_at, access_days')
        .eq('tenant_id', m.tenantId).eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.rpc('team_sessions', { p_tenant_id: m.tenantId }),
      supabase.from('permission_templates')
        .select('id, name, role, permissions, cap_pct')
        .eq('tenant_id', m.tenantId).order('name'),
      // Справочник прав: перечень берётся из role_grants, а не из списка
      // в коде. Право, заведённое миграцией, появляется на экране само —
      // иначе новый пункт доступа надо помнить продублировать здесь.
      supabase.from('role_grants').select('role, permission'),
      supabase.from('role_discount_caps').select('role, cap_pct'),
      // Свой id — из сеанса, а не из `auth.getUser()`: getUser идёт
      // в GoTrue по сети ради значения, которое уже лежит в токене
      // (`sub`), и его сбой стоил бы дорого — без id `self` не сработал
      // бы НИ ДЛЯ КОГО, и человек увидел бы на себе «заблокувати»
      // и «передати володіння». Разбор токена руками, как в
      // `lib/tenant.ts`, потребовал бы экспорта оттуда — этот файл
      // чужой, поэтому берём тот же id из сеанса, который тот же
      // `lib/tenant.ts` уже прочитал для членства.
      supabase.auth.getSession(),
      // Журнал прав. Пишется триггером с 0076, читается политикой —
      // но показать его было негде, и это ровно тот случай, когда
      // «данные есть» не значит «работает»: неизменяемая запись о том,
      // кто кому что выдал, стоит ноль, пока её никто не видит.
      supabase.rpc('permission_audit_log', { p_tenant_id: m.tenantId, p_limit: 200 }),
      // Журнал безопасности (0085). Тот же случай, что и с журналом прав:
      // база пишет в него с 17.08.2026, а показать было негде. Читается
      // ЗДЕСЬ, на сервере, по той же причине, что и остальное на этом
      // экране: `security_log` — SECURITY DEFINER, она отдаёт почты, адреса
      // и отпечатки устройств, и её результат не должен лежать в клиентском
      // кэше дольше одного отрисовывания. Право — `team.read`, проверено
      // и здесь (выше), и собственным WHERE самой функции.
      supabase.rpc('security_log', { p_tenant_id: m.tenantId, p_limit: 200 }),
      // Журнал доступа к данным (0090). Третий журнал этого экрана: кто
      // открывал карточки, выгружал списки и скачивал документы. Читается
      // ПРЕДСТАВЛЕНИЕ, а не функция, и фильтр по арендатору здесь — не
      // защита, а сужение: представление и без него отдаёт владельцу
      // только свои заклады, а сотруднику только его собственные строки.
      supabase.from('data_access_log')
        .select('id, at, actor_id, actor_email, action, entity, entity_id, label')
        .eq('tenant_id', m.tenantId)
        .order('at', { ascending: false })
        .limit(200),
    ])

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <TeamClient
        tenantId={m.tenantId}
        myUserId={auth?.session?.user?.id ?? null}
        myRole={m.role}
        // Набір модулів закладу. Потрібен рівно для одного: сховати
        // при запрошенні ролі, вся суть яких — у вимкненому модулі
        // (розбір у `team-client.tsx`, `assignableRoles`).
        modules={m.modules}
        canWrite={can(m, 'team.write')}
        members={members ?? []}
        invites={invites ?? []}
        sessions={sessions ?? []}
        templates={templates ?? []}
        grants={grants ?? []}
        caps={caps ?? []}
        audit={audit ?? []}
        security={security ?? []}
        access={access ?? []}
      />
    </AppShell>
  )
}
