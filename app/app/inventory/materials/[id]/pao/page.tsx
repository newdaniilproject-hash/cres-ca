import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { PaoControl } from './pao-control'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.materialPao.title') }
}

// Экраны 4 и 5 макета, пункт ТЗ 3.2 целиком:
// учёт PAO, кнопка «Відкрити банку», розлив в дозатор с генерацией
// внутреннего кода и наклейкой из пяти реквизитов.
export default async function PaoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Экран целиком компланс-овый: PAO, вскрытия, розливы — это
  // Техрегламент, а не склад. Одно право — `compliance.read`.
  //
  // Требование `stock.read` здесь было лишним и вредным: оно закрывало
  // экран инспектору (после 0035 у него только `compliance.read`), хотя
  // ёмкости политика `material_containers_read` (0014) отдаёт как раз
  // по компланс-праву. Засіб и партии теперь читаются из представлений
  // (развёрнутое объяснение — `app/app/inventory/materials/[id]/page.tsx`).
  //
  // Право на САМО открытие банки отдельное и проверяется ниже
  // (`canOpen`): смотреть журнал розливов и вскрывать банку — разные
  // вещи, и роль, которая только смотрит, здесь законна.
  if (!can(m, 'compliance.read')) redirect('/app')
  // PAO и розлив — склад, а не соответствие: ёмкости перечислены
  // в модуле `inventory` (0020, 0064), хотя право на экране — compliance.
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const { id } = await params
  const supabase = await createClient()

  const { data: material } = await supabase
    .from('compliance_materials')
    .select('id, name, unit, pao_months, is_cosmetic')
    .eq('id', id).eq('tenant_id', m.tenantId).maybeSingle()

  if (!material) notFound()

  // Ёмкости берём ВСЕ, включая закрытые и списанные: история розливов
  // не должна исчезать от того, что дозатор закончился. Журнал — это
  // доказательство, а не текущий остаток.
  const [{ data: containers, error }, { data: batches }] = await Promise.all([
    // Ёмкости — через `compliance_containers`, а не из таблицы напрямую.
    // Прямое чтение работало ровно потому, что политика
    // `material_containers_read` (0014) стоит на `compliance.read`, — то
    // есть держалось на чужом решении, которое однажды поменяют, как
    // поменяли партиям в 0043. В тот день экран встретил бы инспектора
    // не отказом, а пустым журналом розливов. Собственный PAO разлива
    // (`pao_months`) в представлении с 0083 — последнее, чего ему
    // не хватало, чтобы покрыть этот экран целиком.
    supabase.from('compliance_containers')
      .select(`id, code, status, volume, unit, opened_at, use_by,
               decanted_at, parent_id, pao_months, note, created_at, batch_id`)
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('created_at', { ascending: false }).limit(300),
    // Партии — только через представление: сама таблица после 0043
    // закрыта на `stock.read`, и инспектор видел бы список вскрытий,
    // в котором ни у одной ёмкости нет партии.
    supabase.from('compliance_batches')
      .select('id, batch_number, expiry_date')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('expiry_date', { ascending: true }).limit(100),
  ])

  return (
    <AppShell modules={m.modules}>
      <PaoControl
        canOpen={can(m, 'compliance.journal.write') || can(m, 'compliance.write')}
        canPrint={can(m, 'stock.read')}
        material={{
          id: material.id, name: material.name, unit: material.unit,
          paoMonths: material.pao_months, isCosmetic: material.is_cosmetic,
        }}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          openedAt: c.opened_at, useBy: c.use_by, decantedAt: c.decanted_at,
          parentId: c.parent_id, paoMonths: c.pao_months, note: c.note,
          batchId: c.batch_id,
        }))}
        batches={(batches ?? []).map((b) => ({
          id: b.id, number: b.batch_number, expiry: b.expiry_date,
        }))}
        loadError={error?.message ?? ''}
      />
    </AppShell>
  )
}
