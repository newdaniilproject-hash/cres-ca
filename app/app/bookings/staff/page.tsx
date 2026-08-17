import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { StaffList } from './staff-list'
import { getT } from '@/lib/i18n/server'
import { parseRange, isNow } from './range'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.staff.title') }
}

// ── Мастера заведения ──────────────────────────────────────────────────────
//
// Экрана не было вовсе, а таблицы под него лежат с 0010. Из-за этого
// `staff.is_active` («у відпустці, записи не приймає») переключать было
// негде: экран команды это состояние ПОКАЗЫВАЛ и отсылал «в картку
// майстра — розділ «Записи», не тут», а карточки не существовало.
// Ссылка в никуда у первого платящего клиента — это и есть причина,
// по которой модуль делается сейчас.
//
// Живёт внутри раздела «Записи», а не отдельным пунктом панели, и это
// правило навигации, а не вкусовщина: снизу лежат только те четыре
// раздела, между которыми мастер прыгает за смену (CLAUDE.md →
// «Мобильная версия»). Расписание правят раз в месяц.
//
// ДВЕ ОСИ ДОСТУПА СТОЯТ ЗДЕСЬ, а не только в меню. Право `orders.read` —
// то же, что у записей: своего `bookings.*` в базе нет, политики 0010
// стоят на нём. Модуль `bookings` — отдельно: право есть у роли, модуль
// куплен заведением, и одно другим не заменяется.
export default async function StaffPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'orders.read')) redirect('/app')
  if (!hasModule(m, 'bookings')) return <ModuleOff m={m} module="bookings" />

  const supabase = await createClient()

  // Три запроса вместо одного с вложением: расписание и отпуска нужны
  // здесь ТОЛЬКО как признаки («розклад не заповнений», «у відпустці»),
  // а вложенный select притащил бы все строки обоих в каждую карточку.
  const [{ data: staff }, { data: hours }, { data: off }] = await Promise.all([
    supabase.from('staff')
      .select('id, name, title, is_active, blocked_at, timezone, user_id, position')
      .eq('tenant_id', m.tenantId)
      .order('position').order('name'),
    supabase.from('working_hours')
      .select('staff_id')
      .eq('tenant_id', m.tenantId),
    // Прошедшие отпуска на список не влияют, а строк с годами копится
    // много. Отсекаем прямо в базе — ПЕРЕСЕЧЕНИЕМ с «от сейчас и дальше»,
    // а не сравнением: сравнение диапазонов идёт по НИЖНЕЙ границе, и
    // отпуск, начавшийся вчера и идущий сегодня, выпал бы из выборки —
    // то есть ровно тот, ради которого экран и смотрят.
    supabase.from('time_off')
      .select('staff_id, period')
      .eq('tenant_id', m.tenantId)
      .overlaps('period', `[${new Date().toISOString()},)`),
  ])

  const withHours = new Set((hours ?? []).map((h) => h.staff_id as string))
  const onLeave = new Set(
    (off ?? [])
      .filter((o) => isNow(parseRange(o.period as unknown as string)))
      .map((o) => o.staff_id as string),
  )

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <StaffList
        tenantId={m.tenantId}
        canWrite={can(m, 'team.write')}
        staff={(staff ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title,
          isActive: s.is_active,
          blocked: s.blocked_at !== null,
          linked: s.user_id !== null,
          hasHours: withHours.has(s.id),
          onLeave: onLeave.has(s.id),
        }))}
      />
    </AppShell>
  )
}
