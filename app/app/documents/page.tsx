import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { DocumentsClient, type DocKind } from './documents-client'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('documents.meta.title') }
}

// Документальный блок Техрегламента №65: MSDS, сертификаты качества,
// заключения СЭС. Пункт «Документи» стоит в меню под `compliance.read`,
// и подсветка держится на журналах — это одна связка экранов.
//
// Для роли `inspector` это ГЛАВНЫЙ экран: раздел «Склад» ему закрыт
// (0035), поэтому реестр засобів он видит здесь, и отсюда же уходит
// в карточку конкретного засоба.
export default async function DocumentsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `material_documents_read` (0014) — на `compliance.read`, и по нему же
  // пункт «Документи» стоит в меню. Проверяем ровно это право и ничего
  // сверх: добавить сюда ещё и `stock.read` значило бы показать пункт
  // inspector'у и тут же его развернуть — то есть завести ту же
  // сломанную навигацию с другой стороны.
  if (!can(m, 'compliance.read')) redirect('/app')
  if (!hasModule(m, 'compliance')) return <ModuleOff m={m} module="compliance" />

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Материалы и документы тянем отдельно, а не вложенным select:
  // материал без документов — главный сигнал этого экрана, и он обязан
  // попасть в список, а не выпасть из соединения.
  //
  // Список засобів — из `compliance_materials`, а не из `materials`:
  // сама таблица закрыта политикой на `stock.read` (0003), которого
  // у инспектора нет (0035). Экран показывал ему пустой реестр —
  // то есть «документів немає» вместо «засобів не видно».
  // Представление отдаёт строки всем, у кого есть `compliance.read`,
  // а это ровно те, кого сюда пускает проверка выше. Разбор решения —
  // в `app/app/inventory/materials/[id]/page.tsx`.
  const [{ data: materials, error: materialsError }, { data: docs, error: docsError }] =
    await Promise.all([
      supabase.from('compliance_materials')
        .select('id, name, unit, brand, is_cosmetic')
        .eq('tenant_id', m.tenantId)
        .eq('is_active', true)
        .order('name')
        .limit(300),
      supabase.from('material_documents')
        .select('id, material_id, kind, title, path, created_at')
        .eq('tenant_id', m.tenantId)
        .order('created_at', { ascending: false })
        .limit(500),
    ])

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <DocumentsClient
        tenantId={m.tenantId}
        userId={user!.id}
        canWrite={can(m, 'compliance.write')}
        canStock={can(m, 'stock.read')}
        loadError={materialsError?.message ?? docsError?.message ?? ''}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id,
          name: mt.name,
          unit: mt.unit,
          brand: mt.brand,
          isCosmetic: mt.is_cosmetic,
        }))}
        documents={(docs ?? []).map((d) => ({
          id: d.id,
          materialId: d.material_id,
          kind: d.kind as DocKind,
          title: d.title,
          path: d.path,
          createdAt: d.created_at,
        }))}
      />
    </AppShell>
  )
}
