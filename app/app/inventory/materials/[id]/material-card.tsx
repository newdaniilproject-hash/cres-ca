'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { MaterialForm, type MaterialInit, type RefItem } from '../../material-form'
import { EXPIRY_KEY } from '../../inventory-client'
import { EXPIRY_BADGE, expiryState } from '@/lib/expiry'
import { IconDoc, IconQr } from '@/components/icons'

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
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className={`kv-val ${mono ? 'tabular' : ''}`}>{value}</span>
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
  const t = useT()
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
      toast.error(t('inventory.material.batch.saveError'), error.code === '23505'
        ? t('inventory.material.batch.duplicate')
        : error.message)
      return
    }
    setBatchEdit(null)
    toast.success(t('inventory.material.batch.saved'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Шапка карточки ───────────────────────────────────── */}
      <section className="card rise-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>
          {material.isCosmetic && (
            <span className="badge-accent">{t('inventory.material.badge.cosmetic')}</span>
          )}
          {!canWrite && <span className="badge">{t('inventory.material.badge.readonly')}</span>}
        </div>
        <h2 className="display t-2xl">{material.name}</h2>
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {/* Бренд и категория — данные арендатора. */}
          {[material.brand, material.category].filter(Boolean).join(' · ')
            || t('inventory.material.noCategory')}
        </p>
        {stock !== null && (
          <p className="tabular t-md">
            {t('inventory.material.inStock')}: <b>{t.number(stock)} {material.unit}</b>
            {material.threshold > 0 && stock <= material.threshold && (
              <span className="badge-warn ml-2">
                {t('inventory.material.minimum', { n: t.number(material.threshold) })}
              </span>
            )}
          </p>
        )}
        {canWrite && (
          <button type="button" className="btn-secondary mt-2 self-start"
                  onClick={() => setEdit(true)}>
            {t('inventory.material.edit')}
          </button>
        )}
      </section>

      {/* ── Паспорт засоба (ТЗ 3.1) ──────────────────────────────
          README, розділ C, блок 1: Бренд, Артикул, Категорія,
          Країна-виробник. INCI отсюда УБРАН и стоит своей секцией
          ниже, как в спецификации: это абзац состава, а не строка
          таблицы — в «ключ → значение» он занимал пять строк высоты
          и ломал ритм остальных. */}
      <section className="rise-2">
        <p className="eyebrow mb-2">{t('inventory.material.passport.title')}</p>
        <div className="kv">
          <Row label={t('inventory.material.row.brand')} value={material.brand ?? '—'} />
          <Row label={t('inventory.material.row.sku')} value={material.sku ?? '—'} mono />
          <Row label={t('inventory.material.row.category')} value={material.category ?? '—'} />
          <Row label={t('inventory.material.row.country')} value={material.country ?? '—'} />
          <Row label={t('inventory.material.row.unit')} value={material.unit} />
        </div>
      </section>

      {/* ── Партия и сроки ───────────────────────────────────── */}
      <section className="rise-2">
        <div className="section-head">
          <p className="eyebrow">{t('inventory.material.batches.title')}</p>
          {canWrite && (
            <button type="button" className="btn-ghost t-sm"
                    onClick={() => setBatchEdit('new')}>
              {t('inventory.material.batches.add')}
            </button>
          )}
        </div>

        {active ? (
          <>
            {/* README, розділ C, блок 2 «Партія та терміни»:
                Номер партії, Дата виробництва, Термін придатності,
                PAO, Статус — статус кольором стану. */}
            <div className="kv">
              {/* Номер партии — данные арендатора, не переводится. */}
              <Row label={t('inventory.material.row.batchNumber')} value={active.number} mono />
              <Row label={t('inventory.material.row.made')} value={t.date(active.made)} mono />
              <Row label={t('inventory.material.row.expiry')} value={t.date(active.expiry)} mono />
              <Row label={t('inventory.material.row.pao')}
                   value={material.paoMonths ? `${t.number(material.paoMonths)}M` : '—'} mono />
              <Row label={t('inventory.material.row.status')}
                   value={<span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>} />
            </div>
            {canWrite && (
              <button type="button" className="btn-ghost mt-1 t-sm"
                      onClick={() => setBatchEdit(active)}>
                {t('inventory.material.batch.fix', { number: active.number })}
              </button>
            )}
          </>
        ) : (
          <div className="empty !py-6">
            {t('inventory.material.batch.empty')}
            {canWrite && (
              <button type="button" className="btn-primary"
                      onClick={() => setBatchEdit('new')}>
                {t('inventory.material.batch.create')}
              </button>
            )}
          </div>
        )}

        {batches.length > 1 && (
          <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
            <p className="t-xs mb-1" style={{ color: 'var(--color-faint)' }}>
              {t('inventory.material.batches.all', { n: t.number(batches.length) })}
            </p>
            {batches.map((b) => {
              const s = expiryState(b.expiry)
              return (
                <button key={b.id} type="button" disabled={!canWrite}
                        onClick={() => canWrite && setBatchEdit(b)}
                        className="row w-full text-left"
                        style={{ minHeight: 'var(--tap-min)' }}>
                  <span className="tabular t-md">{b.number}</span>
                  <span className={`tabular ${EXPIRY_BADGE[s]}`}>
                    {t('inventory.material.batch.until', {
                      date: t.date(b.expiry, { day: 'numeric', month: 'short' }),
                    })}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Два подэкрана: документы и контроль вскрытия ─────── */}
      {/* README, розділ C: два навігаційні рядки со ЗНАЧКАМИ на цветных
          плашках — документы на `accentSoft`, контроль вскрытия на
          `violetSoft`. Разные тона здесь не украшение: это два разных
          по смыслу подэкрана (бумаги и физическая банка), и одинаковый
          серый кружок у обоих читался как один пункт с переносом. */}
      <section className="card rise-3 !p-0">
        <Link href={`/app/inventory/materials/${material.id}/docs`}
              className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="list-anchor" data-tone="accent">
            <IconDoc size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-md block">{t('inventory.material.docs.title')}</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              {docsCount > 0
                ? t.plural('inventory.material.docs.count', docsCount)
                : t('inventory.material.docs.none')}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {material.isCosmetic && docsCount === 0
              ? <span className="badge-warn">{t('inventory.material.docs.needed')}</span>
              : <span className="badge tabular">{t.number(docsCount)}</span>}
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </span>
        </Link>

        <Link href={`/app/inventory/materials/${material.id}/pao`}
              className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="list-anchor" data-tone="violet">
            <IconQr size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-md block">{t('inventory.material.pao.title')}</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              {t('inventory.material.pao.desc')}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {opened.length > 0 && (
              <span className="badge-accent tabular">
                {t('inventory.material.pao.opened', { n: t.number(opened.length) })}
              </span>
            )}
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </span>
        </Link>
      </section>

      {/* ── Склад (INCI) ──────────────────────────────────────────
          README, розділ C: своя секция, «текст 12px/1.6 muted у картці».
          В таблице «ключ → значение» он занимал пять строк высоты
          и ломал ритм остальных: это абзац состава, а не строка.
          Показывается только у косметики и только если он заполнен —
          пустая карточка с заголовком «Склад» сообщает лишь о том,
          что мы про него помним. */}
      {material.isCosmetic && material.inci && (
        <section className="rise-3">
          <p className="eyebrow mb-2">{t('inventory.material.inci.title')}</p>
          <div className="card">
            <p style={{
              fontSize: 'calc(12px * var(--type-scale))',
              lineHeight: 1.6,
              color: 'var(--color-muted)',
            }}>
              {material.inci}
            </p>
          </div>
        </section>
      )}

      {/* ── Нотификация МОЗ (ТЗ 3.1: посилання/код) ────────────────
          README: инфо-блок на `accentSoft`. Это не украшение: блок
          несёт код и дату регистрации — то, что проверка спрашивает
          первым, — и на общем фоне он терялся между карточками. */}
      {material.isCosmetic && (
        <section className="rise-3" style={{
          background: 'var(--color-accent-soft)',
          borderRadius: 'var(--radius-card)',
          padding: '14px 16px',
        }}>
          <h3 className="t-sm mb-1" style={{ color: 'var(--color-accent-ink)' }}>
            {t('inventory.material.moz.title')}
          </h3>
          {material.notificationCode ? (
            <>
              <Row label={t('inventory.material.row.mozCode')}
                   value={material.notificationCode} mono />
              <Row label={t('inventory.material.row.mozDate')}
                   value={t.date(material.notificationDate)} mono />
              {material.notificationUrl ? (
                <a href={material.notificationUrl} target="_blank" rel="noreferrer noopener"
                   className="btn-secondary mt-2 t-sm">
                  {t('inventory.material.moz.open')}
                </a>
              ) : (
                <p className="field-hint mt-2">{t('inventory.material.moz.noUrl')}</p>
              )}
            </>
          ) : (
            <p className="field-hint">{t('inventory.material.moz.noCode')}</p>
          )}

          {/* Код — слова поставщика, подтверждение — документ. Проверка
              смотрит второе. Автосверки с реестром МОЗ не существует
              (реестр закрытый), поэтому единственное, что мы можем, —
              не дать забыть про документ. */}
          <p className="mt-3">
            {material.notificationConfirmedAt ? (
              <span className="badge-success">
                {t('inventory.material.moz.proof.ok', {
                  date: t.date(material.notificationConfirmedAt),
                })}
              </span>
            ) : (
              <Link href={`/app/inventory/materials/${material.id}/docs`}
                    className="badge-danger">
                {t('inventory.material.moz.proof.missing')} · {t('inventory.material.moz.proof.open')}
              </Link>
            )}
          </p>
        </section>
      )}

      {/* ── Правка карточки ──────────────────────────────────── */}
      <Sheet open={edit} onClose={() => setEdit(false)}
             title={t('inventory.material.sheet.edit')}>
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          material={material} onDone={() => setEdit(false)}
        />
      </Sheet>

      {/* ── Правка партии ────────────────────────────────────── */}
      <Sheet open={batchEdit !== null} onClose={() => setBatchEdit(null)}
             title={batchEdit === 'new'
               ? t('inventory.material.sheet.newBatch')
               : t('inventory.material.sheet.batch')}>
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
  const t = useT()
  const [number, setNumber] = useState(batch?.number ?? '')
  const [made, setMade] = useState(batch?.made ?? '')
  const [expiry, setExpiry] = useState(batch?.expiry ?? '')
  const [supplierId, setSupplierId] = useState(batch?.supplierId ?? '')

  return (
    <form className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); onSave({ number, made, expiry, supplierId }) }}>
      <div className="sm:col-span-2">
        <label className="field-label">{t('inventory.material.batchForm.number.label')}</label>
        <input required autoFocus className="input"
               placeholder={t('inventory.material.batchForm.number.placeholder')}
               value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.material.batchForm.made.label')}</label>
        <input type="date" className="input" max={expiry || undefined}
               value={made} onChange={(e) => setMade(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.material.batchForm.expiry.label')}</label>
        <input required type="date" className="input" min={made || undefined}
               value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className="field-label">{t('inventory.material.batchForm.supplier.label')}</label>
        <select className="select" value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t('inventory.common.notSet')}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p className="field-hint sm:col-span-2">{t('inventory.material.batchForm.hint')}</p>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !number.trim() || !expiry}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
