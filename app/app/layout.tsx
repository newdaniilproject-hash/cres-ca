import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { getLang } from '@/lib/i18n/server'
import { LangProvider } from '@/lib/i18n/client'

export const dynamic = 'force-dynamic'

// Оболочка кабинета — здесь и только здесь.
//
// Раньше её рисовала каждая страница, и при переходе Next подставлял
// `loading.tsx` сегмента, который рисовал ВТОРУЮ оболочку: две нижние
// панели друг на друге и скелетон дашборда под заголовком «Профіль».
// Владелец увидел это первым же нажатием.
//
// Теперь панель, шапка и заголовок живут в layout, а страницы отдают
// только содержимое. Скелетоны загрузки рисуют содержимое и ничего
// больше — накладываться нечему.
//
// ЯЗЫК КАБИНЕТА тоже входит сюда, и по той же причине: он один на все
// двадцать шесть экранов. Кука читается один раз на кабинет, а не на
// странице (layout не перерисовывается при переходах внутри сегмента),
// и раздаётся вниз контекстом — клиентские экраны берут его хуком
// `useT()`, серверные могут звать `getT()` сами. Отдельного запроса
// и отдельного состояния это не стоит.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  // Имя заведения — заголовок экрана «Сьогодні». Один запрос на кабинет,
  // а не на каждую страницу: layout не перерисовывается при переходах
  // внутри сегмента.
  // `slug` берётся тем же запросом, что и имя: на столе под аватаром
  // висит ссылка «Профіль магазину» на публичную страницу заклада,
  // и второй поход в базу ради одной колонки не нужен.
  const supabase = await createClient()
  const { data: tenant } = await supabase
    .from('tenants').select('name, slug').eq('id', m.tenantId).maybeSingle()

  const lang = await getLang()

  return (
    <LangProvider lang={lang}>
      {/* Роль приезжает из токена вместе с членством (правило 3) —
          отдельного запроса она не стоит. В шапке она вторая строка
          под именем заклада: человек, у которого два заведения
          с разными ролями, иначе не видит, что ему здесь можно. */}
      <AppShell
        modules={m.modules}
        perms={m.perms}
        shopName={tenant?.name ?? ''}
        shopSlug={tenant?.slug ?? ''}
        role={m.role}
      >
        {children}
      </AppShell>
    </LangProvider>
  )
}
