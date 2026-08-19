import { redirect } from 'next/navigation'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { TechCardsClient } from './techcards-client'
import { loadTechCards } from './data'

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
//
// Адрес остаётся, хотя с 19.08.2026 те же карты открываются вкладкой
// на экране «Послуги»: на него ведут закладки, ссылка с «Журналів»
// и пункт сайдбара веб-кабинета, а десктопный вид (карточка §6, визард
// §7) живёт только здесь. Второй вход — не замена первому.
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

  // Выборка — в `./data.ts`, потому что её зовёт ещё и вкладка «Техкарти»
  // экрана «Послуги». Скопированный запрос разъехался бы с этим на первой
  // же правке.
  const data = await loadTechCards(m)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <TechCardsClient {...data} />
    </AppShell>
  )
}
