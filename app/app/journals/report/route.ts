import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { getT } from '@/lib/i18n/server'
import { reportHtml, type ReportData } from '@/lib/report/sanitation-report'

// Paperless-отчёт для перевірки (Держпродспоживслужба / Держлікслужба).
//
// Отдаётся как HTML, который печатается в PDF одной кнопкой браузера.
// Почему не серверный PDF-генератор: кириллица в PDF требует встроенных
// шрифтов и тянет тяжёлую зависимость, а браузер уже умеет и то, и другое.
// Печать в PDF на телефоне и на компьютере даёт одинаковый файл.
//
// Кроме шапки. `tenants` RLS пускает ЛЮБОГО участника заведения, поэтому
// одного членства мало: без проверки ниже бухгалтер (accountant) —
// единственная роль без `compliance.read` — открывал этот адрес напрямую
// и получал `legal_name`, `tax_id` и контактный телефон заведения
// в шапке отчёта. Журналы ему при этом отдавались пустыми: RLS работал,
// а утекало ровно то, что политикой не закрыто. Роут — не страница,
// поэтому редиректа здесь нет: отдаём 403, иначе печать «отчёта»
// молча вернёт HTML экрана кабинета.
//
// ── ГЛАВНОЕ ПРО ЭТОТ ФАЙЛ ────────────────────────────────────────────────
//
// Отчёт — главный артефакт роли «инспектор» и прямой пункт условий сделки
// с первым клиентом. Из шести ролей с `compliance.read` (owner, admin,
// manager, operator, viewer, inspector) ровно одна — inspector — НЕ имеет
// `stock.read`. Поэтому здесь нельзя читать ни одной таблицы, закрытой
// складским правом: она отдаст не отказ, а ПУСТОТУ, и проверяющий
// напечатает отчёт, в котором «реєстр засобів» пуст, а «партії» нет вовсе.
// Так и было: `materials` закрыта на `stock.read` (0035), `material_batches`
// — с 0043. Реестр, партии и ёмкости берутся из компланс-представлений.
//
// Вложенные связи PostgREST (`materials(name)`, `profiles(full_name)`)
// здесь запрещены по той же причине и ещё по одной, худшей: связь
// к закрытой таблице возвращает `null`, а не ошибку. Так колонка
// «Виконавець» во всех трёх санитарных журналах была прочерком у ВСЕХ
// ролей — `profiles` читается политикой только про себя (0001), — хотя
// подвал документа утверждает: «у кожного запису зафіксовано час
// та виконавця». Имена приходят из `compliance_actors` (0083) отдельным
// запросом и склеиваются здесь.
//
// ── ЯЗЫК: ОТКАЗ И ДОКУМЕНТ ЖИВУТ ПО РАЗНЫМ ПРАВИЛАМ ───────────────────────
//
// Три отказа ниже — это интерфейс: их читает СВОЙ человек, тот, кто нажал
// кнопку в кабинете, и читает на языке, который сам выбрал. Поэтому они
// из словаря.
//
// А сам документ, который собирает `reportHtml`, ВСЕГДА украинский и куку
// языка не спрашивает вовсе: его читает не мастер, а проверяющий
// Держпродспоживслужби. Причина решения — в шапке
// `lib/report/sanitation-report.ts`; здесь важно одно: `lang` в этот файл
// не приходит и передавать его в вёрстку отчёта нечем.
export async function GET(request: Request) {
  const t = await getT()
  const m = await currentMembership()
  if (!m) return new NextResponse(t('journals.report.error.noMembership'), { status: 403 })
  if (!can(m, 'compliance.read')) {
    return new NextResponse(t('journals.report.error.noPerm'), { status: 403 })
  }
  // Вторая ось — модуль `compliance`. Право есть у шести ролей, но сам
  // раздел журналов заведение могло не подключать: тогда `/app/journals`
  // отвечает экраном «розділ не підключено», а этот адрес всё равно
  // собирал документ — с шапкой из `tenants` (легальное имя, ЄДРПОУ,
  // телефон) и пустыми журналами. Пустой «звіт для перевірки» хуже
  // отказа: его печатают и несут проверяющему. Ответ — 403, а не
  // `ModuleOff` и не редирект, по той же причине, что и правом выше.
  if (!hasModule(m, 'compliance')) {
    return new NextResponse(t('journals.report.error.noModule'), { status: 403 })
  }

  // Остаток и поставщик — складские сведения, а не санитарные. В компланс-
  // представлениях их нет намеренно (0035, 0043): инспектору показывают,
  // ЧЕМ работают и какой партией, но не сколько закупили и у кого.
  // Тому, у кого есть `stock.read`, они дочитываются отдельными запросами.
  const seeStock = can(m, 'stock.read')

  const url = new URL(request.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 90), 1), 365)
  const from = new Date(Date.now() - days * 864e5).toISOString()

  const supabase = await createClient()

  const [
    shop, materials, batches, containers, solutions, cleaning, cycles, cards,
    actors, stock, suppliers,
  ] = await Promise.all([
    supabase.from('tenants')
      .select('name, legal_name, tax_id, city, address, contact_phone')
      .eq('id', m.tenantId).single(),
    supabase.from('compliance_materials')
      .select('id, name, brand, country_of_origin, inci, notification_code, pao_months, unit, is_cosmetic')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('name'),
    supabase.from('compliance_batches')
      .select('id, batch_number, expiry_date, received_at, material_name')
      .eq('tenant_id', m.tenantId).order('expiry_date'),
    supabase.from('compliance_containers')
      .select('code, status, opened_at, use_by, volume, unit, material_name')
      .eq('tenant_id', m.tenantId).in('status', ['sealed', 'opened', 'finished'])
      .order('use_by', { nullsFirst: false }),
    supabase.from('sanitation_solutions')
      .select('agent_name, registration, concentration, volume, unit, prepared_at, expires_at, prepared_by')
      .eq('tenant_id', m.tenantId).gte('prepared_at', from)
      .order('prepared_at', { ascending: false }),
    supabase.from('cleaning_entries')
      .select('performed_at, performed_by, cleaning_tasks(name)')
      .eq('tenant_id', m.tenantId).gte('performed_at', from)
      .order('performed_at', { ascending: false }).limit(500),
    supabase.from('sterilization_cycles')
      .select('device, temperature_c, duration_minutes, indicator_ok, performed_at, performed_by')
      .eq('tenant_id', m.tenantId).gte('performed_at', from)
      .order('performed_at', { ascending: false }),
    supabase.from('tech_cards')
      .select('title, version, steps, created_at')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('title'),
    // Имена исполнителей журналов. Отдельный запрос, а не вложенная связь:
    // см. объяснение в шапке файла.
    supabase.from('compliance_actors')
      .select('user_id, full_name').eq('tenant_id', m.tenantId),
    seeStock
      ? supabase.from('materials').select('id, current_stock').eq('tenant_id', m.tenantId)
      : null,
    seeStock
      ? supabase.from('material_batches')
          .select('id, suppliers(name)').eq('tenant_id', m.tenantId)
      : null,
  ])

  const nameOf = new Map((actors.data ?? []).map((a) => [a.user_id, a.full_name]))
  const person = (id: string | null) =>
    id ? { full_name: nameOf.get(id) ?? null } : null

  const stockOf = new Map(
    (stock?.data ?? []).map((r) => [r.id, Number(r.current_stock)]),
  )
  const supplierOf = new Map(
    (suppliers?.data ?? []).map((r) => [
      r.id, (r.suppliers as unknown as { name: string } | null) ?? null,
    ]),
  )

  const html = reportHtml({
    shop: shop.data,
    days,
    // `current_stock` в реестре появляется ТОЛЬКО по `stock.read`:
    // в `compliance_materials` этой колонки нет намеренно.
    //
    // Оговорка, которую нельзя терять. Колонка «Залишок» в самой вёрстке
    // (`lib/report/sanitation-report.ts`) безусловная, а этот файл ею
    // не владеет. Поэтому здесь остаток НЕ подменяется нулём: ноль
    // в документе для проверки читался бы как «засобу немає на складі»,
    // то есть отчёт врал бы молча — худший вид дефекта в этом проекте.
    // Значение просто отсутствует, и ячейка видна глазу как испорченная,
    // пока вёрстка не научится прятать колонку без `stock.read`.
    materials: (materials.data ?? []).map((r) => ({
      name: r.name, brand: r.brand, country_of_origin: r.country_of_origin,
      inci: r.inci, notification_code: r.notification_code,
      pao_months: r.pao_months, unit: r.unit, is_cosmetic: r.is_cosmetic,
      current_stock: stockOf.get(r.id),
    })) as unknown as ReportData['materials'],
    // Названия засобів и партий приходят колонкой представления
    // (`material_name`), а не вложенной связью: связь к закрытой таблице
    // отдала бы null. Форма объекта сохранена ради вёрстки.
    batches: (batches.data ?? []).map((r) => ({
      batch_number: r.batch_number, expiry_date: r.expiry_date,
      received_at: r.received_at,
      materials: { name: r.material_name },
      suppliers: supplierOf.get(r.id) ?? null,
    })),
    containers: (containers.data ?? []).map((r) => ({
      code: r.code, status: r.status, opened_at: r.opened_at, use_by: r.use_by,
      volume: r.volume, unit: r.unit,
      materials: { name: r.material_name },
    })),
    solutions: (solutions.data ?? []).map((r) => ({
      agent_name: r.agent_name, registration: r.registration,
      concentration: r.concentration, volume: r.volume, unit: r.unit,
      prepared_at: r.prepared_at, expires_at: r.expires_at,
      profiles: person(r.prepared_by),
    })),
    cleaning: (cleaning.data ?? []).map((r) => ({
      performed_at: r.performed_at,
      cleaning_tasks: (r.cleaning_tasks as unknown as { name: string } | null),
      profiles: person(r.performed_by),
    })),
    cycles: (cycles.data ?? []).map((r) => ({
      device: r.device, temperature_c: r.temperature_c,
      duration_minutes: r.duration_minutes, indicator_ok: r.indicator_ok,
      performed_at: r.performed_at,
      profiles: person(r.performed_by),
    })),
    cards: cards.data ?? [],
  })

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
