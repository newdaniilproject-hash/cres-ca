'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { dbErrorText } from '@/lib/errors/db'
import { useT } from '@/lib/i18n/client'
import { IconBell, IconClock } from '@/components/icons'

// ── Колокол в шапке ─────────────────────────────────────────────────────────
//
// В прототипе CRESKO шапка держит колокол со счётчиком, и владелец просил
// «чтобы то, что макет показывает, было в точности отображено». Значок
// поставить легко; вопрос был в том, ЧТО он открывает.
//
// Кнопка, которая не открывает ничего, — это не украшение, а сломанная
// навигация: человек нажимает и решает, что приложение не работает
// (то же правило, по которому из меню убраны пункты без права).
// Поэтому колокол показывает НАСТОЯЩУЮ очередь — `notification_outbox`,
// строки со статусом `pending`: напоминания за 24 и 2 часа до записи,
// предупреждения о сроках годности, письма по заказам. То есть ровно
// то, что «потребує уваги» и вот-вот уйдёт клиенту.
//
// Чего он НЕ делает и почему. Это не «входящие» и не лента: своей ленты
// уведомлений у продавца в базе нет, и выдумывать её значит показывать
// пустоту с бодрой подписью. Здесь честно: что стоит в очереди на отправку.
//
// ЦЕНА ЗАПРОСА. Оболочка живёт в `app/app/layout.tsx` и НЕ перерисовывается
// при переходах внутри кабинета — значит счётчик считается один раз за
// открытие приложения, а не на каждый экран. Список подтягивается только
// когда шторку открыли: до нажатия за него не платим.
type Row = {
  id: string
  event: string
  channel: string
  send_after: string
  payload: Record<string, unknown>
}

export function NotifyBell({ tenantPerms, tenantId }: {
  tenantPerms: string[]
  /** Нужен только для очистки очереди (0125). Нет — кнопки нет. */
  tenantId?: string
}) {
  const t = useT()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)

  // Политика чтения очереди (0011) пускает по `customers.read` либо
  // к своим строкам. Без права спрашивать незачем — вернётся пусто,
  // а запрос уйдёт.
  const may = tenantPerms.includes('*') || tenantPerms.includes('customers.read')
  // ── ОЧИСТКА — ОТДЕЛЬНОЕ ПРАВО, А НЕ ТО ЖЕ, ЧТО ЧТЕНИЕ ───────────────
  //
  // Отмена отправки — действие над тем, что уйдёт клиенту, то есть
  // настройка заведения. Право ЧИТАТЬ список не даёт права его гасить:
  // иначе любой, кому открыты клиенты, снимал бы чужие напоминания.
  // То же условие стоит и в самой функции (0125) — здесь оно только
  // прячет кнопку, а границей доступа остаётся база.
  const mayClear = Boolean(tenantId)
    && (tenantPerms.includes('*') || tenantPerms.includes('settings.write'))

  async function reload() {
    const c = createClient()
    const [{ count: n }, { data }] = await Promise.all([
      // Тем же условием, что и первый счёт выше: значок обязан показывать
      // одно и то же число до очистки и после неё.
      c.from('notification_outbox').select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('send_after', new Date().toISOString()),
      c.from('notification_outbox')
        .select('id, event, channel, send_after, payload')
        .eq('status', 'pending')
        .order('send_after', { ascending: true })
        .limit(30),
    ])
    setCount(n ?? 0)
    setRows((data ?? []) as Row[])
  }

  // ── СЧЁТЧИК СЧИТАЕТ ТО, ЧТО ТРЕБУЕТ ВНИМАНИЯ СЕЙЧАС ─────────────────
  //
  // Отзыв владельца 25.08.2026: «99+» и «просто складируются непонятные
  // сообщения». Число было честным арифметически и бессмысленным
  // по сути: каждая заведённая банка ставит в очередь ДВА предупреждения
  // о сроке — за 14 и за 7 дней, — и оба лежат со временем отправки
  // в будущем. Сорок банок — восемьдесят строк, и значок навсегда
  // показывает «99+», не сообщая ничего.
  //
  // Теперь считается только ПРОСРОЧЕННОЕ (`send_after <= now()`) — то,
  // что уже должно было уйти и не ушло. Это ровно то же множество,
  // которое гасит кнопка очистки, и то же, что человек может сделать
  // прямо сейчас. Совпадение не случайно: значок, кнопка и функция 0125
  // обязаны говорить об одном множестве, иначе «Очистити (3)» при
  // значке «99+» читается как поломка.
  //
  // Будущие напоминания при этом никуда не делись — они в списке,
  // отдельной группой «Заплановані».
  useEffect(() => {
    if (!may) return
    let alive = true
    void createClient()
      .from('notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lte('send_after', new Date().toISOString())
      .then(({ count: n }) => { if (alive && n) setCount(n) })
    return () => { alive = false }
  }, [may])

  useEffect(() => {
    if (!open || rows !== null) return
    let alive = true
    void createClient()
      .from('notification_outbox')
      .select('id, event, channel, send_after, payload')
      .eq('status', 'pending')
      .order('send_after', { ascending: true })
      .limit(30)
      .then(({ data }) => { if (alive) setRows((data ?? []) as Row[]) })
    return () => { alive = false }
  }, [open, rows])

  // Просроченные — те, чей срок отправки уже прошёл. Ровно их и гасит
  // функция; считаем здесь по тем же строкам, чтобы кнопка называла
  // ЧИСЛО, а не обещала «очистити все» и оставила половину списка.
  const overdue = (rows ?? []).filter((r) => new Date(r.send_after) <= new Date()).length

  async function dismiss() {
    if (!tenantId) return
    setBusy(true)
    const { data, error } = await createClient()
      .rpc('dismiss_notifications', { p_tenant_id: tenantId })
    setBusy(false)
    if (error) {
      // Отказ базы — обезличенной подписью, не сырым текстом Postgres (М25).
      toast.error(t('app.chrome.bell.clearError'), dbErrorText(t, error))
      return
    }
    await reload()
    toast.success(t('app.chrome.bell.cleared', { n: t.number(Number(data ?? 0)) }))
  }

  if (!may) return null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              aria-label={t('app.chrome.bell.aria')}
              className="iconbtn relative shrink-0">
        <IconBell />
        {count > 0 && (
          // Счётчик — это ЧИСЛО, а не точка: «есть что-то» и «висит
          // восемнадцать напоминаний» — разные новости. Больше 99
          // не показываем: три цифры не влезают в кружок, а разница
          // между 100 и 240 здесь ничего не меняет.
          <span
            aria-hidden
            className="tabular absolute grid place-items-center"
            style={{
              top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 999, fontSize: 11, fontWeight: 700, lineHeight: 1,
              background: 'var(--color-danger)', color: 'var(--color-accent-text)',
              border: '2px solid var(--color-bg)',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* ── «Очистити прострочені» ────────────────────────────────
          Отзыв владельца 25.08.2026: «добавить возможность очищать
          уведомления там, где 99+». Кнопка в прижатой к низу полосе
          (`footer`), а не в списке: она относится ко всему списку,
          а не к строке, и не должна уезжать вместе с прокруткой.

          ⚠️ ГАСИТ ТОЛЬКО ПРОСРОЧЕННОЕ, и подпись это называет числом.
          В очереди лежат напоминания за 24 и 2 часа до записи — со
          временем отправки В БУДУЩЕМ; кнопка «очистити все» тихо
          отменила бы напоминание завтрашнему клиенту. Экран стал бы
          чище, а человек не пришёл бы на процедуру. Правило то же,
          что и в функции 0125, и оно там, а не только здесь.

          Нечего гасить — кнопки нет вовсе: орган управления, который
          ничего не изменит, читается как сломанный. */}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('app.chrome.bell.sheetTitle')}
             footer={mayClear && overdue > 0 ? (
               <button type="button" className="btn-secondary w-full" disabled={busy}
                       onClick={() => void dismiss()}>
                 {busy
                   ? t('common.saving')
                   : t('app.chrome.bell.clear', { n: t.number(overdue) })}
               </button>
             ) : undefined}>
        <NotifyList t={t} rows={rows} />
      </Sheet>
    </>
  )
}

// Тон значка по смыслу события. Тонов три, а не палитра под каждое имя:
// «горит» (срок годности), «скоро» (напоминание) и нейтральное остальное.
function toneOf(event: string): string {
  if (event.startsWith('expiry')) return 'rose'
  if (event.includes('reminder')) return 'amber'
  return 'blue'
}

// ── Подписи событий ─────────────────────────────────────────────────────────
//
// ⚠️ ЗДЕСЬ БЫЛ ДЕФЕКТ, И ОН ВИДЕН НА ЭКРАНЕ. Отзыв владельца 25.08.2026:
// «непонятно, что написано на английском языке, непонятно для чего».
// В списке стояло `cosmetics.expiry_14d` тридцать раз подряд.
//
// Причина: карта знала ЧЕТЫРЕ ключа, и ни один из них не совпадал с тем,
// что база реально ставит в очередь. `expiry.warning` и `booking.reminder`
// не ставит никто — настоящие коды `cosmetics.expiry_14d`,
// `booking.reminder_24h` и так далее. То есть запасной путь «показать
// код как есть» работал ВСЕГДА, а не в редком случае.
//
// Отсюда правило: карта собрана по коду миграций (grep по
// `enqueue_notification`), а не по догадке о том, как события могли бы
// называться. Список закрытый и полный на 25.08.2026; появится новое
// событие — подпись заводится вместе с ним, в том же коммите.
function eventLabel(t: ReturnType<typeof useT>, event: string): string {
  const known: Record<string, string> = {
    'cosmetics.expiry_14d': t('app.chrome.bell.event.expiry14'),
    'cosmetics.expiry_7d': t('app.chrome.bell.event.expiry7'),
    'booking.reminder_24h': t('app.chrome.bell.event.bookingReminder24h'),
    'booking.reminder_2h': t('app.chrome.bell.event.bookingReminder2h'),
    'booking.created': t('app.chrome.bell.event.bookingCreated'),
    'booking.cancelled': t('app.chrome.bell.event.bookingCancelled'),
    'seller.booking_created': t('app.chrome.bell.event.sellerBooking'),
    'seller.order_created': t('app.chrome.bell.event.sellerOrder'),
    'order.created': t('app.chrome.bell.event.orderCreated'),
    'order.confirmed': t('app.chrome.bell.event.orderConfirmed'),
    'order.shipped': t('app.chrome.bell.event.orderShipped'),
    'order.delivered': t('app.chrome.bell.event.orderDelivered'),
    'order.cancelled': t('app.chrome.bell.event.orderCancelled'),
    'stock.reorder_digest': t('app.chrome.bell.event.reorder'),
  }
  return known[event] ?? event
}

// ── О ЧЁМ уведомление, а не только какого оно рода ──────────────────────────
//
// Тридцать строк «Термін придатності — 14 днів» подряд не лучше тридцати
// строк `cosmetics.expiry_14d`: они по-прежнему неразличимы. Различает их
// то, что уже лежит в `payload` и до 25.08.2026 не показывалось вовсе, —
// название засоба, код наклейки, имя клиента, время записи.
//
// Части возвращаются СПИСКОМ, а не склеенной строкой с точкой: точки-
// разделители владелец снял с экрана склада тем же днём, и заводить их
// заново здесь значило бы развести два правила по двум экранам.
function detailOf(t: ReturnType<typeof useT>, r: Row): string[] {
  const p = r.payload ?? {}
  const s = (k: string) => {
    const v = p[k]
    return typeof v === 'string' && v.trim() ? v.trim()
      : typeof v === 'number' ? String(v)
        : null
  }
  const useBy = s('use_by')
  const number = s('number')
  const count = s('count')
  const parts = r.event.startsWith('cosmetics.expiry')
    ? [s('material'), s('code'),
       useBy ? t('app.chrome.bell.useBy', { date: t.date(useBy) }) : null]
    : r.event.startsWith('booking.') || r.event === 'seller.booking_created'
      ? [s('title'), s('name'), s('when')]
      : r.event.startsWith('order.') || r.event === 'seller.order_created'
        ? [number ? `№ ${number}` : null, s('name')]
        : r.event === 'stock.reorder_digest'
          ? [count ? t('inventory.registry.count.many', { n: count }) : null]
          : []
  return parts.filter((x): x is string => Boolean(x))
}

// ── Содержимое шторки ───────────────────────────────────────────────────────
//
// Отдельным экспортом, а не разметкой внутри `NotifyBell`, по той же причине,
// по которой это сделано у «Сьогодні»: очередь живёт за входом и на живых
// данных, а сверить её вид с макетом надо на стенде приёмки. Переводчик
// приходит пропом — второй `useT()` внутри дал бы тот же результат, но
// стенд не смог бы подставить строки, которых ещё нет в словаре.
export function NotifyList({ t, rows }: { t: ReturnType<typeof useT>; rows: Row[] | null }) {
  // Граница «уже пора» берётся ОДИН раз на отрисовку, а не в каждой строке:
  // иначе соседние строки сравнивались бы с разными моментами времени,
  // и строка на границе могла попасть в обе группы или ни в одну.
  const nowTs = Date.now()
  const overdue = (r: Row) => new Date(r.send_after).getTime() <= nowTs
  const now = (rows ?? []).filter(overdue)
  const later = (rows ?? []).filter((r) => !overdue(r))

  return (
    <>
    {rows === null ? (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-row px-1"><span /><span /><span /><span /></div>
        ))}
      </div>
    ) : rows.length === 0 ? (
      <div className="empty">
        <span className="empty-icon"><IconBell size={24} /></span>
        <p className="empty-title">{t('app.chrome.bell.empty')}</p>
        <p className="empty-desc">{t('app.chrome.bell.emptyDesc')}</p>
      </div>
    ) : (
      <>
        {/* ── ДВЕ ГРУППЫ, А НЕ ОДНА ЛЕНТА ──────────────────────────
            «Готові до відправки» — то, что уже должно было уйти
            и не ушло: это и есть число на значке, и ровно это гасит
            кнопка внизу. «Заплановані» — напоминания со временем
            отправки в будущем; их нельзя ни «прочитать», ни погасить
            кнопкой, потому что снять ещё не отправленное оповещение
            это не «прочитано», а «отменено» (правило функции 0125).

            Без этого деления список выглядел как свалка: тридцать
            строк, из которых ни одна не отличалась от другой и ни
            с одной ничего нельзя было сделать. */}
        {([
          ['now', t('app.chrome.bell.group.now'), now],
          ['later', t('app.chrome.bell.group.later'), later],
        ] as const).filter(([, , list]) => list.length > 0).map(([key, title, list]) => (
          <div key={key} className={key === 'later' && now.length > 0 ? 'mt-4' : ''}>
            <div className="section-head">
              <p className="eyebrow">{title}</p>
              <span className="tabular t-xs" style={{ color: 'var(--color-faint)' }}>
                {t.number(list.length)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {list.map((r) => {
                const detail = detailOf(t, r)
                return (
                  // Карточками с зазором, а не сплошным списком с линейками:
                  // у строки две-три величины, и в сплошном списке соседние
                  // уведомления слипаются в одно.
                  <div key={r.id} className="list-card items-start">
                    {/* Тон плашки — по СМЫСЛУ события, а не по порядку строки:
                        срок годности красный, напоминание жёлтое, остальное
                        нейтрально-синее. Четыре одинаковых значка читаются
                        как один блок, и глаз не находит тревожный. */}
                    <span className="stat-tile-icon shrink-0" data-tone={toneOf(r.event)}>
                      <IconClock size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-3">
                        <span className="t-md min-w-0 flex-1">{eventLabel(t, r.event)}</span>
                        {/* Время отправки — справа и мелким: оно уточняет
                            строку, а не называет её. Канал (`email` / `push`)
                            не показывается вовсе: это значение перечисления,
                            служебное имя нашей очереди. */}
                        <span className="tabular t-xs shrink-0" style={{ color: 'var(--color-faint)' }}>
                          {t.date(r.send_after, {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </span>
                      {/* ЧТО ИМЕННО просрочено или кому уйдёт письмо —
                          из `payload`. Части стоят порознь с зазором,
                          без точек-разделителей: их владелец снял
                          с экрана склада тем же днём. Названия засобів
                          и имена клиентов — данные арендатора. */}
                      {detail.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          {detail.map((part, i) => (
                            <span key={part + i} className="t-sm"
                                  style={{ color: i === 0 ? 'var(--color-muted)' : 'var(--color-faint)' }}>
                              {part}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </>
        )}
    </>
  )
}
