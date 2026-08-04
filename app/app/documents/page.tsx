import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { DocumentsClient, type DocKind } from './documents-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Документи на матеріали' }

// Документальный блок Техрегламента №65: MSDS, сертификаты качества,
// заключения СЭС. Отдельного пункта меню нет — экран открывается ссылкой
// со склада и из журналов, поэтому подсветка остаётся на журналах.
export default async function DocumentsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Материалы и документы тянем отдельно, а не вложенным select:
  // материал без документов — главный сигнал этого экрана, и он обязан
  // попасть в список, а не выпасть из соединения.
  const [{ data: materials, error: materialsError }, { data: docs, error: docsError }] =
    await Promise.all([
      supabase.from('materials')
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
    <AppShell modules={m.modules} active="/app/journals" title="Документи на матеріали">
      <DocumentsClient
        tenantId={m.tenantId}
        userId={user!.id}
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
