import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { MaterialDocs } from './material-docs'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Документи та сертифікати' }

// Экран 3 макета и документальный блок ТЗ 3.1.
//
// Общий экран /app/documents показывает все документы заведения списком
// по засобам — он для загрузки пачкой. Этот показывает документы ОДНОГО
// засоба и статус его нотификации: так на него смотрит инспектор, когда
// взял в руки конкретную банку.
export default async function MaterialDocsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const { id } = await params
  const supabase = await createClient()

  const { data: material } = await supabase
    .from('materials')
    .select(`id, name, brand, is_cosmetic,
             notification_code, notification_url, notification_date`)
    .eq('id', id).eq('tenant_id', m.tenantId).maybeSingle()

  if (!material) notFound()

  const { data: docs, error } = await supabase
    .from('material_documents')
    .select('id, kind, title, path, size_bytes, mime, created_at')
    .eq('tenant_id', m.tenantId).eq('material_id', id)
    .order('created_at', { ascending: false }).limit(200)

  const { data: { user } } = await supabase.auth.getUser()

  return (
    <AppShell active="/app/inventory" title="Документи"
              back={`/app/inventory/materials/${id}`} modules={m.modules}>
      <MaterialDocs
        tenantId={m.tenantId}
        userId={user!.id}
        canWrite={can(m, 'compliance.write')}
        material={{
          id: material.id, name: material.name, brand: material.brand,
          isCosmetic: material.is_cosmetic,
          notificationCode: material.notification_code,
          notificationUrl: material.notification_url,
          notificationDate: material.notification_date,
        }}
        docs={(docs ?? []).map((d) => ({
          id: d.id, kind: d.kind, title: d.title, path: d.path,
          size: d.size_bytes != null ? Number(d.size_bytes) : null,
          mime: d.mime, createdAt: d.created_at,
        }))}
        loadError={error?.message ?? ''}
      />
    </AppShell>
  )
}
