import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { AppShell } from '@/components/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Сьогодні' }

// Сводка дня: записи, что заканчивается, что спливає. Мастер открывает
// это утром — за десять секунд ясно, что требует внимания.
export default async function AppHome() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  // ЭТОТ экран правом не закрывается и закрыт быть не может: он —
  // адрес, куда уходит `redirect('/app')` со всех остальных страниц.
  // Проверка права здесь означала бы цикл редиректов.
  //
  // Поэтому здесь другой приём той же задачи: каждый блок сводки
  // спрашивает своё право САМ, и запрос под него даже не отправляется.
  // Иначе получалось наоборот: accountant видел «Сьогодні записів немає»
  // и «Запасів достатньо» — три бодрых утверждения о заведении, ни одно
  // из которых он не имеет права знать и ни одно из которых не правда.
  // Пустой блок здесь не безобиден: по нему принимают решения утром.
  //
  // Со второй осью здесь ровно то же самое, и по той же причине. Экран
  // модулем не закрывается — он адрес всех редиректов, а `ModuleOff`
  // вместо сводки означал бы «кабинета нет». Значит модуль спрашивает
  // каждый блок сам, рядом со своим правом: набор `modules` описывает,
  // что заведение вообще брало, и блок раздела, которого у заклада нет,
  // утверждает о нём то, чего оно не покупало. «Сьогодні записів немає»
  // без модуля `bookings` — не пустота, а неправда: записей нет не потому,
  // что день свободен. Пара `право && модуль` считается один раз здесь,
  // и под невыполненную — запрос не отправляется вовсе.
  const seeBookings = can(m, 'orders.read') && hasModule(m, 'bookings')     // bookings_read (0010)
  const seeStock = can(m, 'stock.read') && hasModule(m, 'inventory')        // stock_low_view (0009)
  const seeContainers = can(m, 'compliance.read') && hasModule(m, 'compliance') // compliance_containers (0035)
  const seeSettings = can(m, 'settings.read')
  // Витрина — отдельный модуль, и у экрана настроек его нет: «Магазин»
  // в панели не помечен модулем, потому что там же лежат данные закладу,
  // команда и удаление аккаунта. Модулю `storefront` принадлежит не
  // страница, а публичная сторінка заклада — и всё, что о ней говорит.
  const seeStorefront = hasModule(m, 'storefront')

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)

  const [{ data: shop }, bookingsRes, lowRes, expiringRes] =
    await Promise.all([
      // `storefront_enabled` и `slug` отсюда убраны: их не читал никто,
      // а сведения это витринные — набирать их в запрос заведению без
      // модуля `storefront` незачем. Имя нужно заголовку, `status` —
      // плашке «у чернетці», и она ниже спрашивает модуль.
      supabase.from('tenants').select('name, status')
        .eq('id', m.tenantId).single(),
      seeBookings ? supabase.from('bookings')
        .select('id, number, title, variant_name, period, status, contact_name')
        .eq('tenant_id', m.tenantId)
        .in('status', ['booked', 'confirmed', 'arrived'])
        .gte('period', `[${todayStart.toISOString()},)`)
        .order('period').limit(20) : null,
      seeStock ? supabase.from('stock_low_view').select('kind, title, to_order')
        .eq('tenant_id', m.tenantId).limit(6) : null,
      // Из представления, а не из таблицы со вложенной связью
      // `materials(name)`. Сама таблица ёмкостей открыта по
      // `compliance.read` и данные бы отдала — а вот `materials` закрыта
      // на `stock.read` (0035), и вложенная связь к ней возвращает null,
      // а НЕ ошибку. У инспектора блок «Спливає термін» показывал список
      // сроков без единого названия засоба: строки есть, читать нечего.
      // `compliance_containers.material_name` — та же величина, но взятая
      // внутри представления, где арендатор отсекается его собственным
      // WHERE по `compliance.read` (0062).
      seeContainers ? supabase.from('compliance_containers')
        .select('code, use_by, material_name')
        .eq('tenant_id', m.tenantId)
        .eq('status', 'opened')
        .not('use_by', 'is', null)
        .lte('use_by', new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10))
        .order('use_by').limit(6) : null,
    ])

  const bookings = bookingsRes?.data ?? null
  const low = lowRes?.data ?? null
  const expiring = expiringRes?.data ?? null

  const todays = (bookings ?? []).filter((b) => {
    const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
    return start >= todayStart && start <= todayEnd
  })

  return (
    <AppShell modules={m.modules} perms={m.perms} active="/app" title={shop?.name ?? 'Кабінет'}>
      {/* Кнопка ведёт на /app/settings, а туда пускает только
          `settings.read`. Показывать её тому, кого экран настроек
          развернёт обратно, значит завести ту самую сломанную
          навигацию, ради которой всё это и делается.

          Плюс модуль `storefront`: вся плашка — про публичную сторінку.
          Без модуля витрины «публічна сторінка вимкнена» и «До публікації»
          обещают заведению публикацию, которой оно не покупало, — и ведут
          к блоку настроек, который при выключенном модуле не рисуется. */}
      {shop && shop.status === 'draft' && seeSettings && seeStorefront && (
        <div className="card-flat rise mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="t-md">
            Заклад у чернетці: облік уже працює, публічна сторінка вимкнена.
          </p>
          <Link href="/app/settings" className="btn-secondary t-sm">До публікації</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Записи сегодня */}
        {seeBookings && (
        <section className="card rise-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Записи сьогодні</h2>
            <Link href="/app/bookings" className="btn-ghost t-sm">Усі</Link>
          </div>
          {todays.length === 0 ? (
            <div className="empty !py-8">Сьогодні записів немає</div>
          ) : (
            todays.map((b) => {
              const t = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
              return (
                <div key={b.id} className="row">
                  <div className="flex items-center gap-3">
                    <span className="tabular t-xl" style={{ color: 'var(--color-accent)' }}>
                      {t.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div>
                      <p className="t-md">{b.contact_name}</p>
                      <p className="t-xs prose-muted">{b.title} · {b.variant_name}</p>
                    </div>
                  </div>
                  <span className={b.status === 'confirmed' ? 'badge-success' : 'badge'}>
                    {b.status === 'booked' ? 'нова' : b.status === 'arrived' ? 'у кріслі' : 'ок'}
                  </span>
                </div>
              )
            })
          )}
        </section>
        )}

        {/* Сроки годности */}
        {seeContainers && (
        <section className="card rise-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Спливає термін</h2>
            {/* Сам блок стоит на `compliance.read`, а склад за ссылкой —
                на `stock.read`: `/app/inventory` разворачивает обратно
                сюда всех, у кого его нет, то есть инспектора. Ссылка,
                возвращающая на ту же страницу, — это та же сломанная
                навигация, ради которой выше прячется кнопка «До публікації».
                В `seeStock` теперь входит и модуль `inventory`: без него
                `/app/inventory` отвечает экраном «розділ не підключено»,
                и ссылка вела бы туда же — в отказ. */}
            {seeStock && (
              <Link href="/app/inventory" className="btn-ghost t-sm">Склад</Link>
            )}
          </div>
          {(expiring ?? []).length === 0 ? (
            <div className="empty !py-8">Найближчі два тижні — усе в межах терміну</div>
          ) : (
            (expiring ?? []).map((c) => (
              <div key={c.code} className="row">
                <div>
                  <p className="t-md">{c.material_name}</p>
                  <p className="t-xs prose-muted">Ємність {c.code}</p>
                </div>
                <span className="badge-warn tabular">до {new Date(c.use_by!).toLocaleDateString('uk-UA')}</span>
              </div>
            ))
          )}
        </section>
        )}

        {/* Что закупить */}
        {seeStock && (
        <section className="card rise-3 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Що закуповувати</h2>
            <Link href="/app/inventory" className="btn-ghost t-sm">Залишки</Link>
          </div>
          {(low ?? []).length === 0 ? (
            <div className="empty !py-8">Запасів достатньо</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(low ?? []).map((r, i) => (
                <span key={i} className="badge-warn tabular">
                  {r.title} · докупити {Number(r.to_order)}
                </span>
              ))}
            </div>
          )}
        </section>
        )}
      </div>
    </AppShell>
  )
}
