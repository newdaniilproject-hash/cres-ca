import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'

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
  const supabase = await createClient()
  const { data: tenant } = await supabase
    .from('tenants').select('name').eq('id', m.tenantId).maybeSingle()

  return (
    <AppShell modules={m.modules} shopName={tenant?.name ?? ''}>
      {children}
    </AppShell>
  )
}
