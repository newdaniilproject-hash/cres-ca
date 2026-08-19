'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import type { RefItem } from '../material-form'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { IconClose, IconInbox } from '@/components/icons'

// Значения enum stock_receipt_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо готовится, либо уже изменил
// остаток, либо отброшен до проведения.
//
// Само значение (`draft`) не переводится — это ключ, по которому сверяется
// база. Переводится подпись, и связь «значение → ключ словаря» живёт
// в одном месте: её читают и перечень, и карточка документа.
const RECEIPT_STATUS_KEY: Record<string, Key> = {
  draft: 'inventory.receipt.status.draft',
  applied: 'inventory.receipt.status.applied',
  cancelled: 'inventory.receipt.status.cancelled',
}

/** Подпись статуса. Неизвестное значение показываем как есть. */
export function receiptStatusLabel(t: T, status: string): string {
  const key = RECEIPT_STATUS_KEY[status]
  return key ? t(key) : status
}

export function receiptBadge(status: string): string {
  switch (status) {
    case 'draft': return 'badge-warn'
    case 'applied': return 'badge-success'
    case 'cancelled': return 'badge'
    default: return 'badge'
  }
}

export type ReceiptRow = {
  id: string
  number: string | null
  status: string
  note: string | null
  supplier: string | null
  createdAt: string
  appliedAt: string | null
  lines: number
}

/** Фильтр списка. Задаётся плиткой-счётчиком, как на экране склада. */
type Flag = 'all' | 'draft' | 'applied' | 'cancelled'

export function ReceiptsClient({
  tenantId, userId, canWrite, receipts, suppliers, error,
}: {
  tenantId: string
  userId: string
  canWrite: boolean
  receipts: ReceiptRow[]
  suppliers: RefItem[]
  error: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  // Форма — шторкой снизу, как все формы кабинета. Прежний довод «форма
  // на странице, потому что клавиатура перекрывает модалку» устарел:
  // Sheet порталится в body, держит высоту в dvh и запас под клавиатуру,
  // а кнопка отправки прижата футером и с экрана не уезжает.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flag, setFlag] = useState<Flag>('all')

  // ── Шторка ИЛИ модалка — по ширине, не по устройству ─────────────────
  // Ниже lg форма живёт в Sheet, как была; на lg+ вместо неё открывается
  // центральная модалка 490px (хендофф CRESKO Web, §10). Порог тот же,
  // что у Tailwind `lg:`, — иначе модалка и веб-каркас кабинета
  // переключались бы на разных ширинах. Слушатель, а не разовая проверка:
  // окно сужают с открытой формой, и она обязана перейти в шторку,
  // а не остаться модалкой шириной с экран.
  const [isLg, setIsLg] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsLg(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Модалка рисуется В BODY тем же порталом, что и Sheet: любой предок
  // с backdrop-filter или transform делает position: fixed локальным
  // (см. components/sheet.tsx, история с колоколом).
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setHost(document.body) }, [])

  // Пока модалка открыта — страница под ней не крутится, Escape закрывает.
  // Sheet делает то же самое сам; модалке хватает overflow: клавиатурного
  // сдвига и нативного скролла веб-вью на десктопе нет.
  const modalOpen = open && canWrite && isLg
  useEffect(() => {
    if (!modalOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [modalOpen])

  const [supplierId, setSupplierId] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [note, setNote] = useState('')

  // ── `?new=1` ОТКРЫВАЕТ ФОРМУ СРАЗУ ───────────────────────────────────
  // Кнопка «Приймання» в веб-хедере склада ведёт сюда этим адресом:
  // человек нажал «завести документ», и заставлять его искать ту же
  // кнопку второй раз на этом экране — лишний шаг. Приём тот же, что
  // у `?scan=1` на складе: признак снимается из адреса СРАЗУ, иначе
  // повторное нажатие кнопки не откроет форму (адрес не меняется,
  // компонент не перемонтируется). `history.replaceState`, а не
  // `router.replace`, — серверный рендер ради чистки параметра не нужен.
  // Без права записи форму не открываем: Sheet и так гейтится canWrite,
  // но признак из адреса всё равно вычищаем.
  const sp = useSearchParams()
  useEffect(() => {
    if (sp.get('new') !== '1') return
    if (canWrite) { setOpen(true); setErr('') }
    window.history.replaceState(null, '', '/app/inventory/receipts')
  }, [sp, canWrite])

  // ── Счётчики, они же фильтр ──────────────────────────────────────────
  // Тон несёт состояние документа, тем же смыслом, что и бейдж строки:
  // amber — черновик ждёт работы, emerald — проведено, blue — скасовано
  // (это не беда, а отброшенная заготовка; rose кричал бы об ошибке,
  // которой нет). Плитка с нулём не нажимается: фильтр, дающий пустой
  // список, — обещание показать то, чего нет.
  const stats = useMemo(() => {
    const count = (s: string) => receipts.filter((r) => r.status === s).length
    return [
      { key: 'draft', n: count('draft'), label: t('inventory.receipts.metric.draft'), tone: 'amber' },
      { key: 'applied', n: count('applied'), label: t('inventory.receipts.metric.applied'), tone: 'emerald' },
      { key: 'cancelled', n: count('cancelled'), label: t('inventory.receipts.metric.cancelled'), tone: 'blue' },
    ] as const
  }, [receipts, t])

  const shown = flag === 'all' ? receipts : receipts.filter((r) => r.status === flag)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error: insertError } = await supabase.from('stock_receipts').insert({
      tenant_id: tenantId,
      supplier_id: supplierId || null,
      document_number: docNumber.trim() || null,
      note: note.trim() || null,
      created_by: userId,
      // status не шлём: у документа по умолчанию 'draft', и проводится он
      // только функцией apply_stock_receipt — руками статус не ставят.
    }).select('id').single()
    setBusy(false)
    if (insertError || !data) {
      setErr(insertError ? dbErrorText(t, insertError) : t('inventory.receipts.createFailed'))
      return
    }
    // Пустой документ бесполезен, поэтому сразу уводим на экран строк.
    router.push(`/app/inventory/receipts/${data.id}`)
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  // ── Поля формы — ОДИН раз на обе обёртки ─────────────────────────────
  // Шторка и модалка показывают одну и ту же форму с одними обработчиками;
  // различается только рамка вокруг. Второй набор полей разъехался бы
  // с первым на первой же правке (правило «один источник правды»).
  const supplierField = (
    <div>
      <label className="field-label">{t('inventory.receipts.form.supplier.label')}</label>
      <select className="select" value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}>
        <option value="">{t('inventory.common.notSet')}</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {suppliers.length === 0 && (
        <p className="field-hint">{t('inventory.receipts.form.supplier.hint')}</p>
      )}
    </div>
  )
  const numberField = (
    <div>
      <label className="field-label">{t('inventory.receipts.form.number.label')}</label>
      <input className="input" placeholder={t('inventory.receipts.form.number.placeholder')}
             value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
    </div>
  )
  const noteField = (
    <div>
      <label className="field-label">{t('inventory.receipts.form.note.label')}</label>
      <input className="input" placeholder={t('inventory.receipts.form.note.placeholder')}
             value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="field-hint">{t('inventory.receipts.form.note.hint')}</p>
    </div>
  )

  // Заголовок секции модалки: 14px/700 с номером — из §10 хендоффа.
  const sectionHead = (n: number, label: string) => (
    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
      {n}. {label}
    </p>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Ошибка загрузки приходит уже обезличенной (dbErrorText на сервере). */}
      {error && (
        <p className="field-error rise">{t('inventory.receipts.loadError')}: {error}</p>
      )}

      {/* ── Счётчики, они же фильтр ────────────────────────────── */}
      <section className="rise grid grid-cols-3 gap-2">
        {stats.map((s) => {
          const on = flag === s.key
          const dead = s.n === 0 && !on
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

      {/* Единственная кнопка создания — над списком. В пустом состоянии
          её нет: там та же кнопка стоит в `.empty-actions`, и две кнопки
          одного действия в двадцати сантиметрах друг от друга — тот самый
          дубляж, из-за которого переделывался склад. */}
      {canWrite && receipts.length > 0 && (
        <button type="button" className="btn-primary self-start"
                onClick={() => { setOpen(true); setErr('') }}>
          {t('inventory.receipts.new')}
        </button>
      )}

      <section className="card rise-1 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconInbox size={24} /></span>
            <p className="empty-title">
              {receipts.length === 0
                ? t('inventory.receipts.empty.title')
                : t('inventory.empty.filteredTitle')}
            </p>
            <p className="empty-desc">
              {receipts.length === 0
                ? t('inventory.receipts.empty.desc')
                : t('inventory.empty.filtered')}
            </p>
            {/* Без права на запись кнопки нет вовсе — пустой ряд действий
                оставил бы под текстом висящий отступ. */}
            {(receipts.length > 0 || canWrite) && (
              <div className="empty-actions">
                {receipts.length === 0 ? (
                  <button type="button" className="btn-primary"
                          onClick={() => { setOpen(true); setErr('') }}>
                    {t('inventory.receipts.create')}
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setFlag('all')}>
                    {t('inventory.filter.reset')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : shown.map((r) => (
          <Link key={r.id} href={`/app/inventory/receipts/${r.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                {/* Номер накладной — данные арендатора. */}
                {r.number ? `№${r.number}` : t('inventory.receipts.row.noNumber')}
                {r.supplier ? <span className="prose-muted"> · {r.supplier}</span> : null}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(r.createdAt)} · {r.lines === 0
                  ? t('inventory.receipts.row.noLines')
                  : t('inventory.receipts.row.lines', { n: t.number(r.lines) })}
                {r.appliedAt
                  ? ` · ${t('inventory.receipts.row.applied', { date: fmt(r.appliedAt) })}`
                  : ''}
              </p>
            </div>
            <span className={receiptBadge(r.status)}>
              {receiptStatusLabel(t, r.status)}
            </span>
          </Link>
        ))}
      </section>

      <p className="field-hint">{t('inventory.receipts.hint')}</p>

      {/* ── Форма нового приймання: шторка ниже lg ─────────────── */}
      <Sheet open={open && canWrite && !isLg} onClose={() => setOpen(false)}
             title={t('inventory.receipts.form.title')}
             footer={
               <button form="receipt-form" className="btn-primary w-full" disabled={busy}>
                 {t('inventory.receipts.form.submit')}
               </button>
             }>
        {/* id связывает кнопку футера с формой: футер лежит вне <form>. */}
        <form id="receipt-form" onSubmit={create} className="grid gap-3">
          {supplierField}
          {numberField}
          {noteField}
          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>

      {/* ── Та же форма на lg+: центральная модалка 490px ────────
          Хендофф CRESKO Web, §10: окно 490px, radius 18, заголовок
          20px/750, нумерованные секции 14px/700, «Скасувати» (flex 1)
          и синяя кнопка (flex 1.4) — единственное второе место
          `.btn-blue` в кабинете после кнопки «Приймання» на складе.
          Логика — та же, что в шторке: создаётся ЧЕРНОВИК документа,
          и человек уходит на экран позиций. Поэтому секций «Товари»
          и «Підсумок» из §10 здесь нет: позиции живут в самом
          документе (`receipts/[id]`), а рисовать грід без данных
          и обработчиков — фикстура, не форма.
          Слои и тень — общие с Sheet (.sheet-layer, .sheet-backdrop,
          var(--shadow-overlay)): второй набор значений затемнения
          разошёлся бы с первым при правке темы. */}
      {modalOpen && host && createPortal(
        <div className="sheet-layer flex items-center justify-center p-6"
             role="dialog" aria-modal="true"
             aria-label={t('inventory.receipts.form.title')}>
          <button type="button" aria-label={t('common.close.aria')}
                  className="sheet-backdrop" onClick={() => setOpen(false)} />
          <div className="rise relative flex w-full flex-col"
               style={{
                 maxWidth: 490, maxHeight: '100%', borderRadius: 18,
                 background: 'var(--color-surface)',
                 boxShadow: 'var(--shadow-overlay)',
                 padding: '22px 24px 24px',
               }}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 style={{ fontSize: 20, fontWeight: 750, color: 'var(--color-text)' }}>
                {t('inventory.receipts.form.title')}
              </h2>
              <button type="button" className="btn-icon shrink-0"
                      aria-label={t('common.close.aria')}
                      style={{ color: 'var(--color-faint)' }}
                      onClick={() => setOpen(false)}>
                <IconClose size={18} />
              </button>
            </div>
            {/* Один id на обе обёртки не конфликтует: шторка и модалка
                не существуют одновременно (isLg выбирает одну). */}
            <form id="receipt-form" onSubmit={create}
                  className="flex min-h-0 flex-1 flex-col">
              {/* max-height:100% + внутренний скрол — из §10 дословно. */}
              <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto">
                {sectionHead(1, t('inventory.receipts.form.section.doc'))}
                <div className="grid gap-3 lg:grid-cols-2">
                  {supplierField}
                  {numberField}
                </div>
                {sectionHead(2, t('inventory.receipts.form.section.extra'))}
                {noteField}
                {err && <p className="field-error">{err}</p>}
              </div>
              <div className="mt-5 flex gap-3">
                <button type="button" className="btn-secondary" style={{ flex: 1 }}
                        onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button className="btn-blue" style={{ flex: 1.4 }} disabled={busy}>
                  {t('inventory.receipts.form.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        host,
      )}
    </div>
  )
}
