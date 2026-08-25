import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { getT } from '@/lib/i18n/server'
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
  // Роут отдаёт человеку ТЕКСТ, а не разметку, поэтому и он переводится:
  // «Немає доступу» в окне печати читает тот же мастер, что и экран.
  const t = await getT()
  const m = await currentMembership()
  if (!m) return new NextResponse(t('inventory.labels.denied.member'), { status: 403 })
  if (!can(m, 'stock.read')) {
    return new NextResponse(t('inventory.labels.denied.right'), { status: 403 })
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
    return new NextResponse(t('inventory.labels.denied.module'), { status: 403 })
  }

  const url = new URL(request.url)
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean)

  const supabase = await createClient()
  let q = supabase
    .from('material_containers')
    // `decanted_at` — момент РОЗЛИВУ, и он не то же самое, что `opened_at`.
    // ТЗ 3.2 называет на наклейке именно «дату розливу», и `container_label()`
    // в базе берёт `coalesce(decanted_at, opened_at)`. Пока роут тянул только
    // `opened_at`, у дозатора, разлитого из уже вскрытой банки, на бумаге
    // стояла дата вскрытия РОДИТЕЛЯ — то есть более ранняя, чем сам розлив.
    .select('id, code, use_by, opened_at, decanted_at, status, volume, unit, opened_by, created_by, materials(name), material_batches(batch_number)')
    .eq('tenant_id', m.tenantId)
    .in('status', ['sealed', 'opened'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (ids?.length) q = q.in('id', ids)

  const { data, error } = await q
  if (error) return new NextResponse(error.message, { status: 400 })

  const rows = data ?? []

  // ВІДПОВІДАЛЬНИЙ МАЙСТЕР — четвёртый реквизит из пяти, требуемых ТЗ 3.2.
  // До 14.08.2026 его на наклейке не было вовсе: роут не тянул ни opened_by,
  // ни created_by, и тип Label такого поля не имел.
  //
  // Имя берётся из `staff`, а НЕ из `profiles`, и это не выбор из удобства:
  // у profiles политика `profiles_self_read` — каждый видит только СВОЙ
  // профиль. Встроенный join к нему вернул бы чужим мастерам null, то есть
  // печатал бы прочерк и создавал видимость работающего поля. `staff` —
  // это и есть модель мастера в продукте (на неё же завязаны записи),
  // и она читается арендатором целиком.
  //
  // Отсюда честное следствие, названное в отчёте: пока мастера не заведены
  // в `staff`, имя не подставится ни у кого. Это не дефект печати —
  // это незаполненный справочник.
  const actorIds = Array.from(new Set(
    rows.flatMap((c) => [c.opened_by, c.created_by]).filter(Boolean) as string[],
  ))
  const masters = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: staff } = await supabase
      .from('staff').select('user_id, name')
      .eq('tenant_id', m.tenantId).in('user_id', actorIds)
    for (const s of staff ?? []) {
      if (s.user_id && s.name) masters.set(s.user_id, s.name)
    }
  }

  const { data: shop } = await supabase
    .from('tenants').select('name').eq('id', m.tenantId).single()

  return new NextResponse(
    labelsHtml(shop?.name ?? '', rows.map((c) => ({
      code: c.code,
      material: (c.materials as unknown as { name: string })?.name ?? '',
      batch: (c.material_batches as unknown as { batch_number: string } | null)?.batch_number ?? null,
      useBy: c.use_by,
      // Тот же порядок, что у `container_label()` в базе: розлив, а если
      // ёмкость не разливалась — вскрытие. Две сборки одной наклейки уже
      // разъезжались (найдено аудитом 25.08.2026), и сходятся они только
      // тем, что считают одно и то же одинаково.
      openedAt: c.decanted_at ?? c.opened_at,
      volume: c.volume != null ? Number(c.volume) : null,
      unit: c.unit,
      // Кто вскрыл; если ещё не вскрыта — кто завёл. Порядок именно такой:
      // на вскрытой банке отвечает тот, кто её вскрыл.
      master: masters.get(c.opened_by ?? '') ?? masters.get(c.created_by ?? '') ?? null,
    }))),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
