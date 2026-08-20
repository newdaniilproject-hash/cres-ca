import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMemberships } from '@/lib/tenant'
import { PublicHeader, PublicFooter } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { ReviewButton } from './review-button'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('account.meta.title') }
}

export default async function AccountPage() {
  const t = await getT()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships()

  const [{ data: orders }, { data: bookings }, { data: reviewed }] = await Promise.all([
    // Позиции — только у ВЫПОЛНЕННЫХ заказов: кнопка «Оцінити» появляется
    // на позиции, а не на заказе целиком (0104 — отзыв привязан к
    // order_items.id, заказ может содержать несколько разных товаров).
    // Строка запроса ЦЕЛИКОМ, без склейки: supabase-js выводит тип
    // результата из литерала, а сумма двух строк для него — просто
    // `string`, и вложенный `order_items` перестаёт существовать.
    supabase.from('orders')
      .select(`id, number, status, total, currency, created_at, tenant_id,
               order_items(id, title, variant_name)`)
      .eq('buyer_user_id', user.id)
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('bookings')
      .select('id, number, status, title, variant_name, period, tenant_id')
      .eq('buyer_user_id', user.id)
      .order('created_at', { ascending: false }).limit(8),
    // Что из этого уже оценено — одним запросом, а не по клику на каждую
    // позицию: RLS отдаёт `reviews_read_own` только строки этого покупателя.
    supabase.from('reviews').select('order_item_id, booking_id')
      .eq('buyer_user_id', user.id),
  ])

  const reviewedItems = new Set((reviewed ?? []).map((r) => r.order_item_id).filter(Boolean))
  const reviewedBookings = new Set((reviewed ?? []).map((r) => r.booking_id).filter(Boolean))

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email

  // Подписи к состояниям — свои, покупательские: продавец видит
  // «нове замовлення», покупатель — «новий». Значения перечислений
  // (`awaiting_payment`, `no_show`) не переводятся: это ключи базы.
  const ORDER_STATUSES = [
    'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
    'shipped', 'delivered', 'completed', 'cancelled', 'returned',
  ] as const
  const BOOKING_STATUSES = [
    'booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show',
  ] as const
  const orderLabel = (v: string) =>
    ((ORDER_STATUSES as readonly string[]).includes(v)
      ? t(`account.order.status.${v as (typeof ORDER_STATUSES)[number]}`) : v)
  const bookingLabel = (v: string) =>
    ((BOOKING_STATUSES as readonly string[]).includes(v)
      ? t(`account.booking.status.${v as (typeof BOOKING_STATUSES)[number]}`) : v)

  return (
    <>
      {/* `account` — шапка не рисует кнопку «Кабінет»: она вела бы на этот
          же экран, то есть одна дверь лежала бы на нём дважды. */}
      <PublicHeader authed account />
      {/* Верхний отступ — на внутренней обёртке, а не на `<main>`:
          правило `html[data-native] .topbar + *` незаслоённое и в обёртке
          затирает его целиком. Разбор — в `app/privacy/legal.tsx`. */}
      <main className="mx-auto max-w-3xl px-4 sm:px-6">
       <div className="pt-10">
        {/* ⚠️ `min-w-0` и `truncate` обязательны, и это не украшение
            (найдено 20.08.2026 на 390px). У покупателя, зарегистрированного
            почтой, `full_name` нет, и в заголовок попадает адрес вида
            `daniilpadalko97@gmail.com`: без `min-w-0` колонка отказывается
            сжиматься, «Безпека» уезжает за правый край, и ВСЯ страница
            получает горизонтальную прокрутку. Кнопка при этом остаётся
            `shrink-0` — сжиматься должно имя, а не действие. */}
        <div className="rise flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="display t-2xl truncate">{name}</h1>
            {/* Почта второй строкой — только когда она НЕ повторяет
                заголовок. Без имени обе строки печатали один и тот же
                адрес друг под другом. */}
            {name !== user.email && (
              <p className="t-sm mt-0.5 truncate prose-muted">{user.email}</p>
            )}
          </div>
          <Link href="/account/security" className="btn-secondary shrink-0">
            {t('account.link.security')}
          </Link>
        </div>

        {/* Заведение есть — вход в кабинет. Заведения нет — предложение
            его завести: с 19.08.2026 покупатель приземляется ЗДЕСЬ
            (0118), и без этой карточки путь «клиент решил стать
            мастером» из продукта пропал бы целиком — регистрация
            продавца осталась бы доступна только по прямой ссылке. */}
        {/* Строка «текст слева, кнопка справа» — раскладка ДЕСКТОПНАЯ.
            На 390px кнопка сжималась до двух строк, а описание — до
            колонки в три слова. Поэтому на телефоне это столбец, а строкой
            становится с `sm`, где ширина для неё есть. */}
        {memberships.length > 0 ? (
          <Link href="/app"
                className="card-link rise-1 mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="t-lg">{t('account.business.title')}</p>
              <p className="t-sm mt-0.5 prose-muted">{t('account.business.desc')}</p>
            </div>
            <span className="btn-primary shrink-0">{t('account.business.open')}</span>
          </Link>
        ) : (
          <Link href="/register/seller"
                className="card-link rise-1 mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="t-lg">{t('account.become.title')}</p>
              <p className="t-sm mt-0.5 prose-muted">{t('account.become.desc')}</p>
            </div>
            <span className="btn-secondary shrink-0">{t('account.become.action')}</span>
          </Link>
        )}

        <section className="rise-2 mt-8">
          <h2 className="display mb-3 t-xl">{t('account.bookings.title')}</h2>
          {bookings && bookings.length > 0 ? (
            <div className="card !p-0">
              {/* `flex-wrap` давал непредсказуемую строку: у записи
                  с кнопкой «Оцінити» состояние уезжало вниз и влево,
                  у записи без неё оставалось справа — два соседних
                  пункта одного списка выглядели по-разному. Столбец
                  на телефоне, строка с `sm`: раскладка одна и та же
                  у всех записей. */}
              {bookings.map((b) => (
                <div key={`${b.tenant_id}-${b.number}`}
                     className="row w-full flex-col items-start gap-2 px-5 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 max-w-full">
                    <p className="t-md truncate">{b.title} · {b.variant_name}</p>
                    <p className="tabular t-sm mt-0.5 prose-muted">
                      {t.dateTime(String(b.period).slice(2, 27), {
                        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={b.status === 'cancelled' ? 'badge' : 'badge-accent'}>
                      {bookingLabel(b.status)}
                    </span>
                    {b.status === 'completed' && (
                      <ReviewButton tenantId={b.tenant_id} kind="booking" sourceId={b.id}
                                    title={`${b.title} · ${b.variant_name}`}
                                    already={reviewedBookings.has(b.id)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">{t('account.bookings.empty')}</div>
          )}
        </section>

        <section className="rise-3 mt-8 pb-8">
          <h2 className="display mb-3 t-xl">{t('account.orders.title')}</h2>
          {orders && orders.length > 0 ? (
            <div className="card !p-0">
              {orders.map((o) => (
                <div key={`${o.tenant_id}-${o.number}`} className="flex flex-col gap-2 px-5 py-3">
                  {/* Подписи состояний бывают длинными («очікує оплати»),
                      и на 390px строка обязана сжимать номер, а не
                      выталкивать сумму за край. */}
                  <div className="row !border-0 !p-0 flex-wrap">
                    <div className="min-w-0">
                      <p className="tabular t-md">
                        {t('account.order.number', { number: Number(o.number) })}
                      </p>
                      <p className="tabular t-sm mt-0.5 prose-muted">{t.date(o.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="badge">{orderLabel(o.status)}</span>
                      {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
                      <p className="tabular t-md">{t.money(Number(o.total), o.currency)}</p>
                    </div>
                  </div>
                  {/* Оцінити можна ПОЗИЦІЮ, а не весь заказ: у заказа из
                      трёх разных товаров непонятно, к какому из них
                      относился бы общий отзыв (0104). */}
                  {o.status === 'completed' && (o.order_items ?? []).length > 0 && (
                    <div className="flex flex-col gap-1.5 pl-1">
                      {(o.order_items as { id: string; title: string; variant_name: string | null }[])
                        .map((it) => (
                        <div key={it.id} className="flex items-center justify-between gap-3">
                          <p className="t-xs truncate prose-muted">
                            {it.title}{it.variant_name ? ` · ${it.variant_name}` : ''}
                          </p>
                          <ReviewButton tenantId={o.tenant_id} kind="order" sourceId={it.id}
                                        title={it.title}
                                        already={reviewedItems.has(it.id)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">{t('account.orders.empty')}</div>
          )}
        </section>
       </div>
      </main>
      <PublicFooter />
    </>
  )
}
