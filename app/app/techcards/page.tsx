import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { TechCardsClient } from './techcards-client'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('techcards.meta.title') }
}

// Технологические карты (ТЗ 3.4). Пункт «Техкарти» стоит в меню под
// `compliance.read`; подсветка держится на журналах — это одна связка
// экранов санитарного учёта.
export default async function TechCardsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `tech_cards_read` (0014) — на `compliance.read`, как и пункт меню.
  // Названия услуг для ЧТЕНИЯ карт приходят из `compliance_offerings`
  // (0083) по тому же праву. Список услуг для ПРИВЯЗКИ остаётся
  // на `offerings` под `catalog.read`, которого у inspector нет (0035),
  // и это осознанно: карты он читает, привязывать ему нечего.
  if (!can(m, 'compliance.read')) redirect('/app')
  if (!hasModule(m, 'compliance')) return <ModuleOff m={m} module="compliance" />

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Привязывать карту к услуге можно только с `catalog.read`: список для
  // выпадающего списка читается из самой `offerings`. У инспектора этого
  // права нет (0035) — и запрос ему не уходит вовсе, чтобы не изображать
  // «список услуг пуст» там, где на деле «вам его не показывают».
  const canLink = can(m, 'catalog.read')

  // Карт мало по природе (регламент салона — это единицы документов),
  // поэтому забираем сразу все версии и группируем на клиенте:
  // без этого нельзя показать историю, а история здесь и есть смысл таблицы.
  const [{ data: cards, error: cardsError }, { data: titles }, services] =
    await Promise.all([
      supabase.from('tech_cards')
        .select('id, title, version, steps, is_active, offering_id, created_at')
        .eq('tenant_id', m.tenantId)
        .order('title')
        .order('version', { ascending: false })
        .limit(300),
      // Название услуги — ОТДЕЛЬНЫМ запросом к компланс-проекции, а не
      // вложенной связью `offerings(title)`. Связь к таблице, закрытой
      // чужим правом, возвращает `null`, а не отказ: у инспектора техкарта
      // приезжала без названия услуги, к которой относится, — документ
      // из ТЗ 3.4 без половины смысла и без единой ошибки на экране.
      // `compliance_offerings` (0083) отдаёт три колонки по `compliance.read`
      // и ничего из коммерции.
      supabase.from('compliance_offerings')
        .select('id, title')
        .eq('tenant_id', m.tenantId)
        .limit(500),
      canLink
        ? supabase.from('offerings')
            .select('id, title')
            .eq('tenant_id', m.tenantId)
            .eq('kind', 'service')
            .order('title')
            .limit(200)
        : null,
    ])

  const titleOf = new Map((titles ?? []).map((o) => [o.id, o.title]))

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <TechCardsClient
        tenantId={m.tenantId}
        userId={user!.id}
        // Выпуск версии — `compliance.write` (`tech_cards_write`, 0014).
        // Мастер с одним `compliance.journal.write` (0039) сюда не входит:
        // регламент утверждает заведение, а не смена. Инспектор — тем более.
        canWrite={can(m, 'compliance.write')}
        loadError={cardsError?.message ?? ''}
        cards={(cards ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          version: c.version,
          steps: c.steps,
          isActive: c.is_active,
          offeringId: c.offering_id,
          offeringTitle: c.offering_id ? titleOf.get(c.offering_id) ?? null : null,
          createdAt: c.created_at,
        }))}
        services={(services?.data ?? []).map((s) => ({ id: s.id, title: s.title }))}
      />
    </AppShell>
  )
}
