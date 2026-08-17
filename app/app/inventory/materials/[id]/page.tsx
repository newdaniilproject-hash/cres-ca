import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { MaterialCard } from './material-card'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.material.title') }
}

// Карточка засоба — экран 2 макета и пункт 3.1 ТЗ.
//
// До неё в реестре нельзя было исправить ни одного поля: форма
// существовала только для заведения. Здесь и просмотр, и правка,
// и вход в документы и в контроль вскрытия — два подэкрана рядом.
//
// ─────────────────────────────────────────────────────────────────────
// ЕДИНОЕ ПРАВИЛО КОМПЛАНС-ЭКРАНОВ (действует и в /app/documents,
// и в подэкранах docs/ и pao/ — там стоят короткие ссылки сюда).
//
// ЧТО БЫЛО СЛОМАНО. Роль `inspector` после 0035 имеет ровно одно право —
// `compliance.read`. А `materials` и `material_batches` закрыты
// политиками на `stock.read` (0003, 0043). Экраны читали именно эти
// таблицы, поэтому инспектор получал не отказ, а пустоту и `notFound()`:
// «засоба не існує» вместо «вам сюда нельзя». Ровно затем в 0035/0043/0060
// и заведены представления `compliance_*` — и до сих пор их не читал
// ни один экран.
//
// КАК ЧИНИМ, НЕ ПЛОДЯ ВЕТВЛЕНИЙ «если инспектор». Ветвления по роли нет
// вообще, ни одного. Вместо него — два независимых запроса и одно
// правило, кто в каком живёт:
//
//   компланс-часть (паспорт по Техрегламенту, партии, сроки) —
//     ВСЕГДА из `compliance_*`. Представления отдают строки всем,
//     у кого есть `compliance.read`: владельцу («*»), админу, менеджеру,
//     мастеру, наблюдателю И инспектору (проверено на боевой базе).
//     Они `security_invoker = off`, то есть сознательно обходят RLS
//     исходных таблиц (0062) — это их назначение, а не побочный эффект.
//
//   коммерческая часть (остаток, себестоимость, поставщик, место) —
//     ВСЕГДА из обычных таблиц. Запрос выполняется для всех и никогда
//     не падает: у кого нет `stock.read`, тому RLS просто не отдаёт
//     строк, и коммерческий блок не рисуется. Это не «проверка роли
//     в коде», а та же самая проверка прав, что и в политике, — просто
//     сделанная там, где ей и место (правило 2 и правило 3 CLAUDE.md).
//
// Плата — один лишний запрос за отрисовку карточки инспектору. Цена
// альтернативы (`if (role === 'inspector')` на каждом экране) — второй
// источник правды о правах, который разъедется с `role_grants`.
// ─────────────────────────────────────────────────────────────────────
export default async function MaterialPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Карточка — это ДВА экрана в одном: паспорт по Техрегламенту
  // (`compliance.read`) и складская часть (`stock.read`). Пускаем того,
  // у кого есть хоть одно из двух, и показываем ровно ту половину,
  // на которую право есть. Прежнее условие требовало `stock.read`
  // и разворачивало инспектора — то есть роль, ради которой карточка
  // с паспортом и заводилась.
  if (!can(m, 'compliance.read') && !can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const { id } = await params
  const supabase = await createClient()
  const t = await getT()

  // Паспорт — из представления, коммерция — из таблицы. Оба запроса
  // уходят всегда; отсутствие права выражается пустым ответом, а не
  // ошибкой и не веткой в коде.
  const [{ data: passport, error }, { data: commerce }] = await Promise.all([
    supabase.from('compliance_materials')
      .select(`id, name, unit, category, sku, brand, country_of_origin, inci,
               notification_code, notification_url, notification_date,
               pao_months, is_cosmetic, is_active`)
      .eq('id', id)
      .eq('tenant_id', m.tenantId)
      .maybeSingle(),
    supabase.from('materials')
      .select(`id, name, unit, category, sku, brand, country_of_origin, inci,
               notification_code, notification_url, notification_date,
               pao_months, is_cosmetic, current_stock, min_stock_threshold,
               cost_per_unit, supplier_id, location_id, is_active`)
      .eq('id', id)
      .eq('tenant_id', m.tenantId)
      .maybeSingle(),
  ])

  if (error) {
    return (
      <AppShell>
        {/* Текст отказа базы — её слова, а не наши: в словарь он не едет. */}
        <p className="field-error rise">
          {t('inventory.material.openError')}: {error.message}
        </p>
      </AppShell>
    )
  }
  // Общие поля берём из представления, а если его нет — из таблицы.
  // Второй случай не гипотетический: точечным запретом (0077) можно
  // снять `compliance.read` у кладовщика, и складская карточка обязана
  // остаться рабочей.
  const material = passport ?? commerce
  if (!material) notFound()

  const [
    { data: batches }, { data: batchCommerce }, { data: containers }, { count: docs },
    { data: suppliers }, { data: locations },
  ] = await Promise.all([
    // Номер, даты и сроки партии — компланс-часть (0043 явно вырезала
    // из представления `supplier_id` и `note`: цена приёмки инспектору
    // не показывается).
    supabase.from('compliance_batches')
      .select('id, batch_number, manufactured_date, expiry_date, received_at')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('expiry_date', { ascending: true }).limit(100),
    // Поставщик партии — коммерческая часть, поэтому отдельным запросом
    // к таблице. Он нужен только форме правки, а она под `stock.write`.
    supabase.from('material_batches')
      .select('id, supplier_id')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .limit(100),
    // Ёмкости представлением НЕ подменяются: политика
    // `material_containers_read` (0014) и так стоит на `compliance.read`,
    // то есть таблица открыта инспектору напрямую. `compliance_containers`
    // добавляет только приклеенные названия засоба и партии, которые
    // здесь уже известны.
    supabase.from('material_containers')
      .select('id, code, status, volume, unit, opened_at, use_by, decanted_at, parent_id')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .in('status', ['sealed', 'opened'])
      .order('use_by', { ascending: true, nullsFirst: false }).limit(100),
    supabase.from('material_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId).eq('material_id', id),
    supabase.from('suppliers').select('id, name')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('name').limit(200),
    supabase.from('storage_locations').select('id, name')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('position').limit(200),
  ])

  return (
    <AppShell modules={m.modules}>
      <MaterialCard
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        docsCount={docs ?? 0}
        material={{
          id: material.id,
          name: material.name,
          unit: material.unit,
          sku: material.sku,
          category: material.category,
          // Склад и деньги — только из коммерческого запроса. Инспектору
          // он вернул пустоту, и блок остатка просто не рисуется.
          threshold: commerce ? Number(commerce.min_stock_threshold) : 0,
          cost: commerce?.cost_per_unit != null ? Number(commerce.cost_per_unit) : null,
          supplierId: commerce?.supplier_id ?? null,
          locationId: commerce?.location_id ?? null,
          isCosmetic: material.is_cosmetic,
          brand: material.brand,
          country: material.country_of_origin,
          inci: material.inci,
          notificationCode: material.notification_code,
          notificationUrl: material.notification_url,
          notificationDate: material.notification_date,
          paoMonths: material.pao_months,
        }}
        stock={commerce ? Number(commerce.current_stock) : null}
        batches={(batches ?? []).map((b) => ({
          id: b.id, number: b.batch_number,
          made: b.manufactured_date, expiry: b.expiry_date,
          received: b.received_at,
          supplierId: (batchCommerce ?? []).find((x) => x.id === b.id)?.supplier_id ?? null,
        }))}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          openedAt: c.opened_at, useBy: c.use_by,
          decantedAt: c.decanted_at, parentId: c.parent_id,
        }))}
        suppliers={suppliers ?? []}
        locations={locations ?? []}
      />
    </AppShell>
  )
}
