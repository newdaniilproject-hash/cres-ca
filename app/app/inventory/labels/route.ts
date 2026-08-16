import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { labelsHtml } from '@/lib/report/labels'

// Лист наклеек с QR для ёмкостей.
//
// Важное разделение, которое лежит и в схеме:
//   заводской штрихкод с коробки мы ЧИТАЕМ (material_barcodes),
//   а на разлитый дозатор печатаем СВОЙ код (material_containers.code) —
//   потому что срок годности после вскрытия у каждой ёмкости свой,
//   и заводской код о нём ничего не знает.
//
// QR рисуется на клиенте библиотекой из CDN: держать генератор картинок
// на сервере ради листа наклеек — лишняя зависимость.
//
// Право то же, что у экрана склада (`stock.read`), — с него ведут все
// три кнопки печати, и своей страницы у листа нет. Одного членства мало
// по двум причинам сразу: название заведения в шапке листа берётся из
// `tenants`, куда RLS пускает любого участника, а сами ёмкости политика
// `material_containers_read` (0014) отдаёт по `compliance.read` — то есть
// инспектору, которому склад закрыли отдельно в 0035, лист печатался
// целиком. Роут, а не страница, поэтому 403 вместо редиректа: окно
// печати обязано сказать «нельзя», а не принять за наклейки разметку
// экрана кабинета.
export async function GET(request: Request) {
  const m = await currentMembership()
  if (!m) return new NextResponse('Немає доступу', { status: 403 })
  if (!can(m, 'stock.read')) {
    return new NextResponse('Немає права на наліпки', { status: 403 })
  }
  // Вторая ось — модуль склада. Лист наклеек живёт только внутри
  // `/app/inventory`, и когда сам раздел заведению не подключён,
  // печатать нечего: у страницы за этим адресом стоит `ModuleOff`.
  // Ответ тот же 403 и по той же причине, что и правом выше, — это
  // роут, а не страница: `ModuleOff` здесь напечатался бы разметкой
  // вместо наклеек, а редирект отдал бы в принтер экран кабинета.
  // Текст отличается от «немає права» намеренно: раздел не куплен
  // заведением, а не запрещён этому человеку.
  if (!hasModule(m, 'inventory')) {
    return new NextResponse('Модуль «Склад» не підключено', { status: 403 })
  }

  const url = new URL(request.url)
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean)

  const supabase = await createClient()
  let q = supabase
    .from('material_containers')
    .select('id, code, use_by, opened_at, status, volume, unit, materials(name), material_batches(batch_number)')
    .eq('tenant_id', m.tenantId)
    .in('status', ['sealed', 'opened'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (ids?.length) q = q.in('id', ids)

  const { data, error } = await q
  if (error) return new NextResponse(error.message, { status: 400 })

  const { data: shop } = await supabase
    .from('tenants').select('name').eq('id', m.tenantId).single()

  return new NextResponse(
    labelsHtml(shop?.name ?? '', (data ?? []).map((c) => ({
      code: c.code,
      material: (c.materials as unknown as { name: string })?.name ?? '',
      batch: (c.material_batches as unknown as { batch_number: string } | null)?.batch_number ?? null,
      useBy: c.use_by,
      openedAt: c.opened_at,
      volume: c.volume != null ? Number(c.volume) : null,
      unit: c.unit,
    }))),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
