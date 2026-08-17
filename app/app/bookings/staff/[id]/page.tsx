import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { StaffCard } from './staff-card'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.staffCard.title') }
}

// Карточка мастера. Собирает в одном месте всё, что решает, увидит ли
// покупатель этого человека в списке «на кого записатись»:
//
//   is_active       — принимает ли записи вообще (отпуск, больничный);
//   working_hours   — рабочая неделя. Пусто — слотов не будет ни одного;
//   time_off        — отпуска и перерывы: `available_slots` вычитает их;
//   staff_services  — какие услуги делает. ПУСТО ЗНАЧИТ «ВСЕ», и это
//                     не догадка, а поведение 0010: `not exists (...)
//                     or exists (...)`. Экран обязан сказать это словами,
//                     иначе пустой список читается как «нічого не робить».
//
// ПРАВА РАЗНЫЕ У РАЗНЫХ БЛОКОВ, и это не придирка: `staff` и
// `staff_services` закрыты `team.write` (0010/0013), а `working_hours`
// и `time_off` — `orders.write`. То есть администратор записей может
// вести расписание, но не переименовывать мастера. Обе проверки уходят
// вниз отдельными признаками, а не одним `canWrite`, — иначе экран
// показал бы кнопку, на которую база ответит отказом.
export default async function StaffCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'orders.read')) redirect('/app')
  if (!hasModule(m, 'bookings')) return <ModuleOff m={m} module="bookings" />

  const { id } = await params
  const supabase = await createClient()

  const { data: staff } = await supabase.from('staff')
    .select('id, name, title, bio, timezone, is_active, position, user_id, blocked_at, blocked_reason')
    .eq('tenant_id', m.tenantId).eq('id', id).maybeSingle()
  if (!staff) notFound()

  const [{ data: hours }, { data: off }, { data: mine }, { data: services }] =
    await Promise.all([
      supabase.from('working_hours')
        .select('id, weekday, starts_at, ends_at')
        .eq('tenant_id', m.tenantId).eq('staff_id', id)
        .order('weekday').order('starts_at'),
      // И идущие сейчас, и будущие. Прошедшие не показываем: список
      // отпусков за три года — это архив, а не рабочий экран.
      supabase.from('time_off')
        .select('id, kind, period, note')
        .eq('tenant_id', m.tenantId).eq('staff_id', id)
        .overlaps('period', `[${new Date().toISOString()},)`)
        .order('period'),
      supabase.from('staff_services')
        .select('offering_id')
        .eq('tenant_id', m.tenantId).eq('staff_id', id),
      // Услуги заведения. Товары сюда не попадают: записываются
      // на услугу, у товара нет длительности.
      supabase.from('offerings')
        .select('id, title')
        .eq('tenant_id', m.tenantId).eq('kind', 'service')
        .order('title'),
    ])

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <StaffCard
        tenantId={m.tenantId}
        canEditCard={can(m, 'team.write')}
        canSchedule={can(m, 'orders.write')}
        staff={{
          id: staff.id,
          name: staff.name,
          title: staff.title,
          bio: staff.bio,
          timezone: staff.timezone,
          isActive: staff.is_active,
          linked: staff.user_id !== null,
          blockedAt: staff.blocked_at,
          blockedReason: staff.blocked_reason,
        }}
        hours={(hours ?? []).map((h) => ({
          id: h.id, weekday: h.weekday,
          // Postgres отдаёт время как `09:00:00`; полю `type="time"`
          // нужны часы и минуты, секунды оно молча выбрасывает не везде.
          from: String(h.starts_at).slice(0, 5),
          to: String(h.ends_at).slice(0, 5),
        }))}
        off={(off ?? []).map((o) => ({
          id: o.id, kind: o.kind, note: o.note,
          period: o.period as unknown as string,
        }))}
        services={(services ?? []).map((s) => ({ id: s.id, title: s.title }))}
        mine={(mine ?? []).map((s) => s.offering_id as string)}
      />
    </AppShell>
  )
}
