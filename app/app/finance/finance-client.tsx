'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { noteIfImmutable } from '@/lib/security-log'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { IconList, IconMinus, IconMoney, IconPlus } from '@/components/icons'

export type FinanceKind = 'income' | 'expense'

export type FinanceRecord = {
  id: string
  kind: FinanceKind
  amount: number
  note: string | null
  occurredOn: string
  categoryId: string | null
  orderId: string | null
  orderNumber: number | null
}

export type FinanceCategory = {
  id: string
  kind: FinanceKind
  name: string
  isActive: boolean
}

// Значения периода уезжают в адрес (`?period=30d`) и разбираются
// на сервере — они служебные и не переводятся. Переводится подпись.
const PERIODS = ['month', 'prev', '30d'] as const
type Period = (typeof PERIODS)[number]

// Своих `money` и `day` больше нет.
//
// `money` подставляла «₴» руками: символ ставит Intl (`t.money`), иначе
// вторая валюта встанет не с той стороны в английской локали.
//
// `T00:00:00` в дате дописывается намеренно и остаётся: `occurred_on` —
// день без времени, и голая строка «2026-08-16» разбирается как
// UTC-полночь, то есть западнее Гринвича показывалась бы предыдущим днём.
const DAY_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'long', year: 'numeric',
}
const day = (t: T, s: string) => t.date(`${s}T00:00:00`, DAY_OPTS)

// ── CRESKO Web §15 ──────────────────────────────────────────────────────
// Вкладки вида. Значение служебное (по нему идёт отбор), переводится подпись.
const VIEWS = ['all', 'income', 'expense'] as const
type View = (typeof VIEWS)[number]

// График «Динаміка доходу». Размеры в единицах viewBox: SVG растягивается
// по ширине карточки, и жёсткие пиксели здесь были бы враньём — считается
// всё от этих четырёх чисел.
const CH = { w: 620, h: 220, left: 52, right: 10, top: 12, bottom: 30 }
const PLOT_W = CH.w - CH.left - CH.right
const PLOT_H = CH.h - CH.top - CH.bottom
const BASE_Y = CH.top + PLOT_H

/**
 * Кривая дохода по дням. Сглаживание — кубическими Безье через средние
 * точки (тот же приём, что у спарклайна на «Сьогодні»): ломаная из
 * тридцати отрезков читается как шум, а не как динамика.
 *
 * Отдельным компонентом, потому что это единственное место экрана,
 * где считается геометрия, — и её не должно быть видно в разметке.
 */
function IncomeChart({ t, series }: { t: T; series: { day: string; value: number }[] }) {
  const values = series.map((s) => s.value)
  const max = Math.max(1, ...values)
  const pts = series.map((s, i) => [
    CH.left + (series.length > 1 ? (i / (series.length - 1)) * PLOT_W : PLOT_W / 2),
    BASE_Y - (s.value / max) * PLOT_H,
  ] as const)
  const path = pts.reduce((acc, p, i, a) => {
    if (i === 0) return `M ${p[0]} ${p[1]}`
    const prev = a[i - 1]
    const mx = (prev[0] + p[0]) / 2
    return `${acc} C ${mx} ${prev[1]}, ${mx} ${p[1]}, ${p[0]} ${p[1]}`
  }, '')
  // Подписей оси снизу не больше шести: на тридцати днях они слипаются
  // в серую полосу, и ось перестаёт отвечать на вопрос «когда это было».
  const step = Math.max(1, Math.ceil(series.length / 6))

  return (
    <svg viewBox={`0 0 ${CH.w} ${CH.h}`} className="w-full" style={{ height: 'auto' }}
         role="img" aria-label={t('finance.web.chart.title')}>
      {/* Сетка: четыре промежутка, пунктиром, и слева значение линии. */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = CH.top + (PLOT_H / 4) * i
        return (
          <g key={i}>
            <line x1={CH.left} y1={y} x2={CH.w - CH.right} y2={y}
                  stroke="var(--web-border-dash, var(--color-border))"
                  strokeWidth="1" strokeDasharray="4 5" />
            <text x={CH.left - 8} y={y + 4} textAnchor="end"
                  style={{ fontSize: 11, fill: 'var(--color-muted)' }}>
              {t.number(Math.round((max / 4) * (4 - i)), { maximumFractionDigits: 0 })}
            </text>
          </g>
        )
      })}
      {/* Заливка — ровно 10% цвета линии: второй токен ради тени под
          кривой развёл бы палитру на цвет и его призрак. */}
      {series.length > 1 && (
        <path d={`${path} L ${CH.w - CH.right} ${BASE_Y} L ${CH.left} ${BASE_Y} Z`}
              fill="var(--tone-emerald)" fillOpacity={0.1} />
      )}
      <path d={path} fill="none" stroke="var(--tone-emerald)" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3.2" fill="var(--tone-emerald)" />
      ))}
      {series.map((s, i) => (
        i % step === 0 || i === series.length - 1 ? (
          <text key={s.day} x={pts[i][0]} y={CH.h - 8} textAnchor="middle"
                style={{ fontSize: 11, fill: 'var(--color-muted)' }}>
            {t.date(`${s.day}T00:00:00`, { day: 'numeric', month: 'short' })}
          </text>
        ) : null
      ))}
    </svg>
  )
}

export function FinanceClient({
  tenantId, userId, canWrite, period, from, to, today,
  income, expense, prevIncome, prevExpense, operations, series,
  records, categories, error,
}: {
  tenantId: string
  userId: string
  canWrite: boolean
  period: string
  from: string
  to: string
  today: string
  income: number
  expense: number
  /** Итоги ПРЕДЫДУЩЕГО сопоставимого периода — только ради дельты. */
  prevIncome: number
  prevExpense: number
  /** Число записей за период (по итоговому запросу, не по списку). */
  operations: number
  /** Доход по дням периода для графика. */
  series: { day: string; value: number }[]
  records: FinanceRecord[]
  categories: FinanceCategory[]
  error: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // Форма записи и справочник категорий живут ШТОРКАМИ, а не блоками
  // на странице (README, розділ G: «кнопка "Додати транзакцію"»).
  // Раскрытая форма из четырёх полей занимала первый экран телефона
  // целиком, и журнал — то, ради чего сюда заходят, — начинался
  // за сгибом. Вносят запись раз в день, смотрят журнал — постоянно.
  const [adding, setAdding] = useState(false)
  const [cats, setCats] = useState(false)
  // Вкладка вида — состояние экрана, а не адреса, и это осознанно.
  // Периодом отбирает СЕРВЕР (он же считает итоги), а вкладка сужает уже
  // загруженное окно периода: второй запрос ради «показать только доходы»
  // из того же набора — это лишняя секунда до Ирландии на каждое нажатие.
  const [view, setView] = useState<View>('all')

  // Форма записи
  const [kind, setKind] = useState<FinanceKind>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')

  // Правка существующей записи: только то, что разрешает finance_records_guard.
  const [editing, setEditing] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')
  const [editCategory, setEditCategory] = useState('')

  // Справочник категорий
  const [catName, setCatName] = useState('')
  const [catKind, setCatKind] = useState<FinanceKind>('expense')

  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  )

  async function addRecord(e: React.FormEvent) {
    e.preventDefault()
    setBusy('record'); setErr('')
    const { error: insertError } = await supabase.from('finance_records').insert({
      tenant_id: tenantId,
      kind,
      amount: Number(amount.replace(',', '.')),
      category_id: categoryId || null,
      occurred_on: date,
      note: note.trim() || null,
      created_by: userId,
    })
    setBusy(null)
    if (insertError) { setErr(dbErrorText(t, insertError)); return }
    setAmount(''); setNote(''); setCategoryId('')
    setAdding(false)
    router.refresh()
  }

  // Вместо удаления — встречная запись. Сумма та же, вид противоположный:
  // после неё период сходится к нулю по ошибочной паре, а обе строки
  // остаются в журнале. Категорию не переносим — она привязана к виду.
  function startReverse(r: FinanceRecord) {
    setKind(r.kind === 'income' ? 'expense' : 'income')
    setAmount(String(r.amount))
    setCategoryId('')
    setDate(today)
    // Заготовка нотатки — текст ДЛЯ ЧЕЛОВЕКА: он видит её в поле и правит
    // до сохранения. Две развилки — две строки целиком, а не общая плюс
    // хвост. Сама нотатка записи (`r.note`) — данные, она не переводится.
    setNote(r.note
      ? t('finance.reverse.noteWith', { date: day(t, r.occurredOn), note: r.note })
      : t('finance.reverse.note', { date: day(t, r.occurredOn) }))
    setErr('')
    // Встречная запись — это тоже новая запись, и заполненную заготовку
    // человек обязан увидеть, а не искать её на странице: шторка
    // открывается сама.
    setAdding(true)
  }

  function startEdit(r: FinanceRecord) {
    setEditing(r.id)
    setEditNote(r.note ?? '')
    setEditCategory(r.categoryId ?? '')
    setErr('')
  }

  async function saveEdit(id: string) {
    setBusy(id); setErr('')
    const { error: updateError } = await supabase.from('finance_records')
      .update({ note: editNote.trim() || null, category_id: editCategory || null })
      .eq('id', id)
    setBusy(null)
    if (updateError) {
      // Сторож финансовой записи (0007) роняет транзакцию: сумму, вид
      // и принадлежность править нельзя, только заметку и категорию.
      // Изнутри упавшей транзакции событие не записать — оно откатится
      // вместе с ней, поэтому пишем отсюда (0085, решение 4).
      void noteIfImmutable(supabase, updateError.message, 'фінансовий запис', tenantId)
      setErr(dbErrorText(t, updateError)); return
    }
    setEditing(null)
    router.refresh()
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    setBusy('category'); setErr('')
    const { error: insertError } = await supabase.from('finance_categories').insert({
      tenant_id: tenantId, kind: catKind, name: catName.trim(),
    })
    setBusy(null)
    if (insertError) { setErr(dbErrorText(t, insertError)); return }
    setCatName(''); router.refresh()
  }

  async function toggleCategory(c: FinanceCategory) {
    setBusy(c.id); setErr('')
    const { error: updateError } = await supabase.from('finance_categories')
      .update({ is_active: !c.isActive }).eq('id', c.id)
    setBusy(null)
    if (updateError) { setErr(dbErrorText(t, updateError)); return }
    router.refresh()
  }

  const formCategories = categories.filter((c) => c.kind === kind && c.isActive)
  const balance = income - expense

  // Дельта к прошлому периоду. `null` — когда сравнивать не с чем: подпись
  // «+100 %» у заведения, которое в прошлом месяце не работало вовсе, —
  // это не рост, а деление на ноль в человеческом виде. Меньше процента
  // тоже не показываем: «+0 %» занимает строку и не сообщает ничего.
  const delta = (now: number, before: number) => {
    if (before <= 0) return null
    const pct = ((now - before) / before) * 100
    if (Math.abs(pct) < 1) return null
    const up = pct > 0
    return {
      up,
      text: t(up ? 'finance.web.delta.up' : 'finance.web.delta.down',
        { value: t.percent(Math.round(Math.abs(pct))) }),
    }
  }
  const dIncome = delta(income, prevIncome)
  const dExpense = delta(expense, prevExpense)
  const dBalance = delta(balance, prevIncome - prevExpense)

  // Что показывает таблица десктопа: вкладка сужает уже загруженное окно.
  const shown = view === 'all' ? records : records.filter((r) => r.kind === view)
  // Колонки таблицы транзакций. Пятая — действия, и она есть только
  // у того, кто имеет право писать: строка с пустой колонкой под кнопки
  // выглядит как отобранная функция, а не как её отсутствие.
  const TGRID = canWrite ? '1.7fr .9fr .9fr .8fr auto' : '1.7fr .9fr .9fr .8fr'

  return (
    <div className="flex flex-col gap-4">
      {/* ═══ CRESKO Web, §15 «Фінанси» — хедер экрана, ТОЛЬКО lg ═════════
          Плашка со значком, имя экрана тем же ключом, которым его называют
          панель и вкладка браузера, подпись под ним. Справа — те же два
          действия, что и в мобильной полосе ниже: они не дублируются,
          а переезжают (мобильная полоса под `lg:hidden`). */}
      <div className="mb-1 hidden items-center justify-between gap-4 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconMoney size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1" data-size="27">{t('app.screen.finance.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.finance.desc')}
            </p>
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-secondary"
                    onClick={() => setCats(true)}>
              {t('finance.categories.title')}
            </button>
            <button type="button" className="btn-primary"
                    onClick={() => { setErr(''); setAdding(true) }}>
              {t('finance.add.cta')}
            </button>
          </div>
        )}
      </div>

      {/* Период — одной строкой с прокруткой, дата подписью под ней:
          три чипа и диапазон в одной строке на 390px не помещались,
          и диапазон переносился под чип, читаясь как его подпись. */}
      <div className="scroll-x rise -mx-4 flex items-center gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {PERIODS.map((p: Period) => (
          <button key={p}
                  className={`${period === p ? 'chip-active' : 'chip'} shrink-0`}
                  onClick={() => router.push(`/app/finance?period=${p}`)}>
            {t(`finance.period.${p}`)}
          </button>
        ))}
      </div>
      <p className="tabular t-xs rise -mt-2 prose-muted">{day(t, from)} — {day(t, to)}</p>

      {/* Вкладки вида — только lg. На телефоне их нет намеренно: полоса
          периода уже стоит выше, и вторая полоса чипов рядом с ней
          превращает первый экран в набор переключателей. */}
      <div className="wtabs hidden lg:flex">
        {VIEWS.map((v) => (
          <button key={v} type="button" className="wtab" data-active={view === v}
                  onClick={() => setView(v)}>
            {t(`finance.web.tab.${v}`)}
          </button>
        ))}
      </div>

      {/* ── CRESKO Web §15: четыре метрики (только lg) ────────────────
          Четвёртая — число операций, а не «Готівка»: наличных как
          отдельной величины в продукте нет, и плитка с ними была бы
          утверждением о деньгах, которого база не подтверждает.
          Подпись под числом — дельта к прошлому периоду, и она стоит
          только там, где есть с чем сравнивать (см. `delta` выше). */}
      <section className="hidden gap-4 lg:grid lg:grid-cols-4">
        <div className="wmetric">
          <div className="min-w-0">
            <p className="wmetric-label">{t('finance.total.income')}</p>
            <p className="wmetric-value tabular">{t.money(income)}</p>
            {dIncome && <p className="wmetric-note">{dIncome.text}</p>}
          </div>
          <span aria-hidden className="wmetric-icon" data-tone="emerald">
            <IconPlus size={18} />
          </span>
        </div>
        <div className="wmetric">
          <div className="min-w-0">
            <p className="wmetric-label">{t('finance.total.expense')}</p>
            <p className="wmetric-value tabular">{t.money(expense)}</p>
            {dExpense && <p className="wmetric-note">{dExpense.text}</p>}
          </div>
          <span aria-hidden className="wmetric-icon" data-tone="rose">
            <IconMinus size={18} />
          </span>
        </div>
        <div className="wmetric">
          <div className="min-w-0">
            <p className="wmetric-label">{t('finance.web.metric.profit')}</p>
            {/* Минус — единственное место, где цвет числа обязателен:
                «−12 000» нейтральным цветом читается как сумма, а не
                как убыток. */}
            <p className="wmetric-value tabular"
               style={balance < 0 ? { color: 'var(--color-danger)' } : undefined}>
              {t.money(balance)}
            </p>
            {dBalance && <p className="wmetric-note">{dBalance.text}</p>}
          </div>
          <span aria-hidden className="wmetric-icon" data-tone={balance < 0 ? 'rose' : 'blue'}>
            <IconMoney size={18} />
          </span>
        </div>
        <div className="wmetric">
          <div className="min-w-0">
            <p className="wmetric-label">{t('finance.web.metric.operations')}</p>
            <p className="wmetric-value tabular">{t.number(operations)}</p>
          </div>
          <span aria-hidden className="wmetric-icon" data-tone="violet">
            <IconList size={18} />
          </span>
        </div>
      </section>

      {/* README, розділ G: «Метрики доходів/витрат». Плитками, а не тремя
          карточками с кеглем 24: на телефоне те занимали три экрана в высоту
          ради трёх чисел. Цвет несёт смысл и здесь: доход зелёным, расход
          красным, итог акцентом — и красным, когда он ушёл в минус. */}
      <section className="rise-1 grid grid-cols-3 gap-2 lg:hidden">
        <div className="metric" data-tone="emerald">
          <span className="metric-value tabular">{t.money(income)}</span>
          <span className="metric-label">{t('finance.total.income')}</span>
        </div>
        <div className="metric" data-tone="rose">
          <span className="metric-value tabular">{t.money(expense)}</span>
          <span className="metric-label">{t('finance.total.expense')}</span>
        </div>
        <div className="metric" data-tone={balance < 0 ? 'rose' : 'blue'}>
          <span className="metric-value tabular">{t.money(balance)}</span>
          <span className="metric-label">{t('finance.total.balance')}</span>
        </div>
      </section>

      {canWrite && (
        <div className="rise-1 flex gap-2 lg:hidden">
          <button type="button" className="btn-primary flex-1"
                  onClick={() => { setErr(''); setAdding(true) }}>
            {t('finance.add.cta')}
          </button>
          <button type="button" className="btn-secondary"
                  onClick={() => setCats(true)}>
            {t('finance.categories.title')}
          </button>
        </div>
      )}

      {/* Тексты отказов базы подставляются как есть; из словаря — рамка. */}
      {error && <p className="field-error rise">{t('finance.error.load', { message: error })}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* ═══ CRESKO Web §15: нижний ряд 1.05fr / 1fr — ТОЛЬКО lg ════════
          Слева динамика дохода, справа журнал транзакций. Ряд, а не два
          блока подряд: график без строк рядом не отвечает на «а что это
          был за день», а строки без графика не показывают форму месяца. */}
      <div className="hidden gap-5 lg:grid" style={{ gridTemplateColumns: '1.05fr 1fr' }}>
        {/* Подпись НАД карточкой, а не внутри: справа такая же подпись
            стоит над таблицей, у которой своя рамка, — внутри карточки
            они встали бы на разной высоте и ряд перестал бы читаться
            как ряд. */}
        <section className="min-w-0">
          <p className="webh2 mb-3">{t('finance.web.chart.title')}</p>
          <div className="webcard">
            {series.some((s) => s.value > 0)
              ? <IncomeChart t={t} series={series} />
              : <p className="t-sm prose-muted">{t('finance.web.chart.empty')}</p>}
          </div>
        </section>

        <section className="min-w-0">
          <p className="webh2 mb-3">{t('finance.web.table.title')}</p>
          <div className="wtable">
            <div className="wtable-head" style={{ gridTemplateColumns: TGRID }}>
              <span>{t('finance.web.table.operation')}</span>
              <span>{t('finance.web.table.category')}</span>
              <span>{t('finance.web.table.amount')}</span>
              <span>{t('finance.web.table.date')}</span>
              {canWrite && <span />}
            </div>

            {shown.length === 0 ? (
              <div className="empty !py-8">{t('finance.web.table.empty')}</div>
            ) : shown.map((r, i) => {
              const category = r.categoryId ? catById.get(r.categoryId) : undefined
              const positive = r.kind === 'income'
              // Последняя строка отдаёт свою черту подвалу таблицы:
              // `:last-of-type` из `.wtable-row` здесь не сработает —
              // строки завёрнуты в обёртку записи, и последний ребёнок
              // таблицы это обёртка, а не строка.
              const last = i === shown.length - 1
              return (
                // Обёртка на запись, а не на строку: под строкой раскрывается
                // правка нотатки, и она обязана держаться своей записи при
                // любом отборе вкладкой.
                <div key={r.id}>
                  <div className="wtable-row"
                       style={{
                         gridTemplateColumns: TGRID,
                         minHeight: 'var(--tap-min)',
                         borderBottom: last && editing !== r.id ? 'none' : undefined,
                       }}>
                    <span className="flex min-w-0 items-center gap-3">
                      {/* Кружок тоном вида: плюс зелёным, минус красным.
                          Цвет здесь тот же язык, что у суммы справа, —
                          глаз ловит вид записи, не читая ни слова. */}
                      <span aria-hidden className="wmetric-icon"
                            data-tone={positive ? 'emerald' : 'rose'}
                            style={{ width: 32, height: 32, borderRadius: 10 }}>
                        {positive ? <IconPlus size={15} /> : <IconMinus size={15} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold"
                              style={{ color: 'var(--color-text)' }}>
                          {category?.name ?? (r.note ? r.note : t('finance.form.category.none'))}
                        </span>
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {r.orderId
                            ? (r.orderNumber !== null
                                ? t('finance.record.orderNumber', { number: r.orderNumber })
                                : t('finance.record.orderLink'))
                            : (category && r.note ? r.note : t(`finance.form.${r.kind}`))}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0">
                      {category
                        ? <span className="badge">{category.name}</span>
                        : <span style={{ color: 'var(--color-faint)' }}>{t('common.noValue')}</span>}
                    </span>
                    <span className="tabular font-semibold"
                          style={{ color: positive ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {positive ? '+' : '−'}{t.money(r.amount)}
                    </span>
                    <span className="tabular">{t.date(`${r.occurredOn}T00:00:00`)}</span>
                    {canWrite && (
                      <span className="flex justify-end gap-1">
                        <button type="button" className="btn-ghost t-sm"
                                onClick={() => startEdit(r)}>{t('finance.record.editNote')}</button>
                        <button type="button" className="btn-ghost t-sm"
                                onClick={() => startReverse(r)}>{t('finance.record.reverse')}</button>
                      </span>
                    )}
                  </div>

                  {editing === r.id && (
                    <div className="grid gap-3 px-4 py-3 sm:grid-cols-3"
                         style={{
                           borderBottom: last
                             ? 'none'
                             : '1px solid var(--web-border-row, var(--color-border))',
                           background: 'var(--web-hover-soft, var(--color-surface-2))',
                         }}>
                      <div className="sm:col-span-2">
                        <label className="field-label">{t('finance.form.note.label')}</label>
                        <input className="input" value={editNote}
                               onChange={(e) => setEditNote(e.target.value)} />
                      </div>
                      <div>
                        <label className="field-label">{t('finance.form.category.label')}</label>
                        <select className="select" value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value)}>
                          <option value="">{t('finance.form.category.none')}</option>
                          {categories.filter((c) => c.kind === r.kind).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.isActive
                                ? c.name
                                : t('finance.category.hiddenOption', { name: c.name })}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-3 flex flex-wrap gap-2">
                        <button type="button" className="btn-primary t-md" disabled={busy === r.id}
                                onClick={() => void saveEdit(r.id)}>{t('common.save')}</button>
                        <button type="button" className="btn-secondary t-md"
                                onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                        <span className="t-xs self-center prose-muted">
                          {t('finance.record.edit.hint')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {shown.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('finance.web.table.total', { n: t.number(shown.length) })}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Журнал — отдельными карточками, как везде в кабинете.
          На широком экране его заменяет таблица выше — двух списков
          одних и тех же записей на экране быть не должно. */}
      <div className="contents lg:hidden">
      {records.length === 0 ? (
        <section className="card rise-2">
          <div className="empty">
            <span className="empty-icon"><IconMoney size={24} /></span>
            <p className="empty-title">{t('finance.empty')}</p>
            {canWrite && (
              <button type="button" className="btn-primary"
                      onClick={() => setAdding(true)}>{t('finance.add.cta')}</button>
            )}
          </div>
        </section>
      ) : (
        <div className="rise-2 flex flex-col gap-2">
          {records.map((r) => {
            const category = r.categoryId ? catById.get(r.categoryId) : undefined
            return (
              <div key={r.id} className="card !p-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="t-md flex flex-wrap items-center gap-2">
                      <span className="truncate">
                        {category?.name ?? (r.note ? r.note : t('finance.form.category.none'))}
                      </span>
                      {/* Автозапись триггера orders_income_record: продавец
                          не вносил её руками, и это должно быть видно. */}
                      {r.orderId && (
                        <span className="badge-accent">{t('finance.record.fromOrder')}</span>
                      )}
                    </span>
                    <span className="tabular t-xs mt-0.5 block prose-muted">
                      {day(t, r.occurredOn)}
                      {category && r.note ? ` · ${r.note}` : ''}
                      {r.orderId && (
                        <>
                          {' · '}
                          <Link href={`/app/orders/${r.orderId}`} className="underline">
                            {r.orderNumber !== null
                              ? t('finance.record.orderNumber', { number: r.orderNumber })
                              : t('finance.record.orderLink')}
                          </Link>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="tabular t-md shrink-0"
                        style={{ color: r.kind === 'income' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {r.kind === 'income' ? '+' : '−'}{t.money(r.amount)}
                  </span>
                </div>

                {canWrite && (
                  <div className="flex gap-1 border-t px-2 py-1"
                       style={{ borderColor: 'var(--color-border)' }}>
                    <button className="btn-ghost t-sm"
                            onClick={() => startEdit(r)}>{t('finance.record.editNote')}</button>
                    <button className="btn-ghost t-sm"
                            onClick={() => startReverse(r)}>{t('finance.record.reverse')}</button>
                  </div>
                )}

                {editing === r.id && (
                  <div className="grid gap-3 border-t px-4 py-3 sm:grid-cols-3"
                       style={{ borderColor: 'var(--color-border)' }}>
                    <div className="sm:col-span-2">
                      <label className="field-label">{t('finance.form.note.label')}</label>
                      <input className="input" value={editNote}
                             onChange={(e) => setEditNote(e.target.value)} />
                    </div>
                    <div>
                      <label className="field-label">{t('finance.form.category.label')}</label>
                      <select className="select" value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}>
                        <option value="">{t('finance.form.category.none')}</option>
                        {categories.filter((c) => c.kind === r.kind).map((c) => (
                          <option key={c.id} value={c.id}>
                            {/* Название категории — данные заведения, оно
                                не переводится; переводится только пометка. */}
                            {c.isActive
                              ? c.name
                              : t('finance.category.hiddenOption', { name: c.name })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3 flex flex-wrap gap-2">
                      <button className="btn-primary t-md" disabled={busy === r.id}
                              onClick={() => void saveEdit(r.id)}>{t('common.save')}</button>
                      <button className="btn-secondary t-md"
                              onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                      <span className="t-xs self-center prose-muted">
                        {t('finance.record.edit.hint')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>

      <p className="field-hint">{t('finance.hint')}</p>

      {/* ── Новая запись ─────────────────────────────────────── */}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t('finance.add.cta')}>
        {err && <p className="field-error mb-3">{err}</p>}
        <form onSubmit={addRecord} className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setKind('expense'); setCategoryId('') }}
                    className={kind === 'expense' ? 'chip-active' : 'chip'}>
              {t('finance.form.expense')}
            </button>
            <button type="button" onClick={() => { setKind('income'); setCategoryId('') }}
                    className={kind === 'income' ? 'chip-active' : 'chip'}>
              {t('finance.form.income')}
            </button>
          </div>

          <div>
            <label className="field-label" htmlFor="fin-amount">
              {t('finance.form.amount.label')}
            </label>
            <input id="fin-amount" required type="number" step="0.01" min="0.01"
                   className="input" value={amount}
                   onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-date">{t('finance.form.date.label')}</label>
            <input id="fin-date" required type="date" className="input" value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-category">
              {t('finance.form.category.label')}
            </label>
            <select id="fin-category" className="select" value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('finance.form.category.none')}</option>
              {formCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fin-note">{t('finance.form.note.label')}</label>
            <input id="fin-note" className="input" value={note}
                   placeholder={t('finance.form.note.placeholder')}
                   onChange={(e) => setNote(e.target.value)} />
          </div>

          <button className="btn-primary sm:col-span-4 sm:justify-self-start"
                  disabled={busy === 'record'}>
            {kind === 'income' ? t('finance.form.submit.income') : t('finance.form.submit.expense')}
          </button>
        </form>
      </Sheet>

      {/* ── Справочник категорий ─────────────────────────────────
          Тоже шторкой: категории заводят один раз при настройке,
          а место на экране они занимали постоянно — и внизу, куда
          ради них приходилось листать весь журнал. */}
      <Sheet open={cats} onClose={() => setCats(false)} title={t('finance.categories.title')}>
        {categories.length === 0 ? (
          <div className="empty !py-6">{t('finance.categories.empty')}</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c.id}
                    className={c.isActive
                      ? (c.kind === 'income' ? 'badge-success' : 'badge-warn')
                      : 'badge'}>
                {c.name}
                {canWrite && (
                  <button className="underline" disabled={busy === c.id}
                          onClick={() => void toggleCategory(c)}>
                    {c.isActive ? t('finance.categories.hide') : t('finance.categories.restore')}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {canWrite && (
          <form onSubmit={addCategory} className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label className="field-label" htmlFor="cat-name">
                {t('finance.categories.new.label')}
              </label>
              <input id="cat-name" required className="input" value={catName}
                     placeholder={t('finance.categories.new.placeholder')}
                     onChange={(e) => setCatName(e.target.value)} />
            </div>
            <select className="select w-40" value={catKind}
                    onChange={(e) => setCatKind(e.target.value === 'income' ? 'income' : 'expense')}>
              <option value="expense">{t('finance.categories.kind.expense')}</option>
              <option value="income">{t('finance.categories.kind.income')}</option>
            </select>
            <button className="btn-secondary shrink-0"
                    disabled={!catName.trim() || busy === 'category'}>
              {t('finance.categories.add')}
            </button>
          </form>
        )}
      
      </Sheet>
    </div>
  )
}
