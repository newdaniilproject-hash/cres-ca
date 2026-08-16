'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { MaterialForm, type MaterialInit, type RefItem } from '../../material-form'
import { EXPIRY_BADGE, EXPIRY_LABEL, expiryState, fmtDate, fmtShort } from '@/lib/expiry'

export type Batch = {
  id: string; number: string
  made: string | null; expiry: string
  received: string; supplierId: string | null
}
export type Container = {
  id: string; code: string; status: string
  volume: number | null; unit: string | null
  openedAt: string | null; useBy: string | null
  decantedAt: string | null; parentId: string | null
}

// Строка «поле — значение». Ровно та таблица, что на макете: подпись
// слева серым, значение справа. Отдельным компонентом, потому что таких
// строк на экране одиннадцать и разъехаться они не должны.
function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4"
         style={{ paddingBlock: 'var(--space-2)' }}>
      <span className="t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className={`t-md min-w-0 text-right ${mono ? 'tabular' : ''}`}>{value}</span>
    </div>
  )
}

export function MaterialCard({
  tenantId, canWrite, material, stock, batches, containers, docsCount,
  suppliers, locations,
}: {
  tenantId: string
  canWrite: boolean
  material: MaterialInit
  /**
   * Остаток на складе. `null` — у читателя нет `stock.read` (инспектор):
   * строка «В наявності» не показывается вовсе. Ноль и «нет права» —
   * разные вещи, и подменять второе первым значит соврать в карточке.
   */
  stock: number | null
  batches: Batch[]
  containers: Container[]
  docsCount: number
  suppliers: RefItem[]
  locations: RefItem[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [batchEdit, setBatchEdit] = useState<Batch | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  // Действующая партия — та, что кончится раньше остальных ещё не
  // просроченных. Именно её номер и срок инспектор ждёт в карточке.
  // Если все просрочены — показываем последнюю: скрывать просрочку
  // нельзя, это и есть предмет проверки.
  const active = useMemo(() => {
    const live = batches.filter((b) => expiryState(b.expiry) !== 'expired')
    return live[0] ?? batches[batches.length - 1] ?? null
  }, [batches])

  const state = expiryState(active?.expiry)
  const opened = containers.filter((c) => c.status === 'opened')

  async function saveBatch(form: {
    number: string; made: string; expiry: string; supplierId: string
  }) {
    setBusy(true)
    const row = {
      batch_number: form.number.trim(),
      manufactured_date: form.made || null,
      expiry_date: form.expiry,
      supplier_id: form.supplierId || null,
    }
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = batchEdit && batchEdit !== 'new'
      ? await supabase.from('material_batches').update(row).eq('id', batchEdit.id)
      : await supabase.from('material_batches').insert({
          tenant_id: tenantId, material_id: material.id,
          created_by: user!.id, ...row,
        })
    setBusy(false)
    if (error) {
      toast.error('Партію не збережено', error.code === '23505'
        ? 'Партія з таким номером у цього засобу вже є'
        : error.message)
      return
    }
    setBatchEdit(null)
    toast.success('Партію збережено')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Шапка карточки ───────────────────────────────────── */}
      <section className="card rise-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={EXPIRY_BADGE[state]}>{EXPIRY_LABEL[state]}</span>
          {material.isCosmetic && <span className="badge-accent">косметика</span>}
          {!canWrite && <span className="badge">лише перегляд</span>}
        </div>
        <h2 className="display t-2xl">{material.name}</h2>
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {[material.brand, material.category].filter(Boolean).join(' · ') || 'без категорії'}
        </p>
        {stock !== null && (
          <p className="tabular t-md">
            В наявності: <b>{stock} {material.unit}</b>
            {material.threshold > 0 && stock <= material.threshold && (
              <span className="badge-warn ml-2">мінімум {material.threshold}</span>
            )}
          </p>
        )}
        {canWrite && (
          <button type="button" className="btn-secondary mt-2 self-start"
                  onClick={() => setEdit(true)}>
            Редагувати картку
          </button>
        )}
      </section>

      {/* ── Паспорт засоба (ТЗ 3.1) ──────────────────────────── */}
      <section className="card rise-2">
        <h3 className="t-sm mb-1" style={{ color: 'var(--color-faint)' }}>ПАСПОРТ ЗАСОБУ</h3>
        <Row label="Бренд" value={material.brand ?? '—'} />
        <Row label="Артикул" value={material.sku ?? '—'} mono />
        <Row label="Категорія" value={material.category ?? '—'} />
        <Row label="Країна-виробник" value={material.country ?? '—'} />
        <Row label="Одиниця" value={material.unit} />
        {material.inci && (
          <div style={{ paddingBlock: 'var(--space-2)' }}>
            <p className="t-sm" style={{ color: 'var(--color-muted)' }}>Склад (INCI)</p>
            <p className="t-sm mt-1">{material.inci}</p>
          </div>
        )}
      </section>

      {/* ── Партия и сроки ───────────────────────────────────── */}
      <section className="card rise-2">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="t-sm" style={{ color: 'var(--color-faint)' }}>ПАРТІЯ ТА ТЕРМІНИ</h3>
          {canWrite && (
            <button type="button" className="btn-ghost t-sm"
                    onClick={() => setBatchEdit('new')}>+ Партія</button>
          )}
        </div>

        {active ? (
          <>
            <Row label="Номер партії (Batch)" value={active.number} mono />
            <Row label="Дата виготовлення" value={fmtDate(active.made)} mono />
            <Row label="Термін придатності" value={fmtDate(active.expiry)} mono />
            <Row label="PAO (після відкриття)"
                 value={material.paoMonths ? `${material.paoMonths}M` : '—'} mono />
            <Row label="Статус"
                 value={<span className={EXPIRY_BADGE[state]}>{EXPIRY_LABEL[state]}</span>} />
            {canWrite && (
              <button type="button" className="btn-ghost mt-1 t-sm"
                      onClick={() => setBatchEdit(active)}>
                Виправити партію {active.number}
              </button>
            )}
          </>
        ) : (
          <div className="empty !py-6">
            Партій ще немає. Номер партії і термін придатності — обовʼязкові
            поля реєстру за ТЗ: без них перевірка не приймає засіб.
            {canWrite && (
              <button type="button" className="btn-primary"
                      onClick={() => setBatchEdit('new')}>Завести партію</button>
            )}
          </div>
        )}

        {batches.length > 1 && (
          <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
            <p className="t-xs mb-1" style={{ color: 'var(--color-faint)' }}>
              Усі партії: {batches.length}
            </p>
            {batches.map((b) => {
              const s = expiryState(b.expiry)
              return (
                <button key={b.id} type="button" disabled={!canWrite}
                        onClick={() => canWrite && setBatchEdit(b)}
                        className="row w-full text-left"
                        style={{ minHeight: 'var(--tap-min)' }}>
                  <span className="tabular t-md">{b.number}</span>
                  <span className={`tabular ${EXPIRY_BADGE[s]}`}>до {fmtShort(b.expiry)}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Два подэкрана: документы и контроль вскрытия ─────── */}
      <section className="card rise-3 !p-0">
        <Link href={`/app/inventory/materials/${material.id}/docs`}
              className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
          <span className="min-w-0">
            <span className="t-md block">Документи та сертифікати</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              {docsCount > 0
                ? `${docsCount} файлів · MSDS, сертифікати, висновок СЕС`
                : 'MSDS, сертифікат якості, висновок СЕС — не завантажено'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {material.isCosmetic && docsCount === 0
              ? <span className="badge-warn">потрібні</span>
              : <span className="badge tabular">{docsCount}</span>}
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </span>
        </Link>

        <Link href={`/app/inventory/materials/${material.id}/pao`}
              className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
          <span className="min-w-0">
            <span className="t-md block">Контроль відкриття та фасування</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              PAO, QR-коди, розлив у дозатор
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {opened.length > 0 && <span className="badge-accent tabular">відкрито {opened.length}</span>}
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </span>
        </Link>
      </section>

      {/* ── Нотификация МОЗ (ТЗ 3.1: посилання/код) ──────────── */}
      {material.isCosmetic && (
        <section className="card-flat rise-3">
          <h3 className="t-sm mb-1" style={{ color: 'var(--color-faint)' }}>НОТИФІКАЦІЯ МОЗ</h3>
          {material.notificationCode ? (
            <>
              <Row label="Код нотифікації" value={material.notificationCode} mono />
              <Row label="Дата реєстрації" value={fmtDate(material.notificationDate)} mono />
              {material.notificationUrl ? (
                <a href={material.notificationUrl} target="_blank" rel="noreferrer noopener"
                   className="btn-secondary mt-2 t-sm">
                  Відкрити запис у реєстрі
                </a>
              ) : (
                <p className="field-hint mt-2">
                  Посилання не вказане. Інспектор перевіряє нотифікацію не за
                  кодом, а за записом у реєстрі — додайте адресу в картці.
                </p>
              )}
            </>
          ) : (
            <p className="field-hint">
              Код нотифікації не вказаний. Для косметичного засобу це
              обовʼязковий пункт перевірки — впишіть його в картці.
            </p>
          )}
        </section>
      )}

      {/* ── Правка карточки ──────────────────────────────────── */}
      <Sheet open={edit} onClose={() => setEdit(false)} title="Редагування картки">
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          material={material} onDone={() => setEdit(false)}
        />
      </Sheet>

      {/* ── Правка партии ────────────────────────────────────── */}
      <Sheet open={batchEdit !== null} onClose={() => setBatchEdit(null)}
             title={batchEdit === 'new' ? 'Нова партія' : 'Партія'}>
        {batchEdit && (
          <BatchForm
            key={batchEdit === 'new' ? 'new' : batchEdit.id}
            batch={batchEdit === 'new' ? null : batchEdit}
            suppliers={suppliers}
            busy={busy}
            onSave={saveBatch}
            onCancel={() => setBatchEdit(null)}
          />
        )}
      </Sheet>
    </div>
  )
}

// Партия правится отдельной формой, а не вместе с карточкой: у одного
// засоба их бывает несколько, и «исправить срок» — самое частое
// действие в реестре. Смешать его с правкой бренда значит заставить
// пролистывать паспорт ради одной даты.
function BatchForm({
  batch, suppliers, busy, onSave, onCancel,
}: {
  batch: Batch | null
  suppliers: RefItem[]
  busy: boolean
  onSave: (f: { number: string; made: string; expiry: string; supplierId: string }) => void
  onCancel: () => void
}) {
  const [number, setNumber] = useState(batch?.number ?? '')
  const [made, setMade] = useState(batch?.made ?? '')
  const [expiry, setExpiry] = useState(batch?.expiry ?? '')
  const [supplierId, setSupplierId] = useState(batch?.supplierId ?? '')

  return (
    <form className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); onSave({ number, made, expiry, supplierId }) }}>
      <div className="sm:col-span-2">
        <label className="field-label">Номер партії</label>
        <input required autoFocus className="input" placeholder="62XS03"
               value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Дата виготовлення</label>
        <input type="date" className="input" max={expiry || undefined}
               value={made} onChange={(e) => setMade(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Термін придатності</label>
        <input required type="date" className="input" min={made || undefined}
               value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className="field-label">Постачальник</label>
        <select className="select" value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— не вказано —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p className="field-hint sm:col-span-2">
        Термін вскритої ємності перерахується сам: система бере менше з двох —
        термін партії або день відкриття плюс PAO. «Омолодити» засіб правкою
        партії не вийде, це заборонено в базі.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !number.trim() || !expiry}>
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  )
}
