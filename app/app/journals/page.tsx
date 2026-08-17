import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { JournalsClient } from './journals-client'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — такая же строка интерфейса, как и всё
// остальное, поэтому `generateMetadata`, а не константа. Здесь это ничего
// не стоит: страница и так `force-dynamic` (роль читается из токена),
// а кабинет закрыт в `app/robots.ts` целиком — поисковых последствий,
// из-за которых метаданные витрины сознательно не переведены
// (см. шапку `app/layout.tsx`), у него нет.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('journals.meta.title') }
}

export default async function JournalsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Все три журнала (`sanitation_solutions`, `cleaning_*`,
  // `sterilization_cycles`) читаются по `compliance.read` (0014) —
  // ровно то право, по которому пункт стоит в меню. Без него экран
  // показывал три пустых журнала, а не отказ. У accountant этого
  // права нет вовсе.
  if (!can(m, 'compliance.read')) redirect('/app')
  // Вторая ось доступа — модуль заведения. Меню прячет раздел, которого
  // нет в `modules`, а прямой адрес его открывал: экран отказа объясняет,
  // что это не про права человека (CLAUDE.md → «Доступ: роли и модули»).
  if (!hasModule(m, 'compliance')) return <ModuleOff m={m} module="compliance" />

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: solutions }, { data: tasks }, { data: entries }, { data: cycles },
         { data: actors }] =
    await Promise.all([
      supabase.from('sanitation_solutions')
        .select('id, agent_name, concentration, volume, unit, prepared_at, expires_at, prepared_by')
        .eq('tenant_id', m.tenantId).order('prepared_at', { ascending: false }).limit(30),
      supabase.from('cleaning_tasks')
        .select('id, name, schedule').eq('tenant_id', m.tenantId)
        .eq('is_active', true).order('position'),
      supabase.from('cleaning_entries')
        .select('task_id, performed_at, performed_by').eq('tenant_id', m.tenantId)
        .gte('performed_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      supabase.from('sterilization_cycles')
        .select('id, device, temperature_c, duration_minutes, indicator_ok, performed_at, performed_by')
        .eq('tenant_id', m.tenantId).order('performed_at', { ascending: false }).limit(30),
      // Имена исполнителей. Отдельным запросом, а не вложенной связью
      // `profiles(full_name)`: `profiles_self_read` (0001) отдаёт профиль
      // ТОЛЬКО про себя, и связь к закрытой таблице вернула бы null всем,
      // включая владельца, — молча. `compliance_actors` (0083) отдаёт имя
      // по тому же `compliance.read`, на котором стоит весь этот экран.
      supabase.from('compliance_actors')
        .select('user_id, full_name').eq('tenant_id', m.tenantId),
    ])

  // Имя исполнителя или null. Null здесь значит «имя не достаётся»,
  // а не «исполнителя нет»: `prepared_by` и `performed_by` объявлены
  // `not null`, а вот `compliance_actors` строится от `tenant_members`
  // и теряет имя того, кого вывели из состава команды (оговорка 0083).
  const nameOf = new Map((actors ?? []).map((a) => [a.user_id, a.full_name]))
  const who = (id: string | null) => (id ? nameOf.get(id) ?? null : null)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <JournalsClient
        tenantId={m.tenantId}
        userId={user!.id}
        // Отметка в журнале — это `compliance.journal.write` у мастера
        // (0039) или общий `compliance.write`. У инспектора и наблюдателя
        // нет ни того, ни другого: они журналы читают.
        canWrite={can(m, 'compliance.journal.write') || can(m, 'compliance.write')}
        canManage={can(m, 'compliance.write')}
        solutions={(solutions ?? []).map((s) => ({ ...s, performer: who(s.prepared_by) }))}
        // Параметр назван `task`, а не `t`: `t` в этом файле — переводчик.
        tasks={(tasks ?? []).map((task) => {
          // Отметка за сегодня — последняя по времени: чек-лист можно
          // отметить дважды (журнал неизменяем, встречной записи нет),
          // и подписывать пункт первым исполнителем было бы неверно.
          const done = (entries ?? [])
            .filter((e) => e.task_id === task.id)
            .sort((a, b) => (a.performed_at < b.performed_at ? 1 : -1))[0]
          return {
            ...task,
            doneToday: done != null,
            donePerformer: done ? who(done.performed_by) : null,
            doneAt: done?.performed_at ?? null,
          }
        })}
        cycles={(cycles ?? []).map((c) => ({ ...c, performer: who(c.performed_by) }))}
      />
    </AppShell>
  )
}
