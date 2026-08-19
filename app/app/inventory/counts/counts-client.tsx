'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'
import { IconClipboard } from '@/components/icons'

// Значения enum stock_count_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо считается, либо уже изменил
// остаток корректировками, либо отброшен.
//
// Само значение (`applied`) не переводится — это ключ, по которому
// сверяется база. Переводится подпись к нему, и связь «значение → ключ
// словаря» живёт ровно здесь, одна на список и на карточку документа.
const COUNT_STATUS_KEY: Record<string, Key> = {
  counting: 'inventory.count.status.counting',
  applied: 'inventory.count.status.applied',
  cancelled: 'inventory.count.status.cancelled',
}

/** Подпись статуса. Неизвестное значение показываем как есть. */
export function countStatusLabel(t: T, status: string): string {
  const key = COUNT_STATUS_KEY[status]
  return key ? t(key) : status
}

export function countBadge(status: string): string {
  switch (status) {
    case 'counting': return 'badge-warn'
    case 'applied': return 'badge-success'
    case 'cancelled': return 'badge'
    default: return 'badge'
  }
}

// Число на экране склада — это остаток, а остаток у расходника дробный:
// «0.5 л» и «500 г» одинаково законны. Показываем ровно столько знаков,
// сколько есть, но не больше трёх: хвост 0.30000000000000004 — это
// двоичная дробь, а не данные.
//
// Формат — через `t.number`, а не своей сборкой: разделитель дробной
// части у языков разный, и «0.5» в украинской локали пишется «0,5».
export function qty(t: T, n: number): string {
  return t.number(n, { maximumFractionDigits: 3 })
}

// База отвечает по-русски и словами разработчика. Мастеру у полки это ничего
// не объясняет, поэтому известные отказы переводим, а незнакомый текст
// показываем как есть — проглотить ошибку хуже, чем показать сырую.
//
// Подстроки, по которым разбирается отказ, В СЛОВАРЬ НЕ ЕДУТ: это текст
// миграции, и переписать его здесь значит завести второй источник правды.
// Переводится только наш ответ.
//
// Принимает САМУ ошибку, а не только message: запасной путь — общий разбор
// `dbErrorText`, а тому нужен код SQLSTATE. Обёртка `new Error(message)`
// код теряла, и незнакомый отказ показывался без кода в скобках —
// поддержке было не о чем спросить.
export function humanizeCount(t: T, e: { message?: string | null; code?: string | null } | string): string {
  const message = (typeof e === 'string' ? e : e.message) ?? ''
  if (message.includes('не идёт пересчёт') || message.includes('не идет пересчёт')) {
    return t('inventory.count.error.notCounting')
  }
  if (message.includes('документ уже применён')) {
    return t('inventory.count.error.locked')
  }
  if (message.includes('не найдена')) {
    return t('inventory.count.error.missing')
  }
  if (message.includes('нечего пересчитывать')) {
    return t('inventory.count.error.nothing')
  }
  if (message.includes('недостаточно прав')) {
    return t('inventory.error.stockWrite')
  }
  if (message.includes('требует авторизованного пользователя')) {
    return t('inventory.error.session')
  }
  if (message.includes('позиция не найдена')) {
    return t('inventory.error.itemMissing')
  }
  if (message.includes('stock_nonneg') || message.includes('current_stock')) {
    return t('inventory.count.error.negativeStock')
  }
  if (message.includes('stock_count_lines_qty_nonneg')) {
    return t('inventory.count.error.negativeQty')
  }
  // Незнакомое базе-специфичное сюда не доходит: общий разбор
  // (`lib/errors/db.ts`) не отдаёт человеку сырой текст Postgres.
  return dbErrorText(t, typeof e === 'string' ? { message } : e)
}

export type CountRow = {
  id: string
  status: string
  note: string | null
  startedAt: string
  appliedAt: string | null
  total: number
  filled: number
  mismatches: number
  materials: number
}

export type PickOption = {
  id: string
  title: string
  unit: string
  stock: number
  category?: string
}

export function CountsClient({
  tenantId, canWrite, counts, variants, materials, error,
}: {
  tenantId: string
  canWrite: boolean
  counts: CountRow[]
  variants: PickOption[]
  materials: PickOption[]
  error: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  // Форма открывается шторкой снизу — как и все формы склада. Раскрывающийся
  // блок посреди страницы уводит список вниз, и мастер теряет место, где был.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  // Расходники первыми и по умолчанию: у салона склад — это они, товаров
  // может не быть вовсе. Раньше экран показывал только товары, и мастер
  // видел пустой список при полных полках.
  const [kind, setKind] = useState<'materials' | 'variants'>(
    materials.length > 0 ? 'materials' : 'variants',
  )
  const [pickedM, setPickedM] = useState<string[]>([])
  const [pickedV, setPickedV] = useState<string[]>([])
  // Фильтр списка документов. Задаётся плиткой-счётчиком сверху: раньше
  // «Розбіжностей: 3» было мёртвым числом — экран сообщал беду и не давал
  // способа её увидеть (тот же урок, что и на экране склада).
  const [flag, setFlag] = useState<'all' | 'counting' | 'open' | 'diff' | 'applied'>('all')

  const pool = kind === 'materials' ? materials : variants
  const picked = kind === 'materials' ? pickedM : pickedV
  const setPicked = kind === 'materials' ? setPickedM : setPickedV
  const totalPicked = pickedM.length + pickedV.length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? pool.filter((v) => v.title.toLowerCase().includes(q)
        || (v.category ?? '').toLowerCase().includes(q))
      : pool
  }, [pool, query])

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  const stats = useMemo(() => ({
    counting: counts.filter((c) => c.status === 'counting').length,
    applied: counts.filter((c) => c.status === 'applied').length,
    open: counts.filter((c) => c.status === 'counting')
      .reduce((s, c) => s + (c.total - c.filled), 0),
    mismatches: counts.filter((c) => c.status === 'counting')
      .reduce((s, c) => s + c.mismatches, 0),
  }), [counts])

  // Список под фильтром. «Не пораховані» и «Розбіжності» считают ПОЗИЦИИ,
  // а список состоит из ДОКУМЕНТОВ — поэтому фильтр оставляет документы,
  // в которых такие позиции есть, а не пытается показать сами позиции:
  // они живут внутри карточки документа.
  const shownCounts = useMemo(() => counts.filter((c) => {
    switch (flag) {
      case 'counting': return c.status === 'counting'
      case 'open': return c.status === 'counting' && c.total - c.filled > 0
      case 'diff': return c.status === 'counting' && c.mismatches > 0
      case 'applied': return c.status === 'applied'
      default: return true
    }
  }), [counts, flag])

  async function start() {
    setBusy(true); setErr('')
    // Снимок остатка в expected_qty снимает база в этой же транзакции.
    // Если снимать его на клиенте, сравнение уехало бы: между открытием
    // экрана и началом пересчёта остаток могла подвинуть продажа.
    //
    // Пустой массив отправляем как null: функция считает переданные
    // массивы вместе, и `{}` от null для неё не отличается — но null
    // честнее описывает «этого вида позиций в документе нет».
    const { data, error: rpcError } = await supabase.rpc('start_stock_count', {
      p_tenant_id: tenantId,
      p_variant_ids: pickedV.length > 0 ? pickedV : null,
      p_material_ids: pickedM.length > 0 ? pickedM : null,
    })
    setBusy(false)
    const row = data as { id?: string } | null
    if (rpcError || !row?.id) {
      // Ошибка передаётся целиком, а не `.message`: разбору нужен код.
      setErr(rpcError ? humanizeCount(t, rpcError) : t('inventory.counts.startFailed'))
      return
    }
    // Пустой документ бесполезен — сразу уводим туда, где вписывают факт.
    toast.success(t('inventory.counts.started.title'),
      t('inventory.counts.started.desc', { n: t.number(totalPicked) }))
    router.push(`/app/inventory/counts/${row.id}`)
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  const nothingToCount = variants.length === 0 && materials.length === 0

  return (
    <div className="flex flex-col gap-5">

      {/* ── Счётчики, они же фильтр ──────────────────────────────
          Разметка — как на экране склада (`.metric`, тон в data-tone):
          крупное цветное число и мелкая подпись, без самодельных плиток
          с инлайновыми цветами. Тон несёт смысл: rose — расхождения,
          amber — недосчитанное, emerald — проведённое, blue — идущее.

          Нажатие фильтрует список документов, повторное — снимает.
          Плитка с нулём не нажимается: фильтр, дающий пустой список, —
          это обещание показать то, чего нет.

          Сетка 2×2 на телефоне, а не 4 в ряд: подписи здесь длиннее
          складских («Не порахованих»), и в четыре колонки на 390px
          они ломают ровный ряд переносом. */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          { key: 'counting', n: stats.counting, label: t('inventory.counts.stats.counting'), tone: 'blue' },
          { key: 'open', n: stats.open, label: t('inventory.counts.stats.open'), tone: 'amber' },
          { key: 'diff', n: stats.mismatches, label: t('inventory.counts.stats.mismatches'), tone: 'rose' },
          { key: 'applied', n: stats.applied, label: t('inventory.counts.stats.applied'), tone: 'emerald' },
        ] as const).map((s) => {
          const on = flag === s.key
          const dead = s.n === 0
          return (
            <button key={s.key} type="button" disabled={dead} aria-pressed={on}
                    data-tone={s.tone}
                    onClick={() => setFlag(on ? 'all' : s.key)}
                    className="metric"
                    style={{ cursor: dead ? 'default' : 'pointer' }}>
              <span className="metric-value">{t.number(s.n)}</span>
              <span className="metric-label">{s.label}</span>
            </button>
          )
        })}
      </section>

      {/* Одна кнопка на действие. Вторая («Усі засоби · N») открывала ту же
          шторку с предвыбором — дубль входа; предвыбор переехал в шторку. */}
      {canWrite && !nothingToCount && (
        <div className="rise-1 flex flex-wrap gap-2">
          <button type="button" className="btn-primary"
                  onClick={() => { setOpen(true); setErr('') }}>
            {t('inventory.counts.start')}
          </button>
        </div>
      )}

      {/* Текст уже переведён общим разбором (`dbErrorText`) на сервере —
          сырые слова Postgres человеку не показываются. */}
      {error && (
        <p className="field-error rise">{t('inventory.counts.loadError')}: {error}</p>
      )}

      {/* ── Список документов ────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        {counts.length === 0 ? (
          // Одно полное пустое состояние вместо голой строки: заголовок,
          // объяснение и действие. Когда перераховувати нечего вовсе,
          // действие ведёт туда, где заводятся позиции, — кнопка «почати»
          // открыла бы шторку с двумя пустыми списками.
          <div className="empty">
            <span className="empty-icon"><IconClipboard size={24} /></span>
            <p className="empty-title">
              {nothingToCount
                ? t('inventory.counts.nothing.title')
                : t('inventory.counts.empty.title')}
            </p>
            <p className="empty-desc">
              {nothingToCount
                ? t('inventory.counts.nothingToCount')
                : t('inventory.counts.empty.desc')}
            </p>
            <div className="empty-actions">
              {nothingToCount ? (
                <>
                  <Link href="/app/inventory" className="btn-primary">
                    {t('inventory.counts.nothing.toInventory')}
                  </Link>
                  <Link href="/app/catalog" className="btn-secondary">
                    {t('inventory.counts.nothing.toCatalog')}
                  </Link>
                </>
              ) : canWrite && (
                <button type="button" className="btn-primary"
                        onClick={() => { setOpen(true); setErr('') }}>
                  {t('inventory.counts.start')}
                </button>
              )}
            </div>
          </div>
        ) : shownCounts.length === 0 ? (
          // Пусто ПОД ФИЛЬТРОМ — отдельный случай: документы есть, их
          // спрятала плитка. Без объяснения это читается как пропажа данных.
          <div className="empty">
            <span className="empty-icon"><IconClipboard size={24} /></span>
            <p className="empty-title">{t('inventory.empty.filteredTitle')}</p>
            <p className="empty-desc">{t('inventory.counts.filterEmpty.desc')}</p>
            <div className="empty-actions">
              <button type="button" className="btn-secondary" onClick={() => setFlag('all')}>
                {t('inventory.filter.reset')}
              </button>
            </div>
          </div>
        ) : shownCounts.map((c) => (
          <Link key={c.id} href={`/app/inventory/counts/${c.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                {t('inventory.counts.row.title', { date: fmt(c.startedAt) })}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {c.total === 0
                  ? t('inventory.counts.row.noLines')
                  : t('inventory.counts.row.lines', { n: t.number(c.total) })}
                {c.materials > 0
                  ? ` ${t('inventory.counts.row.materials', { n: t.number(c.materials) })}`
                  : ''}
                {c.status === 'counting' && c.total > 0
                  ? ` · ${t('inventory.counts.row.filled', { n: t.number(c.filled) })}`
                  : ''}
                {c.appliedAt
                  ? ` · ${t('inventory.counts.row.applied', { date: fmt(c.appliedAt) })}`
                  : ''}
              </p>
              {c.note && <p className="t-xs mt-0.5 truncate prose-muted">{c.note}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {c.mismatches > 0 && (
                <span className="badge-warn tabular">
                  {t('inventory.counts.row.mismatches', { n: t.number(c.mismatches) })}
                </span>
              )}
              <span className={countBadge(c.status)}>
                {countStatusLabel(t, c.status)}
              </span>
            </div>
          </Link>
        ))}
      </section>

      {/* Прежняя подсказка «немає що перераховувати» уехала в пустое
          состояние списка выше — два field-hint подряд читались как один
          серый абзац без выхода. */}
      <p className="field-hint">{t('inventory.counts.hint')}</p>

      {/* ── Выбор позиций ────────────────────────────────────── */}
      <Sheet
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title={t('inventory.counts.sheet.title')}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary"
                    disabled={busy || totalPicked === 0}
                    onClick={() => void start()}>
              {busy
                ? t('inventory.counts.sheet.busy')
                : t('inventory.counts.sheet.submit', { n: t.number(totalPicked) })}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="field-hint !mt-0">{t('inventory.counts.sheet.hint')}</p>

          {/* Расходники и товары — разные списки, но один документ:
              база принимает оба массива за один вызов. */}
          <div className="flex flex-wrap gap-2">
            <button type="button"
                    className={kind === 'materials' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('materials')}>
              {t('inventory.counts.pick.materials')}
              {materials.length > 0 ? ` · ${t.number(materials.length)}` : ''}
              {pickedM.length > 0
                ? ` ${t('inventory.counts.pick.chosen', { n: t.number(pickedM.length) })}`
                : ''}
            </button>
            <button type="button"
                    className={kind === 'variants' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('variants')}>
              {t('inventory.counts.pick.goods')}
              {variants.length > 0 ? ` · ${t.number(variants.length)}` : ''}
              {pickedV.length > 0
                ? ` ${t('inventory.counts.pick.chosen', { n: t.number(pickedV.length) })}`
                : ''}
            </button>
          </div>

          <input className="input" placeholder={t('inventory.counts.pick.search')}
                 value={query} onChange={(e) => setQuery(e.target.value)} />

          <div className="flex flex-wrap items-center gap-2">
            {/* Пресет «усі засоби» живёт здесь, а не кнопкой на экране:
                там он был вторым входом в эту же шторку. Он шире «Обрати
                все»: переключает на засоби и выбирает их независимо от
                открытой вкладки и набранного запроса. */}
            {materials.length > 0 && (
              <button type="button" className="chip"
                      onClick={() => {
                        setKind('materials')
                        setPickedM(materials.map((m) => m.id))
                      }}>
                {t('inventory.counts.allMaterials', { n: t.number(materials.length) })}
              </button>
            )}
            <button type="button" className="chip"
                    onClick={() => setPicked(shown.map((v) => v.id))}>
              {query.trim()
                ? t('inventory.counts.pick.selectAllFound')
                : t('inventory.counts.pick.selectAll')}
            </button>
            <button type="button" className="chip" onClick={() => setPicked([])}>
              {t('inventory.counts.pick.clear')}
            </button>
            <span className="badge-accent tabular ml-auto">
              {t('inventory.counts.pick.total', { n: t.number(totalPicked) })}
            </span>
          </div>

          <div className="card-flat !p-0 px-5">
            {pool.length === 0 ? (
              // Полное пустое состояние с выходом: позиции заводятся не здесь,
              // и голая строка оставляла человека в шторке без дороги дальше.
              <div className="empty">
                <span className="empty-icon"><IconClipboard size={24} /></span>
                <p className="empty-title">
                  {kind === 'materials'
                    ? t('inventory.counts.pick.emptyMaterials.title')
                    : t('inventory.counts.pick.emptyGoods.title')}
                </p>
                <p className="empty-desc">
                  {kind === 'materials'
                    ? t('inventory.counts.pick.noMaterials')
                    : t('inventory.counts.pick.noGoods')}
                </p>
                <div className="empty-actions">
                  {kind === 'materials' ? (
                    <Link href="/app/inventory" className="btn-secondary">
                      {t('inventory.counts.nothing.toInventory')}
                    </Link>
                  ) : (
                    <Link href="/app/catalog" className="btn-secondary">
                      {t('inventory.counts.nothing.toCatalog')}
                    </Link>
                  )}
                </div>
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon"><IconClipboard size={24} /></span>
                <p className="empty-title">{t('inventory.counts.pick.searchEmpty')}</p>
                <p className="empty-desc">{t('inventory.counts.pick.searchMiss.desc')}</p>
                <div className="empty-actions">
                  <button type="button" className="btn-secondary" onClick={() => setQuery('')}>
                    {t('inventory.filter.reset')}
                  </button>
                </div>
              </div>
            ) : shown.map((v) => (
              <label key={v.id} className="row cursor-pointer">
                <div className="min-w-0">
                  <p className="t-md truncate">{v.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {t('inventory.counts.pick.stock', { qty: qty(t, v.stock), unit: v.unit })}
                    {v.category ? ` · ${v.category}` : ''}
                  </p>
                </div>
                {/* Тап-зона — вся строка: галочку в 16px пальцем не поймать. */}
                <input type="checkbox" className="shrink-0"
                       checked={picked.includes(v.id)}
                       onChange={() => toggle(v.id)} />
              </label>
            ))}
          </div>

          {err && <p className="field-error">{err}</p>}
        </div>
      </Sheet>
    </div>
  )
}
