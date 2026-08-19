'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { IconChevronRight, IconClose, IconPlus, IconUsers } from '@/components/icons'
import { NewCustomerSheet } from './new-customer'

// ── Клиенты: карточка и выгрузка ───────────────────────────────────────────
//
// Экран умышленно НЕ показывает телефон в списке и НЕ читает его сам.
// Причина не в оформлении, а в том, ради чего написана 0090.
//
// Контакт клиента — это то, что уносят. Одна и та же строка «Оксана,
// +380…» в списке из ста человек и в открытой карточке значит разное:
// список читается глазами и не оставляет следа, карточка открывается
// осознанно и оставляет строку в журнале доступа. Поэтому контакт живёт
// только в карточке, а карточку отдаёт `customer_card` — она проверяет
// право `customers.contacts`, маскирует телефон и почту тому, у кого его
// нет, и пишет, ЧТО именно было отдано: «картка з контактами» или
// «картка без контактів».
//
// Выгрузка — второе действие и самое опасное из четырёх: одним нажатием
// уходит вся база. `customers_export` кладёт в журнал число выгруженных
// строк, поэтому по журналу видно разницу между «посмотрел одного» и
// «унёс базу». Файл собирается ЗДЕСЬ, из того, что вернула функция:
// собрать его из уже загруженного списка было бы быстрее и означало бы
// выгрузку мимо журнала.
//
// ⚠️ ЧЕГО ЭТОТ ЭКРАН НЕ ЗАКРЫВАЕТ. На таблице `customers` политика чтения
// висит на `customers.read`, и колонки `phone` и `email` отдаются по ней
// напрямую через PostgREST — то есть тот, у кого есть только
// `customers.read`, всё ещё может прочитать контакты запросом мимо этого
// экрана. Экран перестал быть таким запросом, но дыра закрывается не
// экраном, а правами на таблицу. Разбор и предлагаемая починка —
// `notes/pii-leaks.md`, пункт 1.

// ── CRESKO Web, §3 «Клієнти» — колонки таблицы широкого экрана ────────────
//
// Колонки хендоффа взяты один в один, КРОМЕ второй: в макете там телефон,
// и его здесь нет и быть не может по той же причине, по которой его нет
// в строке телефонного списка (разбор выше). Место занято числом
// замовлень — величиной, которая у списка ЕСТЬ: страница отдаёт
// `orders_count`, `total_spent` и `last_order_at`, и ни одного контакта.
//
// Не «пустая колонка с прочерком» и не «показати телефон» кнопкой:
// первое обещает данные, которых экран не получит, второе означало бы
// сто открытий карточки ради одного взгляда на список — и сто строк
// в журнале доступа, по которому потом разбираются, кто смотрел контакты.
const WGRID = '2fr 1.4fr 1.1fr 1fr 34px'

export type CustomerRow = {
  id: string
  name: string
  orders_count: number
  total_spent: number | string
  last_order_at: string | null
  tags: string[] | null
}

type Card = {
  id: string
  name: string
  phone: string | null
  email: string | null
  note: string | null
  tags: string[] | null
  orders_count: number
  total_spent: number | string
  last_order_at: string | null
  created_at: string
}

export function CustomersClient({
  tenantId, customers, canWrite, active = 'all',
  stats = { all: 0, month: 0, idle: 0 },
}: {
  tenantId: string
  customers: CustomerRow[]
  /** `customers.write`. Только раскладка: границу держит политика 0006. */
  canWrite: boolean
  /** Выбранный отбор. Значения — те же, что понимает `page.tsx`. */
  active?: 'all' | 'month' | 'idle'
  /**
   * Счётчики по ВСЕЙ базе, а не по выданной сотне (см. `page.tsx`).
   * Величины мехАнические: сколько всего, сколько было в этом месяце,
   * у скольких нет ни одного замовлення. «Постійний клієнт» и «середній
   * чек» из макета сюда НЕ попали намеренно: первого в продукте нет как
   * понятия, второй не считается без суммы по всей базе — а плитка,
   * посчитанная по видимой сотне, врёт ровно у того заклада, которому
   * она нужна.
   */
  stats?: { all: number; month: number; idle: number }
}) {
  const t = useT()
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  // Форма новая одна на оба экрана, кнопок две (широкий хедер и узкая
  // полоса). Двух состояний быть не должно: они разъезжаются, и человек
  // видит открытой одну шторку, а заполняет вторую.
  const [adding, setAdding] = useState(false)

  const [card, setCard] = useState<Card | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Куда показывать карточку. Шторка и правая панель — ОДНО состояние
  // (`card`) и один запрос: два состояния разъехались бы, а два запроса
  // писали бы в журнал доступа две строки на одно открытие.
  //
  // Раскладку решает не ширина окна, а МЕСТО НАЖАТИЯ: таблица живёт под
  // `hidden lg:flex`, список — под `lg:hidden`, и нажать можно ровно то,
  // что видно. Проверка ширины в обработчике была бы вторым источником
  // правды о том, какая раскладка сейчас на экране.
  const [where, setWhere] = useState<'sheet' | 'panel'>('sheet')
  // Выбранная строка подсвечивается СРАЗУ, не дожидаясь ответа базы:
  // карточку отдаёт запрос, а нажатие обязано отзываться в тот же кадр
  // (CLAUDE.md, правило 6).
  const [picked, setPicked] = useState<string | null>(null)

  // Приход из общего поиска: `/app/customers?id=<uuid>` открывает карточку
  // сразу. Своей страницы у клиента нет (список плюс шторка), поэтому
  // ссылка ведёт на список и говорит, кого именно показать, — иначе
  // найденного человека пришлось бы искать второй раз уже глазами.
  //
  // Карточку по-прежнему отдаёт `customer_card`, а не выборка из списка:
  // право на контакты и строка в журнале доступа не обходятся ни ссылкой,
  // ни чем-либо ещё. Адрес чистится сразу — иначе «назад» открывало бы
  // карточку снова, а обновление страницы писало бы в журнал второй раз.
  const sp = useSearchParams()
  useEffect(() => {
    const id = sp.get('id')
    if (!id) return
    window.history.replaceState(null, '', '/app/customers')
    // Приход по ссылке — единственный случай, когда нажатия не было и
    // спросить о раскладке некого. Здесь (и только здесь) её выясняет
    // `matchMedia`: эффект клиентский, разметку он не рисует, поэтому
    // расхождения с серверным рендером не бывает.
    void openCard(
      id,
      window.matchMedia('(min-width: 1024px)').matches ? 'panel' : 'sheet',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  async function openCard(id: string, target: 'sheet' | 'panel') {
    setBusy(id)
    setWhere(target)
    setPicked(id)
    const { data, error } = await supabase.rpc('customer_card', {
      p_tenant_id: tenantId, p_customer_id: id,
    })
    setBusy(null)
    if (error) {
      setPicked(null)
      toast.error(t('customers.card.error'), error.message); return
    }
    const row = (data as Card[] | null)?.[0]
    if (!row) {
      setPicked(null)
      toast.error(t('customers.card.error'), t('customers.card.gone')); return
    }
    setCard(row)
  }

  function closeCard() { setCard(null); setPicked(null) }

  async function exportAll() {
    setBusy('export')
    const { data, error } = await supabase.rpc('customers_export', { p_tenant_id: tenantId })
    setBusy(null)
    if (error) { toast.error(t('customers.export.error'), error.message); return }

    const rows = (data as Record<string, unknown>[] | null) ?? []
    if (rows.length === 0) { toast.info(t('customers.export.empty')); return }

    // Заголовки — из словаря: файл открывают в Excel, и он такая же
    // поверхность интерфейса, как экран.
    const cols: [string, string][] = [
      ['name', t('customers.export.col.name')],
      ['phone', t('customers.export.col.phone')],
      ['email', t('customers.export.col.email')],
      ['orders_count', t('customers.export.col.orders')],
      ['total_spent', t('customers.export.col.spent')],
      ['last_order_at', t('customers.export.col.last')],
      ['created_at', t('customers.export.col.created')],
    ]
    // Точка с запятой, а не запятая: украинский Excel разбирает CSV по
    // разделителю списка из локали, и файл с запятыми открывается одной
    // колонкой. BOM — по той же причине: без него кириллица приезжает
    // кракозябрами.
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      cols.map(([, title]) => esc(title)).join(';'),
      ...rows.map((r) => cols.map(([key]) => esc(r[key])).join(';')),
    ].join('\r\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = t('customers.export.filename')
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(t('customers.export.done', { n: t.number(rows.length) }))
  }

  // Средний чек считается, а не берётся: колонки под него нет, но обе
  // величины, из которых он складывается, карточка отдаёт. Показывается
  // только при непустом числе заказов — деление на ноль дало бы «—»
  // в плитке, которая обещает деньги.
  const avg = card && Number(card.orders_count) > 0
    ? Number(card.total_spent) / Number(card.orders_count)
    : null

  return (
    <>
      {/* ═══ CRESKO Web, §3 «Клієнти» — ТОЛЬКО lg ════════════════════════
          Хедер экрана: плашка со значком, имя экрана тем же ключом,
          которым его называет панель и вкладка браузера, и подпись под
          ним. Справа — единственное действие уровня экрана.

          «Додати клієнта» из макета ЕСТЬ, и прежняя запись здесь («клиента
          не заводят руками — он появляется сам с первым заказом или
          записью») отменена: она описывала витрину, а салон работает
          по телефону. Клиент звонит, и до появления этой формы записать
          его было нельзя вовсе — ни клиента, ни записи, ни заказа
          из кабинета не создавалось. Вторым источником клиентов форма
          не становится: и запись, и заказ по-прежнему находят карточку
          по телефону, а не заводят свою. */}
      <div className="mb-5 hidden items-center justify-between gap-4 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconUsers size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1" data-size="27">{t('app.screen.customers.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.customers.desc')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {customers.length > 0 && (
            // Тот же обработчик, что и у кнопки телефона: выгрузка идёт
            // через `customers_export` и пишет строку в журнал доступа.
            // Второй сборки файла здесь нет и заводить её нельзя.
            <button type="button" className="btn-secondary"
                    disabled={busy === 'export'}
                    onClick={() => void exportAll()}>
              {busy === 'export' ? t('common.saving') : t('customers.export.cta')}
            </button>
          )}
          {canWrite && (
            <button type="button" className="btn-primary"
                    style={{ minHeight: 'var(--tap-min)' }}
                    onClick={() => setAdding(true)}>
              <IconPlus size={18} />
              {t('customers.add.cta')}
            </button>
          )}
        </div>
      </div>

      {/* README, розділ G: рядок клієнта — аватар, ім'я, бейдж категорії,
          останній візит, статистика. Телефона в этой строке НЕТ и быть
          не может: контакт отдаёт `customer_card` с проверкой права
          и записью в журнал доступа (0090), а строка списка обошла бы
          и то, и другое. Всё остальное из макета на месте.

          Аватар — буква имени на плашке, а не картинка: колонки под фото
          у клиента нет, и пустой серый кружок был бы честнее только на вид. */}
      <section className="rise mb-3 flex items-center justify-between gap-3 lg:hidden">
        <p className="eyebrow">{t('customers.list.title')}</p>
        <span className="flex items-center gap-2">
          {customers.length > 0 && (
            <button type="button" className="btn-ghost t-sm"
                    disabled={busy === 'export'}
                    onClick={() => void exportAll()}>
              {busy === 'export' ? t('common.saving') : t('customers.export.cta')}
            </button>
          )}
          {canWrite && (
            <button type="button" className="btn-primary t-sm"
                    style={{ minHeight: 'var(--tap-min)' }}
                    onClick={() => setAdding(true)}>
              <IconPlus size={16} />
              {t('customers.add.cta')}
            </button>
          )}
        </span>
      </section>

      {customers.length === 0 ? (
        <section className="card rise-1">
          <div className="empty">
            <span className="empty-icon"><IconUsers size={24} /></span>
            <p className="empty-title">{t('customers.empty')}</p>
            <p className="empty-desc">{t('customers.list.desc')}</p>
          </div>
        </section>
      ) : (
        <>
        <div className="rise-1 flex flex-col gap-2 lg:hidden">
          {customers.map((c) => (
            <button key={c.id} type="button" className="list-card"
                    disabled={busy === c.id}
                    onClick={() => void openCard(c.id, 'sheet')}>
              <span aria-hidden className="thumb-sm t-md" style={{ fontWeight: 650 }}>
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-md block truncate">{c.name}</span>
                <span className="tabular t-xs mt-0.5 block prose-muted">
                  {c.last_order_at
                    ? t('customers.lastVisit', { date: t.date(c.last_order_at) })
                    : t('customers.noVisits')}
                </span>
                {(c.tags ?? []).length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {(c.tags ?? []).slice(0, 2).map((tag) => (
                      <span key={tag} className="badge">{tag}</span>
                    ))}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {Number(c.total_spent) > 0 && (
                  <span className="tabular t-md">{t.money(Number(c.total_spent))}</span>
                )}
                <span className="badge-accent tabular">
                  {t('customers.ordersCount', { n: Number(c.orders_count) })}
                </span>
              </span>
              {/* Шеврон обязателен: карточка открывается ЗАПРОСОМ к базе
                  и оставляет строку в журнале доступа. Строка, которая
                  выглядит как текст, но что-то делает, — это случайные
                  открытия в журнале, по которому потом разбираются,
                  кто смотрел контакты. */}
              <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                {busy === c.id ? '…' : '›'}
              </span>
            </button>
          ))}
        </div>

        {/* ── CRESKO Web: список таблицей + панель деталей (только lg) ──
            Панель, а не вторая страница: карточку открывают, чтобы
            сверить её со строкой списка («это та Оксана или другая»),
            и уводить ради этого с экрана значит заставить вернуться.
            Ширина 398px и появление — класс `.wpanel`. */}
        <div className="hidden gap-5 lg:flex">
          <div className="min-w-0 flex-1">
            <div className="wtable">
              <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
                <span>{t('customers.web.table.customer')}</span>
                <span>{t('customers.web.table.orders')}</span>
                <span>{t('customers.web.table.last')}</span>
                <span>{t('customers.web.table.spent')}</span>
                <span />
              </div>
              {customers.map((c) => (
                // Строка целиком кнопка: внутри неё нет ни одного второго
                // действия, а открытие карточки — запрос к базе и строка
                // в журнале доступа. Зона нажатия `--tap-min`: тем же
                // экраном пользуются с планшета.
                <button key={c.id} type="button" className="wtable-row"
                        disabled={busy === c.id}
                        aria-current={picked === c.id ? 'true' : undefined}
                        style={{
                          gridTemplateColumns: WGRID,
                          minHeight: 'var(--tap-min)',
                          background: picked === c.id
                            ? 'var(--color-accent-soft)' : undefined,
                        }}
                        onClick={() => void openCard(c.id, 'panel')}>
                  <span className="flex min-w-0 items-center gap-3">
                    {/* Аватар — буква имени: колонки под фото у клиента
                        нет, и пустой серый кружок был бы честнее только
                        на вид. */}
                    <span aria-hidden className="list-anchor" data-tone="accent"
                          style={{ width: 36, height: 36, fontWeight: 650 }}>
                      {c.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      {/* Имя клиента — данные заклада, не переводится. */}
                      <span className="block truncate font-semibold"
                            style={{ color: 'var(--color-text)' }}>{c.name}</span>
                      {(c.tags ?? []).length > 0 && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 2).map((tag) => (
                            <span key={tag} className="badge">{tag}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                  <span>
                    <span className="badge-accent tabular">
                      {t('customers.ordersCount', { n: Number(c.orders_count) })}
                    </span>
                  </span>
                  <span className="tabular">
                    {c.last_order_at ? t.date(c.last_order_at) : t('common.noValue')}
                  </span>
                  <span className="tabular">
                    {Number(c.total_spent) > 0
                      ? t.money(Number(c.total_spent))
                      : t('common.noValue')}
                  </span>
                  <span aria-hidden className="flex justify-end"
                        style={{ color: 'var(--color-faint)' }}>
                    {busy === c.id ? '…' : <IconChevronRight size={18} />}
                  </span>
                </button>
              ))}
              <div className="wtable-foot">
                <span className="tabular">
                  {t('customers.web.table.total', { n: t.number(customers.length) })}
                </span>
              </div>
            </div>
          </div>

          {where === 'panel' && card && (
            <aside className="wpanel">
              <div className="flex items-start justify-between gap-3">
                <span aria-hidden className="list-anchor" data-tone="accent"
                      style={{ width: 66, height: 66, fontSize: 24, fontWeight: 700 }}>
                  {card.name.trim().charAt(0).toUpperCase()}
                </span>
                <button type="button" className="btn-icon"
                        aria-label={t('common.close.aria')}
                        onClick={closeCard}>
                  <IconClose size={18} />
                </button>
              </div>

              <h2 className="mt-3" style={{ fontSize: 21, fontWeight: 750, lineHeight: 1.2 }}>
                {card.name}
              </h2>
              {(card.tags ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(card.tags ?? []).map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
              )}

              {/* Четыре величины — ровно те, что у карточки есть.
                  «Останні послуги/замовлення» из макета здесь нет:
                  `customer_card` отдаёт СЧЁТЧИКИ, а не состав заказов,
                  и список пришлось бы добирать вторым запросом мимо
                  журнала доступа. Пустой блок с подписью читался бы
                  как «заказов не было». */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="wmetric">
                  <span className="min-w-0">
                    <span className="wmetric-label block">{t('customers.card.spent')}</span>
                    <span className="wmetric-value tabular block truncate">
                      {t.money(Number(card.total_spent))}
                    </span>
                  </span>
                </div>
                <div className="wmetric">
                  <span className="min-w-0">
                    <span className="wmetric-label block">{t('customers.card.orders')}</span>
                    <span className="wmetric-value tabular block truncate">
                      {t.number(Number(card.orders_count))}
                    </span>
                  </span>
                </div>
                {avg !== null && (
                  <div className="wmetric">
                    <span className="min-w-0">
                      <span className="wmetric-label block">
                        {t('customers.web.panel.avg')}
                      </span>
                      <span className="wmetric-value tabular block truncate">
                        {t.money(avg)}
                      </span>
                    </span>
                  </div>
                )}
                <div className="wmetric">
                  <span className="min-w-0">
                    <span className="wmetric-label block">
                      {t('customers.web.table.last')}
                    </span>
                    <span className="wmetric-value tabular block truncate">
                      {card.last_order_at ? t.date(card.last_order_at) : t('common.noValue')}
                    </span>
                  </span>
                </div>
              </div>

              {/* Контакты — из того же `customer_card`, что и в шторке:
                  право `customers.contacts` проверено, маска наложена,
                  открытие записано. Обхода этого пути на широком экране
                  нет и быть не может. */}
              <p className="webh2 mb-2 mt-5">{t('customers.web.panel.info')}</p>
              <div className="kv">
                <div className="kv-row">
                  <span className="kv-key">{t('customers.card.phone')}</span>
                  <span className="kv-val tabular">
                    {card.phone || t('common.noValue')}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('customers.card.email')}</span>
                  <span className="kv-val truncate">{card.email || t('common.noValue')}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('customers.card.since')}</span>
                  <span className="kv-val tabular">{t.date(card.created_at)}</span>
                </div>
                {card.note && (
                  <div className="kv-row">
                    <span className="kv-key">{t('customers.card.note')}</span>
                    <span className="kv-val">{card.note}</span>
                  </div>
                )}
              </div>

              {/* Маскировка — не сбой и не «нет данных». Человек должен
                  понимать, что звёздочки поставили ему намеренно, иначе
                  он пойдёт искать телефон в обход. */}
              <p className="field-hint mt-3">{t('customers.card.hint')}</p>
            </aside>
          )}
        </div>
        </>
      )}

      {/* Шторка — только для узкого экрана: на широком та же карточка
          лежит в правой панели. Открывается она не классом, а тем, откуда
          пришло нажатие (`where`): шторка уходит порталом в body, и
          спрятать её обёрткой `lg:hidden` нельзя. */}
      <Sheet open={where === 'sheet' && card !== null} onClose={closeCard} title={card?.name}>
        {card && (
          <div className="flex flex-col gap-3">
            <Field label={t('customers.card.phone')} value={card.phone} t={t} />
            <Field label={t('customers.card.email')} value={card.email} t={t} />
            <Field label={t('customers.card.note')} value={card.note} t={t} />
            <Field
              label={t('customers.card.orders')}
              value={t('customers.ordersCount', { n: Number(card.orders_count) })}
              t={t}
            />
            <Field
              label={t('customers.card.spent')}
              value={t.money(Number(card.total_spent))}
              t={t}
            />
            <Field
              label={t('customers.card.since')}
              value={t.date(card.created_at)}
              t={t}
            />
            {(card.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(card.tags ?? []).map((tag) => (
                  <span key={tag} className="badge">{tag}</span>
                ))}
              </div>
            )}
            {/* Маскировка — не сбой и не «нет данных». Человек должен
                понимать, что звёздочки поставили ему намеренно, иначе
                он пойдёт искать телефон в обход. */}
            <p className="field-hint">{t('customers.card.hint')}</p>
          </div>
        )}
      </Sheet>

      {/* Форма нового клиента — одна на обе раскладки (разбор у состояния
          `adding` выше). Она сама обновляет список после успеха. */}
      <NewCustomerSheet tenantId={tenantId} open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function Field({
  label, value, t,
}: {
  label: string
  value: string | null
  t: ReturnType<typeof useT>
}) {
  return (
    <div>
      <p className="t-xs prose-muted">{label}</p>
      <p className="t-md">{value && value !== '' ? value : t('common.noValue')}</p>
    </div>
  )
}
