import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, currentUserId, can, hasModule } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { IconAlert, IconCalendar } from '@/components/icons'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('home.meta.title') }
}

// Сводка дня: записи, что заканчивается, что спливає. Мастер открывает
// это утром — за десять секунд ясно, что требует внимания.
export default async function AppHome() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Экран серверный, поэтому переводчик берётся `await getT()`, а не хуком.
  const t = await getT()
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
  const userId = await currentUserId()

  const [{ data: shop }, { data: me }, bookingsRes, lowRes, expiringRes] =
    await Promise.all([
      // `storefront_enabled` и `slug` отсюда убраны: их не читал никто,
      // а сведения это витринные — набирать их в запрос заведению без
      // модуля `storefront` незачем. Имя нужно заголовку, `status` —
      // плашке «у чернетці», и она ниже спрашивает модуль.
      supabase.from('tenants').select('name, status')
        .eq('id', m.tenantId).single(),
      // Имя человека для карточки-героя. `currentUserId()` берёт id
      // из уже разобранного токена (без сети, CLAUDE.md → правило 3),
      // а `full_name` — это ОДИН лёгкий запрос к своей же строке
      // `profiles`, а не поход к серверу авторизации.
      userId
        ? supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
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

  // «Потребує уваги» — сумма трёх разных бед, а не своя выборка: запись
  // без подтверждения, ёмкость на подходе к сроку, позиция на исходе.
  // Каждое слагаемое уже посчитано своим блоком ниже; здесь оно только
  // складывается для карточки-героя.
  const needsAttention =
    todays.filter((b) => b.status === 'booked').length
    + (expiring ?? []).length
    + (low ?? []).length

  const firstName = (me?.full_name ?? '').trim().split(/\s+/)[0] || ''

  return (
    <AppShell modules={m.modules} perms={m.perms}>
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
          <p className="t-md">{t('home.draft.notice')}</p>
          <Link href="/app/settings" className="btn-secondary t-sm">
            {t('home.draft.publish')}
          </Link>
        </div>
      )}

      {/* Приветствие по имени — из прототипа. Заголовок экрана здесь
          намеренно остаётся именем ЗАВЕДЕНИЯ (`headingOf` в app-shell.tsx,
          решение зафиксировано там), а не превращается в «Доброго ранку»:
          в панели он одинаков для всех разделов и отвечает на вопрос
          «де я», а не «хто я». Личное обращение поэтому — отдельной
          строкой в теле экрана, не в заголовке. */}
      {/* Без «доброго ранку/дня/вечора»: часы для этого выбора были бы
          СЕРВЕРНЫЕ (функция физически рисует страницу в Дублине, UTC),
          а не человека в Києві — «доброго ранку» провисело бы до полудня
          по местному времени продавца. Дешевле и честнее одно приветствие
          без времени суток, чем неправильное время суток. */}
      {firstName && (
        <p className="t-lg rise mb-4">{t('home.greeting', { name: firstName })}</p>
      )}

      {/* ── Карточка-герой ────────────────────────────────────────
          По прототипу CRESKO: сплошная акцентная плашка с двумя
          числами дня. Показывается только тому, кто видит хотя бы
          один из блоков ниже, — карточка со счётом «0 і 0» на пустом
          экране была бы утверждением о заведении, которого человек
          не имеет права знать (см. разбор про право и модуль выше). */}
      {(seeBookings || seeContainers || seeStock) && (
        <div className="today-hero rise-1 mb-6">
          <p className="today-hero-eyebrow">{t('home.hero.eyebrow')}</p>
          <div className="today-hero-row">
            {seeBookings && (
              <div className="today-hero-stat">
                <span className="today-hero-icon"><IconCalendar size={20} /></span>
                <span>
                  <span className="today-hero-value tabular block">{t.number(todays.length)}</span>
                  <span className="today-hero-label block">
                    {t.plural('home.hero.bookings', todays.length)}
                  </span>
                </span>
              </div>
            )}
            <div className="today-hero-stat">
              <span className="today-hero-icon"><IconAlert size={20} /></span>
              <span>
                <span className="today-hero-value tabular block">{t.number(needsAttention)}</span>
                <span className="today-hero-label block">{t('home.hero.attention')}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Записи сегодня */}
        {seeBookings && (
        <section className="rise-1 lg:col-span-2">
          <div className="section-head">
            <p className="eyebrow">{t('home.bookings.title')}</p>
            <Link href="/app/bookings" className="btn-ghost t-sm">{t('home.bookings.all')}</Link>
          </div>
          {todays.length === 0 ? (
            <div className="card empty !py-8">{t('home.bookings.empty')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {todays.map((b) => {
                // Переменная названа `start`, а не `t`: `t` — переводчик.
                const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
                const initial = (b.contact_name || '?').trim().charAt(0).toUpperCase()
                return (
                  <div key={b.id} className="list-card">
                    <span className="tabular t-lg shrink-0" style={{ color: 'var(--color-accent)', minWidth: 52 }}>
                      {t.dateTime(start, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="list-anchor"
                          style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-ink)' }}>
                      {initial}
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* Имя клиента, название услуги и варианта — данные. */}
                      <span className="t-md block truncate">{b.contact_name}</span>
                      <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                        {b.title} · {b.variant_name}
                      </span>
                    </span>
                    {/* Статус записи — значение перечисления
                        (`booking_status_transitions`), переводится подпись. */}
                    <span className={`shrink-0 ${b.status === 'confirmed' ? 'badge-success' : 'badge'}`}>
                      {b.status === 'booked'
                        ? t('home.booking.status.booked')
                        : b.status === 'arrived'
                        ? t('home.booking.status.arrived')
                        : t('home.booking.status.ok')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
        )}

        {/* Сроки годности */}
        {seeContainers && (
        <section className="rise-2">
          <div className="section-head">
            <p className="eyebrow">{t('home.expiring.title')}</p>
            {/* Сам блок стоит на `compliance.read`, а склад за ссылкой —
                на `stock.read`: `/app/inventory` разворачивает обратно
                сюда всех, у кого его нет, то есть инспектора. Ссылка,
                возвращающая на ту же страницу, — это та же сломанная
                навигация, ради которой выше прячется кнопка «До публікації».
                В `seeStock` теперь входит и модуль `inventory`: без него
                `/app/inventory` отвечает экраном «розділ не підключено»,
                и ссылка вела бы туда же — в отказ. */}
            {seeStock && (
              <Link href="/app/inventory" className="btn-ghost t-sm">
                {t('home.expiring.stock')}
              </Link>
            )}
          </div>
          {(expiring ?? []).length === 0 ? (
            <div className="card empty !py-8">{t('home.expiring.empty')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {(expiring ?? []).map((c) => (
                <div key={c.code} className="list-card">
                  <span className="min-w-0 flex-1">
                    {/* Назва засобу і код ємності — данные заклада. */}
                    <span className="t-md block truncate">{c.material_name}</span>
                    <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                      {t('home.expiring.container', { code: c.code })}
                    </span>
                  </span>
                  <span className="badge-warn tabular shrink-0">
                    {t('home.expiring.until', { date: t.date(c.use_by) })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {/* Что закупить */}
        {seeStock && (
        <section className="rise-3 lg:col-span-2">
          <div className="section-head">
            <p className="eyebrow">{t('home.reorder.title')}</p>
            <Link href="/app/inventory" className="btn-ghost t-sm">
              {t('home.reorder.stock')}
            </Link>
          </div>
          {(low ?? []).length === 0 ? (
            <div className="card empty !py-8">{t('home.reorder.empty')}</div>
          ) : (
            <div className="card">
            <div className="flex flex-wrap gap-2">
              {/* Назва позиції — данные; переводится только «докупити». */}
              {(low ?? []).map((r, i) => (
                <span key={i} className="badge-warn tabular">
                  {r.title} · {t('home.reorder.item', { n: t.number(Number(r.to_order)) })}
                </span>
              ))}
            </div>
            </div>
          )}
        </section>
        )}
      </div>
    </AppShell>
  )
}
