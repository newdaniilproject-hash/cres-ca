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
// ⚠️ ЗДЕСЬ СТОЯЛО, что дыра ещё открыта: «колонки `phone` и `email`
// отдаются по `customers.read` напрямую через PostgREST». ЭТО БОЛЬШЕ
// НЕВЕРНО и не должно вернуться. Закрыла её миграция 0099 — она отобрала
// `select` на таблицу и выдала обратно поимённо на все колонки, КРОМЕ
// этих двух. 0099 применена на бой 17.08.2026.
//
// Сверено с боевой базой 25.08.2026 запросом к `information_schema.
// column_privileges`, а не по файлу миграции: у роли `authenticated`
// `SELECT` остался на `name` и `note`, на `phone` и `email` его нет.
//
// Почему это важно записать, а не просто стереть абзац: колонку в RLS
// не скроешь — политика фильтрует СТРОКИ, а не поля, — поэтому единственная
// защита контакта здесь и есть колоночное право. Тот, кто в следующий раз
// напишет `.select('*')` на `customers`, получит отказ по колонке и решит,
// что «сломались права». Права не сломались: контакт отдаёт `customer_card`,
// и только он, потому что он же пишет строку в журнал доступа.
//
// Открытым по этому пути не осталось ничего; попутная находка про лишние
// `INSERT`/`UPDATE` у `anon` (не дыра — политики для `anon` на таблице нет
// вовсе) и вытекающий из неё запрет — `notes/pii-leaks.md`, пункт 1.

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
    // Убираем ТОЛЬКО `id`, а не весь запрос: в адресе может стоять отбор
    // списка, и затерев его, мы вернули бы человека с «Були цього місяця»
    // на полную базу молча.
    const url = new URL(window.location.href)
    url.searchParams.delete('id')
    window.history.replaceState(null, '', url.pathname + url.search)
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

      {/* ── CRESKO Web §3: смуга вкладок відбору (тільки lg) ──────────
          У хендоффі тут «Всі клієнти / Нові / Постійні / VIP / Неактивні».
          Наші три — це ті самі відбори, які РЕАЛЬНО вміє сторінка
          (`?filter=`): вся база, були цього місяця, без жодного
          замовлення. «Постійні» і «VIP» — теги, а не стани, і вкладка
          під них показувала б порожньо тому, хто тегів не веде.

          Без цієї смуги десктоп лишався без жодних дверей до відбору:
          на телефоні три плитки-лічильники, а тут — нічого. Число поруч
          з підписом стоїть з тієї ж причини, з якої воно стоїть у плитці:
          вкладка «Без замовлень» без цифри не каже, чи є кого дивитись. */}
      {customers.length > 0 && (
        <div className="wtabs mb-4 hidden lg:flex">
          {([
            ['all', '/app/customers', stats.all],
            ['month', '/app/customers?filter=month', stats.month],
            ['idle', '/app/customers?filter=idle', stats.idle],
          ] as const).map(([key, href, n]) => (
            <button key={key} type="button" className="wtab"
                    data-active={active === key ? 'true' : undefined}
                    onClick={() => router.push(href)}>
              {t(`customers.stats.${key}`)}
              <span className="tabular ml-1.5" style={{ color: 'var(--color-faint)' }}>
                {t.number(n)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* README, розділ G: рядок клієнта — аватар, ім'я, бейдж категорії,
          останній візит, статистика. Телефона в этой строке НЕТ и быть
          не может: контакт отдаёт `customer_card` с проверкой права
          и записью в журнал доступа (0090), а строка списка обошла бы
          и то, и другое. Всё остальное из макета на месте.

          Аватар — буква имени на плашке, а не картинка: колонки под фото
          у клиента нет, и пустой серый кружок был бы честнее только на вид. */}
      {/* README, розділ G: над списком клиентов стоит статистика.

          ⚠️ НАДЗАГОЛОВКА «КЛІЄНТИ» НАД НЕЙ БОЛЬШЕ НЕТ. Экран уже назван
          дважды — строкой в шапке и подписью в нижней панели, — и третья
          подпись занимала ряд, ничего не добавляя.

          Числа кликабельные: плитка, сообщающая «без замовлень: 12»
          и не дающая их увидеть, заставляет искать этих двенадцать
          глазами по списку. Выбранная подсвечивается (`aria-pressed`) —
          иначе после нажатия непонятно, что сейчас показано. */}
      <section className="rise mb-3 grid grid-cols-3 gap-2 lg:hidden">
        <button type="button" className="metric" aria-pressed={active === 'all'}
                onClick={() => router.push('/app/customers')}>
          <span className="metric-value tabular">{t.number(stats.all)}</span>
          <span className="metric-label">{t('customers.stats.all')}</span>
        </button>
        <button type="button" className="metric" data-tone="emerald"
                aria-pressed={active === 'month'}
                onClick={() => router.push('/app/customers?filter=month')}>
          <span className="metric-value tabular">{t.number(stats.month)}</span>
          <span className="metric-label">{t('customers.stats.month')}</span>
        </button>
        <button type="button" className="metric" data-tone="amber"
                aria-pressed={active === 'idle'}
                onClick={() => router.push('/app/customers?filter=idle')}>
          <span className="metric-value tabular">{t.number(stats.idle)}</span>
          <span className="metric-label">{t('customers.stats.idle')}</span>
        </button>
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
        {/* README, розділ G: аватар + імʼя + бейдж категорії + останній
            візит; знизу окремим рядком статистика по клієнту.

            Дві смуги замість однієї не косметика: раніше «останній візит»,
            сума і число замовлень стояли в один ряд з імʼям, і на 390px
            імʼя лишалося з сотнею пікселів — «Олена Пе…» замість людини.
            Тепер верхня смуга відповідає «хто це», нижня — «скільки він
            нам приніс», і жодна з них не тисне другу. */}
        <div className="rise-1 flex flex-col gap-2 lg:hidden">
          {customers.map((c) => (
            <button key={c.id} type="button"
                    className="list-card !flex-col !items-stretch gap-2"
                    disabled={busy === c.id}
                    onClick={() => void openCard(c.id, 'sheet')}>
              <span className="flex items-center gap-3">
                <span aria-hidden className="thumb-sm t-md"
                      style={{
                        fontWeight: 650,
                        background: 'var(--color-accent-soft)',
                        color: 'var(--color-accent-ink)',
                      }}>
                  {c.name.trim().charAt(0).toUpperCase()}
                </span>
                {/* Имя и метка категории — ОДНОЙ строкой, как в макете.
                    Перенос метки под имя добавлял карточке третью строку
                    ради двух слов и ломал выравнивание с датой справа. */}
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {/* Имя клиента — данные заклада, не переводится. */}
                  <span className="t-md truncate">{c.name}</span>
                  {(c.tags ?? []).slice(0, 1).map((tag) => (
                    <span key={tag} className="badge shrink-0">{tag}</span>
                  ))}
                </span>
                <span className="shrink-0 text-right">
                  <span className="t-xs block prose-muted">
                    {t('customers.web.table.last')}
                  </span>
                  <span className="tabular t-md block">
                    {c.last_order_at ? t.date(c.last_order_at) : t('common.noValue')}
                  </span>
                </span>
                {/* Шеврон обязателен: карточка открывается ЗАПРОСОМ к базе
                    и оставляет строку в журнале доступа. Строка, которая
                    выглядит как текст, но что-то делает, — это случайные
                    открытия в журнале, по которому потом разбираются,
                    кто смотрел контакты. */}
                <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                  {busy === c.id ? '…' : <IconChevronRight size={16} />}
                </span>
              </span>

              {/* Нижняя смуга — только у тех, у кого есть что показать:
                  у только что заведённой карточки оба числа нулевые,
                  и линия с двумя нулями сообщает лишь то, что клиент
                  новый, — это уже видно по отсутствию даты визита. */}
              {Number(c.orders_count) > 0 && (
                <>
                  <span className="divider" />
                  <span className="tabular t-xs flex flex-wrap gap-4">
                    <span>
                      <span className="prose-muted">{t('customers.card.orders')}: </span>
                      {t.number(Number(c.orders_count))}
                    </span>
                    <span>
                      <span className="prose-muted">{t('customers.card.spent')}: </span>
                      <span style={{ color: 'var(--color-accent-ink)' }}>
                        {t.money(Number(c.total_spent))}
                      </span>
                    </span>
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* Выгрузка — ПОСЛЕ списка и обводкой, а не в шапке экрана.
            Это самое опасное действие раздела: одним нажатием уходит вся
            база, и каждый вызов пишется в журнал доступа. Кнопка,
            стоящая первой строкой над списком, ровно поэтому и не должна
            быть первым, что попадает под палец, — но и прятать её нельзя:
            «данные клиента — его собственность с выгрузкой в любой
            момент» записано в условия сделки. */}
        {customers.length > 0 && (
          <button type="button" className="btn-secondary mt-3 lg:hidden"
                  disabled={busy === 'export'}
                  onClick={() => void exportAll()}>
            {busy === 'export' ? t('common.saving') : t('customers.export.cta')}
          </button>
        )}

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
                    {/* Имя и метка — ОДНОЙ строкой, как в §3. Меткой под
                        именем строка становилась двухъярусной у одних
                        клиентов и одноярусной у других, и таблица шла
                        рваным шагом: 48px, 64px, 48px. */}
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Имя клиента — данные заклада, не переводится. */}
                      <span className="truncate font-semibold"
                            style={{ color: 'var(--color-text)' }}>{c.name}</span>
                      {(c.tags ?? []).slice(0, 1).map((tag) => (
                        <span key={tag} className="badge shrink-0">{tag}</span>
                      ))}
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
              {/* Подвал §3 говорит «Всього клієнтів: 248», и наш обязан
                  говорить то же — но ЧЕСТНО: список обрезан сотней строк,
                  а счётчик приходит по всей базе и по текущему отбору
                  (см. `page.tsx`). «Разом: 7» под семью видимыми строками
                  у заведения с двумя сотнями клиентов — не подвал, а
                  повтор того, что и так на экране. */}
              <div className="wtable-foot">
                <span className="tabular">
                  {t('customers.web.table.shown', {
                    shown: t.number(customers.length),
                    total: t.number(
                      active === 'month' ? stats.month : active === 'idle' ? stats.idle : stats.all,
                    ),
                  })}
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

      {/* Главное действие раздела — плавающей кнопкой, как на складе
          (М31) и в заказах: клиента заводят, пока он на линии, а не
          дойдя до конца сотни строк. Полосы с кнопкой над списком
          больше нет — она занимала ряд там, где макет показывает
          статистику. */}
      {canWrite && (
        <button type="button" className="fab-wide lg:hidden"
                onClick={() => setAdding(true)}>
          <IconPlus size={18} />
          {t('customers.add.cta')}
        </button>
      )}

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
