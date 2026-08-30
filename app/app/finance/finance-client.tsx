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
import {
  IconCalendar, IconChevronRight, IconList, IconMinus, IconMoney, IconPlus,
} from '@/components/icons'

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
  /** Постоянный расход (аренда) против переменного (материалы) — 0121. */
  isFixed: boolean
}

export type PnlRow = {
  /** Первое число месяца строкой ГГГГ-ММ-ДД. */
  bucket: string
  income: number
  expenseFixed: number
  expenseVariable: number
  net: number
}

export type MarginRow = {
  variantId: string
  kind: 'product' | 'service'
  title: string
  variantName: string
  price: number | null
  /** Своя себестоимость + рецептура (variant_margin_view, 0121). */
  unitCost: number
  margin: number | null
  marginPct: number | null
  /** Сколько расходников рецептуры БЕЗ себестоимости: >0 — маржа завышена. */
  missingCosts: number
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

// Подпись группы журнала. Короче полной даты и с днём недели: год
// повторять у каждой группы незачем (он уже назван диапазоном периода
// выше), а вот «сб» отвечает на вопрос, который в салоне задают
// постоянно, — в какие дни идут деньги.
const DAY_HEAD_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short', day: 'numeric', month: 'long',
}
const dayHead = (t: T, s: string) => t.date(`${s}T00:00:00`, DAY_HEAD_OPTS)

// ── CRESKO Web §15 ──────────────────────────────────────────────────────
// Вкладки вида. Значение служебное (по нему идёт отбор), переводится подпись.
const VIEWS = ['all', 'income', 'expense', 'analytics'] as const
type View = (typeof VIEWS)[number]

// График «Динаміка доходу». Размеры в единицах viewBox: SVG растягивается
// по ширине карточки, и жёсткие пиксели здесь были бы враньём — считается
// всё от этих четырёх чисел.
const CH = { w: 620, h: 220, left: 52, right: 10, top: 12, bottom: 30 }
const PLOT_W = CH.w - CH.left - CH.right
const PLOT_H = CH.h - CH.top - CH.bottom
const BASE_Y = CH.top + PLOT_H

/**
 * Тренд-стрелка плитки (§15: рост — `success`, спад — `danger`,
 * «без змін» — риска).
 *
 * Рисуется здесь, а не берётся из `components/icons.tsx`, по той же
 * причине, по которой там нет и кривой дохода: это не значок навигации,
 * а элемент ГРАФИКИ этого экрана — три состояния одной величины, у которых
 * общий размер и общая геометрия с кривой ниже. Значок в общем наборе
 * обязан читаться в любом разделе; этот без числа рядом не значит ничего.
 */
function Trend({ dir, color }: { dir: 'up' | 'down' | 'flat'; color: string }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none"
         stroke={color} strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round">
      {dir === 'flat'
        ? <path d="M4 10h12" />
        : dir === 'up'
        ? <><path d="M3.5 13.5L8 9l3 3 4.5-4.5" /><path d="M11.5 7.5h4v4" /></>
        : <><path d="M3.5 6.5L8 11l3-3 4.5 4.5" /><path d="M11.5 12.5h4v-4" /></>}
    </svg>
  )
}

/**
 * Одна плитка метрики §15: сверху плашка 44px и тренд-стрелка справа,
 * ниже подпись, число 25/800 и дельта.
 *
 * Собственная раскладка, а не общий `.wmetric`: тот ставит значок СПРАВА
 * от числа и живёт так на четырёх других экранах. Хендофф просит для
 * финансов другой порядок, и переписать общий класс значило бы сдвинуть
 * четыре чужих экрана ради одного.
 */
function Metric({ label, value, note, tone, icon, trend, good, danger }: {
  label: string; value: string; note?: string
  tone: 'blue' | 'amber' | 'rose' | 'emerald' | 'violet'
  icon: React.ReactNode
  /** Направление изменения — форма стрелки. */
  trend: 'up' | 'down' | 'flat'
  /**
   * Хорошо ли это ДЛЯ ЭТОЙ величины — цвет стрелки и дельты.
   * Разведено с направлением намеренно: выросшие расходы это стрелка
   * вверх и красный, а не зелёный рост.
   */
  good?: boolean
  danger?: boolean
}) {
  const color = trend === 'flat'
    ? 'var(--web-faintest, var(--color-border-strong))'
    : good ? 'var(--color-success)' : 'var(--color-danger)'
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '16px 18px',
    }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <span aria-hidden className="wmetric-icon" data-tone={tone}
              style={{ width: 44, height: 44, borderRadius: 12 }}>
          {icon}
        </span>
        <Trend dir={trend} color={color} />
      </div>
      <p className="wmetric-label">{label}</p>
      {/* Минус — единственное место, где цвет числа обязателен:
          «−12 000» нейтральным цветом читается как сумма, а не как убыток. */}
      <p className="wmetric-value tabular"
         style={danger ? { color: 'var(--color-danger)' } : undefined}>
        {value}
      </p>
      {/* Дельта цветом направления, а не серым: в хендоффе смысл несёт
          именно она, а серая строка под числом читается как сноска. */}
      {note && (
        <p className="wmetric-note"
           style={{ color: trend === 'flat' ? undefined : color }}>
          {note}
        </p>
      )}
    </div>
  )
}

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
  // Потолок шкалы округляется ВВЕРХ до круглого числа (§15: 30k / 20k /
  // 10k / 0). По сырому максимуму подписи выходили вида «13 744» — такую
  // ось не читают, по ней сверяют, а сверять с 13 744 нечего.
  const raw = Math.max(1, ...values)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const max = Math.ceil(raw / pow) * pow
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
                  style={{ fontSize: 12, fill: 'var(--color-faint)' }}>
              {t.number(Math.round((max / 4) * (4 - i)), { maximumFractionDigits: 0 })}
            </text>
          </g>
        )
      })}
      {/* Цвет кривой — `primaryDeep` из хендоффа (§15), а не зелёный «доход»:
          на этом экране зелёное и красное уже заняты видом записи, и третья
          зелёная сущность рядом с плиткой «Дохід» читается как её продолжение.
          Заливка — ровно 10% того же цвета: второй токен ради тени под кривой
          развёл бы палитру на цвет и его призрак. */}
      {series.length > 1 && (
        <path d={`${path} L ${CH.w - CH.right} ${BASE_Y} L ${CH.left} ${BASE_Y} Z`}
              fill="var(--web-primary-deep, var(--color-accent))" fillOpacity={0.1} />
      )}
      <path d={path} fill="none"
            stroke="var(--web-primary-deep, var(--color-accent))" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="4.6"
                fill="var(--web-primary-deep, var(--color-accent))" />
      ))}
      {series.map((s, i) => (
        i % step === 0 || i === series.length - 1 ? (
          <text key={s.day} x={pts[i][0]} y={CH.h - 6} textAnchor="middle"
                style={{ fontSize: 12, fill: 'var(--color-faint)' }}>
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
  records, categories, pnl, margins, error,
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
  /** P&L последних шести месяцев — считает база (0121), не экран. */
  pnl: PnlRow[]
  /** Себестоимость и маржа позиций из variant_margin_view (0121). */
  margins: MarginRow[]
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
  const [catFixed, setCatFixed] = useState(false)

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
      // Деление на постоянные и переменные — только у расходов (0121).
      is_fixed: catKind === 'expense' && catFixed,
    })
    setBusy(null)
    if (insertError) { setErr(dbErrorText(t, insertError)); return }
    setCatName(''); setCatFixed(false); router.refresh()
  }

  async function toggleFixed(c: FinanceCategory) {
    setBusy(c.id); setErr('')
    const { error: updateError } = await supabase.from('finance_categories')
      .update({ is_fixed: !c.isFixed }).eq('id', c.id)
    setBusy(null)
    if (updateError) { setErr(dbErrorText(t, updateError)); return }
    router.refresh()
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

  // Величины столбиков карточки-героя (телефон). Максимум считается по
  // ряду, а не берётся от суммы периода: столбики показывают ФОРМУ
  // периода, и день с максимумом обязан упираться в потолок — иначе
  // у салона с ровным доходом весь ряд прижат к полу и не читается.
  const maxDay = series.reduce((m, s) => (s.value > m ? s.value : m), 0)
  const hasIncome = maxDay > 0

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
  // Форма стрелки: сравнивать не с чем — риска, а не выдуманный рост.
  const dir = (d: { up: boolean } | null): 'up' | 'down' | 'flat' =>
    d === null ? 'flat' : d.up ? 'up' : 'down'

  // Что показывает список: вкладка сужает уже загруженное окно.
  const shown = view === 'all' || view === 'analytics'
    ? records
    : records.filter((r) => r.kind === view)

  // ── ЖУРНАЛ ГРУППИРУЕТСЯ ПО ДНЯМ ─────────────────────────────────────────
  //
  // Бриф владельца 20.08.2026, П2: «сплошной список транзакций без
  // группировки». Это не украшение — это единственное, что отвечает
  // на вопрос, с которым в финансы и заходят: «сколько сегодня вышло».
  // Раньше дата стояла подписью под КАЖДОЙ строкой, то есть повторялась
  // столько раз, сколько было записей в этот день, и всё равно не давала
  // итога дня: его приходилось складывать глазами.
  //
  // Итог дня считается ПО ПОКАЗАННЫМ записям, а не по всем: если сверху
  // выбраны «Витрати», строка дня обязана называть расход этого дня,
  // а не разницу, которой на экране не видно.
  //
  // Порядок дней не пересортировывается: он приходит с сервера
  // (`occurred_on desc`), и вторая сортировка здесь разошлась бы с ним
  // на записях одного дня.
  const byDay = useMemo(() => {
    const out: { day: string; total: number; rows: typeof shown }[] = []
    for (const r of shown) {
      const last = out[out.length - 1]
      const delta = r.kind === 'income' ? r.amount : -r.amount
      if (last && last.day === r.occurredOn) {
        last.total += delta
        last.rows.push(r)
      } else {
        out.push({ day: r.occurredOn, total: delta, rows: [r] })
      }
    }
    return out
  }, [shown])
  // Колонки таблицы транзакций — из хендоффа §15 дословно. Пятая, шеврон
  // 18px, есть только у того, кто имеет право писать: строка со стрелкой,
  // которая ничего не открывает, — сломанная навигация.
  const TGRID = canWrite ? '2fr 1fr .9fr 1.2fr 18px' : '2fr 1fr .9fr 1.2fr'
  // Строка таблицы кнопка ровно тогда, когда есть что открыть.
  const RowTag: React.ElementType = canWrite ? 'button' : 'div'

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
      {/* На широком экране диапазон переезжает В СТРОКУ пилюлей со значком
          календаря (§15) — вместо отдельной серой строчки под чипами.
          Это не второй переключатель: пилюля ничего не открывает, она
          подписывает выбранное. Своя строка под чипами занимала высоту
          и повторяла то, что уже сказал активный чип. */}
      <div className="rise flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <span className="tabular hidden shrink-0 items-center gap-2 lg:inline-flex"
              style={{
                height: 42, padding: '0 16px', borderRadius: 99,
                border: '1px solid var(--color-border-strong)',
                background: 'var(--color-surface)',
                fontSize: 14, fontWeight: 650, color: 'var(--color-text)',
              }}>
          <span aria-hidden style={{ color: 'var(--color-accent-ink)' }}>
            <IconCalendar size={17} />
          </span>
          {day(t, from)} — {day(t, to)}
        </span>
        <div className="scroll-x -mx-4 flex items-center gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
          {PERIODS.map((p: Period) => (
            <button key={p}
                    className={`${period === p ? 'chip-active' : 'chip'} shrink-0`}
                    onClick={() => router.push(`/app/finance?period=${p}`)}>
              {t(`finance.period.${p}`)}
            </button>
          ))}
        </div>
      </div>

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
        <Metric label={t('finance.total.income')} value={t.money(income)}
                note={dIncome?.text} tone="emerald" icon={<IconPlus size={20} />}
                trend={dir(dIncome)} good={dIncome?.up} />
        {/* Выросшие расходы — стрелка ВВЕРХ и красная: направление
            и оценка это разные величины, и склеивать их нельзя. */}
        <Metric label={t('finance.total.expense')} value={t.money(expense)}
                note={dExpense?.text} tone="rose" icon={<IconMinus size={20} />}
                trend={dir(dExpense)} good={dExpense ? !dExpense.up : undefined} />
        <Metric label={t('finance.web.metric.profit')} value={t.money(balance)}
                note={dBalance?.text} tone={balance < 0 ? 'rose' : 'blue'}
                icon={<IconMoney size={20} />}
                trend={dir(dBalance)} good={dBalance?.up} danger={balance < 0} />
        <Metric label={t('finance.web.metric.operations')} value={t.number(operations)}
                tone="violet" icon={<IconList size={20} />} trend="flat" />
      </section>

      {/* ── Картка-герой фінансів (телефон) ───────────────────────────
          Пересобрано 30.08.2026. Было: ряд из трёх равных плиток —
          доход, расход, итог. Три числа одного веса не отвечают на
          вопрос, с которым в финансы заходят с телефона («сколько
          вышло за период»): человек читал все три и складывал глазами,
          какое из них главное.

          Теперь ярусы по убыванию важности, тот же приём, что уже
          стоит на складе (`.hero` с вартістю запасу):

            1. ИТОГ крупно — ответ на вопрос экрана, читается без
               нажатий и без сравнения соседей;
            2. дельта к прошлому периоду строкой под ним — величина
               `dBalance` считалась ЗДЕСЬ ЖЕ и до этого дня показывалась
               ТОЛЬКО на широком экране: с телефона её не было вовсе,
               хотя сервер её присылал;
            3. столбики по дням (`series`) — та же беда: динамика жила
               в `IncomeChart` под `lg:grid`, и владелец с телефона
               форму месяца не видел никогда;
            4. доход и расход — двумя плитками, а не тремя: итог уехал
               наверх, и оставлять его третьим значило показать одно
               число дважды.

          Итог красный, когда ушёл в минус, — это единственное место,
          где цвет здесь несёт состояние, а не украшает. */}
      <section className="hero rise-1 lg:hidden">
        <p className="eyebrow">{t('finance.web.metric.profit')}</p>
        <p className="hero-value mt-1"
           style={balance < 0 ? { color: 'var(--color-danger)' } : undefined}>
          {t.money(balance)}
        </p>
        {/* Дельты нет, когда сравнивать не с чем (`delta` выше отдаёт
            null): пустая строка честнее выдуманного «+0 %». */}
        {dBalance && (
          <p className="t-sm mt-1 font-semibold"
             style={{ color: dBalance.up ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {dBalance.text}
          </p>
        )}

        {/* Столбики рисуем, только когда есть чему подниматься. Ряд
            из одних подложек — это не «график с нулями», а обещание
            показать динамику, которой нет; вместо него та же строка,
            что и на широком экране. */}
        <div className="mt-4">
          {hasIncome ? (
            <div className="spark" role="img" aria-label={t('finance.web.chart.title')}>
              {series.map((s, i) => {
                const empty = s.value <= 0
                return (
                  <span key={s.day} className="spark-bar" data-empty={empty}
                        style={{
                          // Пол в 8% — иначе день с малой суммой рисуется
                          // ниже подложки пустого дня, и «мало» читается
                          // как «ничего». Пустой день — ровно 2px.
                          height: empty ? 2 : `${Math.max(8, (s.value / maxDay) * 100)}%`,
                          // Задержка — от первого дня к последнему, как
                          // читают ряд. Величина вычисляемая, поэтому
                          // разметкой: тот же приём, что в `quick-fab`.
                          animationDelay: `${Math.min(i * 12, 240)}ms`,
                        }} />
                )
              })}
            </div>
          ) : (
            <p className="t-sm prose-muted">{t('finance.web.chart.empty')}</p>
          )}
          {/* Диапазон стоит ЗДЕСЬ и в обеих ветках, а не только под
              столбиками: он приехал сюда отдельной строкой из-под полосы
              периода, и показывать его дважды на одном экране незачем.
              Чипы выше называют период словом («Місяць»), эта строка —
              числами; без неё «Місяць» в последний день августа
              не отличить от «30 днів». */}
          <p className="tabular t-xs mt-2 prose-muted">
            {day(t, from)} — {day(t, to)}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="metric" data-tone="emerald">
            <span className="metric-value tabular">{t.money(income)}</span>
            <span className="metric-label">{t('finance.total.income')}</span>
          </div>
          <div className="metric" data-tone="rose">
            <span className="metric-value tabular">{t.money(expense)}</span>
            <span className="metric-label">{t('finance.total.expense')}</span>
          </div>
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

      {/* ── ВКЛАДКИ ВИДА НА ТЕЛЕФОНЕ ─────────────────────────────────────
          Бриф владельца 20.08.2026 просит ДВЕ вещи: чипы-фильтры по типу
          над списком и вынос P&L с маржой в отдельную вкладку. Здесь это
          ОДНА полоса, а не две: набор `VIEWS` уже содержит и то, и другое,
          и делать рядом «Усі/Доходи/Витрати» плюс «Журнал/Аналітика»
          значило бы завести два переключателя, из которых один всегда
          гасит смысл второго («Витрати» + «Аналітика» — это что?).

          Прежняя запись здесь гласила, что вкладок на телефоне нет
          намеренно, потому что полоса периода уже стоит выше. Отменено
          брифом: полосы всё равно две, но вторая стоит НЕ рядом с первой,
          а вплотную к списку, которым она и управляет.

          Выбор десктопа и телефона общий (`view`) — это одно состояние
          одного экрана, а не два переключателя, которые разъедутся при
          повороте планшета. */}
      <div className="scroll-x rise-1 -mx-4 flex items-center gap-2 px-4 pb-1 lg:hidden">
        {VIEWS.map((v) => (
          <button key={v} type="button"
                  className={`${view === v ? 'chip-active' : 'chip'} shrink-0`}
                  onClick={() => setView(v)}>
            {t(`finance.web.tab.${v}`)}
          </button>
        ))}
      </div>

      {/* ═══ Аналітика (М46): P&L помесячно и маржа позиций — lg ════════
          Живёт ВКЛАДКОЙ, а не отдельным экраном: это те же деньги
          того же заведения, и раздел в панели ради двух таблиц был бы
          девятым пунктом навигации. Считает база (0121). */}
      {view === 'analytics' && (
        <div className="hidden flex-col gap-5 lg:flex">
          <section className="min-w-0">
            <p className="webh2 mb-3">{t('finance.pnl.title')}</p>
            <div className="wtable">
              <div className="wtable-head" style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr' }}>
                <span>{t('finance.pnl.month')}</span>
                <span>{t('finance.pnl.income')}</span>
                <span>{t('finance.pnl.fixed')}</span>
                <span>{t('finance.pnl.variable')}</span>
                <span>{t('finance.pnl.net')}</span>
              </div>
              {pnl.length === 0 ? (
                <div className="empty !py-8">{t('finance.pnl.empty')}</div>
              ) : pnl.map((r) => (
                <div key={r.bucket} className="wtable-row"
                     style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                    {t.date(`${r.bucket}T00:00:00`, { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="tabular">{t.money(r.income)}</span>
                  <span className="tabular">{t.money(r.expenseFixed)}</span>
                  <span className="tabular">{t.money(r.expenseVariable)}</span>
                  <span className="tabular font-semibold"
                        style={{ color: r.net < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {t.money(r.net)}
                  </span>
                </div>
              ))}
            </div>
            {/* Деление работает только когда категории размечены — скажи
                об этом там, где смотрят на нули, а не в документации. */}
            <p className="field-hint mt-2">{t('finance.pnl.hint')}</p>
          </section>

          <section className="min-w-0">
            <p className="webh2 mb-3">{t('finance.margin.title')}</p>
            <div className="wtable">
              <div className="wtable-head" style={{ gridTemplateColumns: '1.8fr .8fr .9fr .9fr .7fr' }}>
                <span>{t('finance.margin.position')}</span>
                <span>{t('finance.margin.price')}</span>
                <span>{t('finance.margin.cost')}</span>
                <span>{t('finance.margin.margin')}</span>
                <span />
              </div>
              {margins.length === 0 ? (
                <div className="empty !py-8">{t('finance.margin.empty')}</div>
              ) : margins.map((r) => (
                <div key={r.variantId} className="wtable-row"
                     style={{ gridTemplateColumns: '1.8fr .8fr .9fr .9fr .7fr' }}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                      {r.title}
                    </span>
                    <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {r.variantName}
                    </span>
                  </span>
                  <span className="tabular">
                    {r.price === null ? t('common.noValue') : t.money(r.price)}
                  </span>
                  <span className="tabular">{t.money(r.unitCost)}</span>
                  <span className="tabular font-semibold"
                        style={{ color: r.margin !== null && r.margin < 0
                          ? 'var(--color-danger)' : 'var(--color-text)' }}>
                    {r.margin === null ? t('common.noValue')
                      : `${t.money(r.margin)}${r.marginPct === null ? '' : ` · ${t.percent(r.marginPct)}`}`}
                  </span>
                  <span>
                    {r.missingCosts > 0 && (
                      <span className="badge-warn">{t('finance.margin.incomplete')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="field-hint mt-2">{t('finance.margin.hint')}</p>
          </section>
        </div>
      )}

      {/* ═══ CRESKO Web §15: нижний ряд 1.05fr / 1fr — ТОЛЬКО lg ════════
          Слева динамика дохода, справа журнал транзакций. Ряд, а не два
          блока подряд: график без строк рядом не отвечает на «а что это
          был за день», а строки без графика не показывают форму месяца. */}
      {view !== 'analytics' && (
      <div className="hidden gap-5 lg:grid" style={{ gridTemplateColumns: '1.05fr 1fr' }}>
        {/* Подпись ВНУТРИ карточки, как в хендоффе: обе карточки ряда
            начинаются на одной высоте, поэтому и заголовки в них встают
            на одной. Прежде подпись стояла НАД карточкой — и ряд из двух
            белых прямоугольников с серыми надписями сверху читался как
            четыре блока, а не как два. */}
        <section className="min-w-0">
          <div className="webcard">
            <p className="webh2 mb-4">{t('finance.web.chart.title')}</p>
            {series.some((s) => s.value > 0)
              ? <IncomeChart t={t} series={series} />
              : <p className="t-sm prose-muted">{t('finance.web.chart.empty')}</p>}
          </div>
        </section>

        <section className="min-w-0">
          <div className="wtable">
            <p className="webh2" style={{ padding: '20px 18px 14px' }}>
              {t('finance.web.table.title')}
            </p>
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
                  {/* Строка целиком — кнопка, а не полоса с двумя текстовыми
                      кнопками справа. Так требует §15 (последняя колонка —
                      шеврон 18px), и так честнее: «Нотатка» открывала ровно
                      то же, что теперь открывает нажатие на строку, то есть
                      дверь в правку лежала на строке дважды. Второе действие,
                      «Зворотний запис», переехало ВНУТРЬ раскрытой правки —
                      к остальным действиям над этой записью. */}
                  <RowTag className="wtable-row"
                       {...(canWrite
                         ? {
                             type: 'button' as const,
                             'aria-expanded': editing === r.id,
                             onClick: () => (editing === r.id ? setEditing(null) : startEdit(r)),
                           }
                         : {})}
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
                        {/* Подзаголовок — только то, чего НЕТ в строке
                            больше нигде: ссылка на заказ или нотатка.
                            Вид записи отсюда снят: он стоит чипом
                            в соседней колонке. */}
                        {(r.orderId || (category && r.note)) && (
                          <span className="block truncate"
                                style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                            {r.orderId
                              ? (r.orderNumber !== null
                                  ? t('finance.record.orderNumber', { number: r.orderNumber })
                                  : t('finance.record.orderLink'))
                              : r.note}
                          </span>
                        )}
                      </span>
                    </span>
                    {/* ⚠️ ЗДЕСЬ СТОЯЛО НАЗВАНИЕ КАТЕГОРИИ — ВТОРЫМ РАЗОМ.
                        Оно уже напечатано слева заголовком операции, и
                        строка сообщала «Оренда приміщення · Оренда
                        приміщення». В хендоффе (§15) эта колонка несёт
                        ВИД записи — «Дохід» или «Витрати», — то есть
                        отвечает на другой вопрос, а не повторяет ответ
                        на предыдущий. */}
                    <span className="min-w-0">
                      <span className={positive ? 'badge-success' : 'badge-danger'}>
                        {t(`finance.form.${r.kind}`)}
                      </span>
                    </span>
                    <span className="tabular font-semibold"
                          style={{ color: positive ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {positive ? '+' : '−'}{t.money(r.amount)}
                    </span>
                    <span className="tabular">{t.date(`${r.occurredOn}T00:00:00`)}</span>
                    {canWrite && (
                      <span aria-hidden className="flex justify-end"
                            style={{ color: 'var(--color-faint)' }}>
                        <IconChevronRight size={18} />
                      </span>
                    )}
                  </RowTag>

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
                        {/* Встречная запись — здесь, а не в строке таблицы:
                            это действие НАД записью, и стоять оно обязано
                            рядом с остальными действиями над ней. */}
                        <button type="button" className="btn-ghost t-md"
                                onClick={() => startReverse(r)}>
                          {t('finance.record.reverse')}
                        </button>
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
      )}

      {/* Журнал — отдельными карточками, как везде в кабинете.
          На широком экране его заменяет таблица выше — двух списков
          одних и тех же записей на экране быть не должно. */}
      <div className={view === 'analytics' ? 'hidden' : 'contents lg:hidden'}>
      {shown.length === 0 ? (
        <section className="card rise-2">
          <div className="empty">
            {/* Приход, расход и итог — три величины этого экрана. */}
            <span aria-hidden className="empty-icons">
              <span><IconPlus size={22} /></span>
              <span><IconMoney size={22} /></span>
              <span><IconMinus size={22} /></span>
            </span>
            <p className="empty-title">
              {records.length === 0 ? t('finance.empty') : t('finance.web.table.empty')}
            </p>
            {canWrite && records.length === 0 && (
              <button type="button" className="btn-primary"
                      onClick={() => setAdding(true)}>{t('finance.add.cta')}</button>
            )}
          </div>
        </section>
      ) : (
        <div className="rise-2 flex flex-col gap-2">
          {byDay.map((g) => (
          <div key={g.day} className="flex flex-col gap-2">
            {/* Заголовок дня с итогом. Липкий — как подзаголовки категорий
                на складе: при прокрутке длинного месяца человек обязан
                видеть, какой день он сейчас читает.

                Итог со знаком: «+» и «−» здесь не украшение, а разница
                между «в этот день заработали» и «в этот день потратили»,
                и цвет один и тот же вопрос дублирует — на случай, когда
                цвет не читается. */}
            <div className="group-head">
              <span className="group-head-title">{dayHead(t, g.day)}</span>
              <span className="tabular t-sm shrink-0"
                    style={{ color: g.total < 0 ? 'var(--color-danger)'
                      : g.total > 0 ? 'var(--color-success)' : 'var(--color-muted)' }}>
                {g.total > 0 ? '+' : g.total < 0 ? '−' : ''}{t.money(Math.abs(g.total))}
              </span>
            </div>
            {g.rows.map((r) => {
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
                    {/* Даты в строке БОЛЬШЕ НЕТ: её называет заголовок дня
                        над группой, и повторять её у каждой записи значит
                        печатать одно и то же слово по пять раз подряд.
                        Заметка и ссылка на заказ — разными строками,
                        без точек-разделителей (решение владельца
                        25.08.2026): заметку пишет человек, и длинная
                        фраза, склеенная точкой с номером заказа,
                        читалась как одно предложение. */}
                    {category && r.note && (
                      <span className="t-xs mt-0.5 block prose-muted">{r.note}</span>
                    )}
                    {r.orderId && (
                      <span className="t-xs mt-0.5 block">
                        <Link href={`/app/orders/${r.orderId}`}
                              className="underline prose-muted">
                          {r.orderNumber !== null
                            ? t('finance.record.orderNumber', { number: r.orderNumber })
                            : t('finance.record.orderLink')}
                        </Link>
                      </span>
                    )}
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
          ))}
        </div>
      )}
      </div>

      {/* ── Аналітика на телефоне — те же данные картками (М46).
          Теперь ВКЛАДКОЙ, как и на десктопе (бриф владельца 20.08.2026,
          П2.4): раньше эти два блока стояли продолжением журнала и
          «появлялись резко, как из другого приложения» — до них надо
          было пролистать все транзакции периода, не зная, что они там
          есть. */}
      <section className={view === 'analytics' ? 'rise-2 lg:hidden' : 'hidden'}>
        <h2 className="display mb-3 t-xl">{t('finance.pnl.title')}</h2>
        {pnl.length === 0 ? (
          <div className="empty card">{t('finance.pnl.empty')}</div>
        ) : (
          <div className="card !p-0">
            {pnl.map((r) => (
              <div key={r.bucket} className="row px-4">
                <span className="min-w-0">
                  {/* `first-letter:uppercase`, а не `capitalize`: последнее
                      поднимает КАЖДОЕ слово, и украинское «серпень 2026 р.»
                      превращалось в «Серпень 2026 Р.» — заглавная «Р»
                      с точкой читается как инициал. */}
                  <span className="t-md block first-letter:uppercase">
                    {t.date(`${r.bucket}T00:00:00`, { month: 'long', year: 'numeric' })}
                  </span>
                  {/* Три величины тремя строками, а не одной через точки
                      (решение владельца 25.08.2026): суммы длинные, и
                      склеенная строка переносилась в середине числа —
                      «6 000,00 ₴ · змінні 1 250,00» на двух строках
                      читается как одна сумма. */}
                  <span className="tabular t-xs mt-0.5 block prose-muted">
                    {t('finance.pnl.income')}: {t.money(r.income)}
                  </span>
                  <span className="tabular t-xs block prose-muted">
                    {t('finance.pnl.fixed')}: {t.money(r.expenseFixed)}
                  </span>
                  <span className="tabular t-xs block prose-muted">
                    {t('finance.pnl.variable')}: {t.money(r.expenseVariable)}
                  </span>
                </span>
                <span className="tabular t-md shrink-0"
                      style={{ color: r.net < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  {t.money(r.net)}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="field-hint mt-2">{t('finance.pnl.hint')}</p>
      </section>

      <section className={view === 'analytics' ? 'rise-2 lg:hidden' : 'hidden'}>
        <h2 className="display mb-3 t-xl">{t('finance.margin.title')}</h2>
        {margins.length === 0 ? (
          <div className="empty card">{t('finance.margin.empty')}</div>
        ) : (
          <div className="card !p-0">
            {margins.map((r) => (
              <div key={r.variantId} className="row px-4">
                <span className="min-w-0">
                  <span className="t-md block truncate">{r.title}</span>
                  {/* Вариант и себестоимость — двумя строками, а не через
                      точки: обе величины длинные, и склеенные они
                      переносились в середине суммы. */}
                  <span className="t-xs mt-0.5 block truncate prose-muted">
                    {r.variantName}
                  </span>
                  <span className="tabular t-xs block prose-muted">
                    {t('finance.margin.cost')}: {t.money(r.unitCost)}
                  </span>
                  {r.missingCosts > 0 && (
                    <span className="badge-warn t-xs mt-1 inline-flex">
                      {t('finance.margin.incomplete')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular t-md block"
                        style={{ color: r.margin !== null && r.margin < 0
                          ? 'var(--color-danger)' : undefined }}>
                    {r.margin === null ? t('common.noValue') : t.money(r.margin)}
                  </span>
                  {r.margin !== null && r.marginPct !== null && (
                    <span className="tabular t-xs block prose-muted">
                      {t.percent(r.marginPct)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="field-hint mt-2">{t('finance.margin.hint')}</p>
      </section>

      {/* Подпись про неизменяемость — про ЖУРНАЛ, и во вкладке аналитики
          ей делать нечего: она объясняет кнопку «Зворотний запис»,
          которой там нет. На широком экране журнал виден всегда. */}
      <p className={view === 'analytics' ? 'field-hint hidden lg:block' : 'field-hint'}>
        {t('finance.hint')}
      </p>

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
                   className="input" placeholder="1 200,00" value={amount}
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
                {/* Пометка «постійна» — данные для P&L (0121), поэтому она
                    видна и переключается ровно там, где категорию завели. */}
                {c.kind === 'expense' && c.isFixed && (
                  <span className="opacity-70">· {t('finance.categories.fixed.badge')}</span>
                )}
                {canWrite && (
                  <button className="underline" disabled={busy === c.id}
                          onClick={() => void toggleCategory(c)}>
                    {c.isActive ? t('finance.categories.hide') : t('finance.categories.restore')}
                  </button>
                )}
                {canWrite && c.kind === 'expense' && (
                  <button className="underline" disabled={busy === c.id}
                          onClick={() => void toggleFixed(c)}>
                    {c.isFixed
                      ? t('finance.categories.fixed.unmark')
                      : t('finance.categories.fixed.mark')}
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
            {/* Галочка только у расхода: у дохода деления на постоянный
                и переменный не существует как понятия. */}
            {catKind === 'expense' && (
              <label className="flex items-center gap-2 py-2"
                     style={{ minHeight: 'var(--tap-min)' }}>
                <input type="checkbox" checked={catFixed}
                       onChange={(e) => setCatFixed(e.target.checked)} />
                <span className="t-sm">{t('finance.categories.fixed.label')}</span>
              </label>
            )}
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
