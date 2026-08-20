import Link from 'next/link'
import type { T } from '@/lib/i18n/translate'
import { IconAlert, IconCalendar } from '@/components/icons'

// ── «Сьогодні» на телефоне ───────────────────────────────────────────────────
//
// Разметка вынесена из `app/app/page.tsx` отдельным файлом по той же причине,
// по которой это уже сделано у склада, записей и услуг: экран страницы —
// СЕРВЕРНЫЙ и живёт за входом, а сеть контейнера закрыта политикой окружения.
// Пока разметка сидела внутри запросов, сверить её с макетом было нечем,
// и расхождения находил владелец глазами. Здесь она принимает готовые
// значения — и ту же самую разметку рисует временная страница приёмки вида
// с данными из хендоффа.
//
// Клиентским компонентом файл НЕ объявлен намеренно: состояния у экрана нет,
// а `'use client'` утащил бы в бандл ещё и переводчик со всеми словарями.
// Переводчик приходит пропом — сервер получает его через `await getT()`.

export type TodayBooking = {
  id: string
  /** Начало записи, ISO. Формат времени выбирает переводчик. */
  startISO: string
  /** Имя клиента и название услуги — данные заклада, не переводятся. */
  name: string
  service: string
  /** Значение `booking_status_transitions`; подпись берётся из словаря. */
  status: string
}

export type TodayAttention = {
  key: string
  title: string
  sub: string
  badge: string
  /** Срочность: красный бейдж для «уже горит», жёлтый для «скоро». */
  hot?: boolean
  /**
   * Куда ведёт строка. `null` — если у человека нет права на тот раздел:
   * ссылка, разворачивающая обратно сюда, — это сломанная навигация,
   * ровно та, ради которой из меню убраны пункты без права.
   */
  href: string | null
}

export function TodayMobile(props: {
  t: T
  /** Имя человека для приветствия. Пусто — приветствия нет. */
  name: string
  showBookings: boolean
  showAttention: boolean
  bookings: TodayBooking[]
  attention: TodayAttention[]
}) {
  const { t, name, showBookings, showAttention, bookings, attention } = props

  // «п'ятниця, 9 травня» → «П'ятниця, 9 травня». Intl отдаёт день недели
  // со строчной, а в макете он с прописной — это начало предложения,
  // а не название. Правится первой буквой, а не своим списком дней:
  // список пришлось бы вести на каждый язык словаря.
  const dateLine = t.date(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })
  const dateCap = dateLine.charAt(0).toUpperCase() + dateLine.slice(1)

  return (
    <div className="lg:hidden">
      {/* Приветствие и дата — СОДЕРЖИМОЕ экрана, а не его заголовок:
          заголовков и подзаголовков над содержимым в кабинете нет
          (решение владельца 19.08.2026), но «хто я і який сьогодні день»
          панель снизу не отвечает. */}
      {name && <p className="t-2xl rise">{t('home.greeting', { name })}</p>}
      <p className="t-base rise mb-4 prose-muted">{dateCap}</p>

      {/* ── Карточка-герой ──────────────────────────────────────────
          Из макета: градиентная плашка с двумя числами дня. Показывается
          только тому, кто видит хотя бы одно из них, — карточка со счётом
          «0 і 0» на пустом экране была бы утверждением о заведении,
          которого человек не имеет права знать.

          Градиент задан здесь, а не в `globals.css`, — единственное место
          в этом проходе, где значение живёт по месту. Собран он из ДВУХ
          токенов акцента (`accent` → `accent-hover`), то есть темы
          не разъедутся; но переехать в класс он обязан, как только файл
          стилей будет открыт для правки. */}
      {(showBookings || showAttention) && (
        <div className="today-hero rise-1 mb-5"
             style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))' }}>
          <p className="today-hero-eyebrow">{t('home.hero.eyebrow')}</p>
          <div className="today-hero-row">
            {showBookings && (
              <div className="today-hero-stat">
                <span className="today-hero-icon"><IconCalendar size={20} /></span>
                <span>
                  {/* README: число в градиентной карточке — 21px/800.
                      Кегль из закрытой шкалы, множитель размера текста
                      обязан его тянуть — отсюда `calc`, а не число. */}
                  <span className="today-hero-value tabular block"
                        style={{ fontSize: 'calc(21px * var(--type-scale))', fontWeight: 800 }}>
                    {t.number(bookings.length)}
                  </span>
                  <span className="today-hero-label block">
                    {t.plural('home.hero.bookings', bookings.length)}
                  </span>
                </span>
              </div>
            )}
            {showAttention && (
              <div className="today-hero-stat">
                <span className="today-hero-icon"><IconAlert size={20} /></span>
                <span>
                  <span className="today-hero-value tabular block"
                        style={{ fontSize: 'calc(21px * var(--type-scale))', fontWeight: 800 }}>
                    {t.number(attention.length)}
                  </span>
                  <span className="today-hero-label block">{t('home.hero.attention')}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Розклад на сьогодні ─────────────────────────────────── */}
      {showBookings && (
        <section className="rise-2 mb-5">
          <div className="section-head">
            <p className="eyebrow">{t('home.schedule.title')}</p>
            <Link href="/app/bookings" className="btn-ghost t-sm"
                  style={{ color: 'var(--color-accent-ink)' }}>
              {t('home.schedule.all')}
            </Link>
          </div>
          {bookings.length === 0 ? (
            <div className="card empty !py-8">{t('home.bookings.empty')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {bookings.map((b) => (
                <div key={b.id} className="list-card">
                  {/* Время — акцент КАК ТЕКСТ, то есть `accent-ink`:
                      заливочный кобальт в роли текста на светлом фоне
                      читается тяжелее, и это тот самый случай, ради
                      которого токена два. */}
                  <span className="tabular t-base shrink-0 font-semibold"
                        style={{ color: 'var(--color-accent-ink)', minWidth: 44 }}>
                    {t.dateTime(b.startISO, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="list-anchor" data-tone="accent">
                    {(b.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-md block truncate">{b.name}</span>
                    <span className="t-sm block truncate prose-muted">{b.service}</span>
                  </span>
                  <span className={`shrink-0 ${badgeClass(b.status)}`}>
                    {b.status === 'booked'
                      ? t('home.booking.status.booked')
                      : b.status === 'arrived'
                      ? t('home.booking.status.arrived')
                      : t('home.booking.status.ok')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Потребує уваги ──────────────────────────────────────────
          Один блок вместо двух («Спливає термін» и «Що закуповувати»):
          в карточке-герое это ОДНО число, и раздельные секции внизу
          не давали ему ни одного выхода — зато давали две ссылки
          в один и тот же «Склад», который уже лежит в нижней панели.
          Теперь выход есть у каждой строки, а число сверху равно
          длине этого списка. */}
      {showAttention && (
        <section className="rise-3">
          <p className="eyebrow mb-2">{t('home.attention.title')}</p>
          {attention.length === 0 ? (
            <div className="card empty !py-8">{t('home.attention.empty')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {attention.map((a) => {
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      {/* Две строки, а не многоточие: имена засобів длинные
                          и различаются КОНЦОМ («Absolut Repair Mask» против
                          «Absolut Repair Shampoo»), и обрезка по первому
                          слову превращает список в набор одинаковых строк.
                          У записей выше этого нет — там имя клиента. */}
                      <span className="t-md block clamp-2">{a.title}</span>
                      <span className="t-sm block truncate prose-muted">{a.sub}</span>
                    </span>
                    <span className={`${a.hot ? 'badge-danger' : 'badge-warn'} tabular shrink-0`}>
                      {a.badge}
                    </span>
                  </>
                )
                return a.href ? (
                  <Link key={a.key} href={a.href} className="list-card">{inner}</Link>
                ) : (
                  <div key={a.key} className="list-card">{inner}</div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// Статус записи цветом: «нова» ждёт подтверждения — жёлтый; подтверждена —
// акцентный, как в макете; «у кріслі» — зелёный, работа идёт.
function badgeClass(status: string): string {
  if (status === 'booked') return 'badge-warn'
  if (status === 'arrived') return 'badge-success'
  return 'badge-accent'
}
