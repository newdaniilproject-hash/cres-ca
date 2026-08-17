'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useT } from '@/lib/i18n/client'
import { noteIfImmutable } from '@/lib/security-log'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_KEY } from '../../../inventory-client'
import { EXPIRY_BADGE, daysLeft, expiryState } from '@/lib/expiry'

type Container = {
  id: string; code: string; status: string
  volume: number | null; unit: string | null
  openedAt: string | null; useBy: string | null
  decantedAt: string | null; parentId: string | null
  paoMonths: number | null; note: string | null; batchId: string | null
}
type Batch = { id: string; number: string; expiry: string }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4"
         style={{ paddingBlock: 'var(--space-2)' }}>
      <span className="t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="tabular t-md min-w-0 text-right">{value}</span>
    </div>
  )
}

// Значения `material_containers.status` не переводятся — это ключи базы.
// Переводится подпись к ним.
const STATUS_KEY: Record<string, Key> = {
  sealed: 'inventory.pao.status.sealed',
  opened: 'inventory.pao.status.opened',
  finished: 'inventory.pao.status.finished',
  disposed: 'inventory.pao.status.disposed',
}

export function PaoControl({
  canOpen, canPrint, material, containers, batches, loadError,
}: {
  canOpen: boolean
  /**
   * Право на лист наклеек. Роут `/app/inventory/labels` требует
   * `stock.read` и осознанно отвечает 403 инспектору. Кнопка, которая
   * гарантированно приводит к 403, — это не защита, а сломанная
   * навигация, поэтому её просто нет.
   */
  canPrint: boolean
  material: { id: string; name: string; unit: string; paoMonths: number | null; isCosmetic: boolean }
  containers: Container[]
  batches: Batch[]
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  /** Подпись статуса ёмкости. Неизвестное значение показываем как есть. */
  const statusLabel = (status: string) =>
    (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status)

  const [busy, setBusy] = useState<string | null>(null)
  const [decantOf, setDecantOf] = useState<Container | null>(null)
  const [label, setLabel] = useState<{ code: string; id: string; text: string } | null>(null)

  // Розлив — это дочерняя ёмкость. Родительские банки и дозаторы
  // разделены не по объёму, а по происхождению: у дозатора есть parent_id.
  const jars = containers.filter((c) => c.parentId === null)
  const decants = containers.filter((c) => c.parentId !== null)
  const live = jars.filter((c) => c.status === 'sealed' || c.status === 'opened')

  const batchOf = (id: string | null) => batches.find((b) => b.id === id) ?? null

  async function open(c: Container) {
    setBusy(c.id)
    try {
      const { error } = await supabase.from('material_containers')
        .update({ status: 'opened' }).eq('id', c.id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      // Мастер вскрывает банку там, где стоит стеллаж, — связи может
      // не быть вовсе. Сетевая ошибка кладёт действие в очередь, ошибка
      // данных показывается честно: в очереди она не отправится никогда.
      if (isNetworkError(e)) {
        await enqueue(`${t('inventory.container.open')} · ${c.code}`,
          { kind: 'container.status', containerId: c.id, status: 'opened' })
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return
      }
      // Сторож ёмкости (0014/0044: «дата вскрытия не редактируется»)
      // роняет транзакцию — записать событие изнутри неё нельзя, оно
      // откатится вместе с попыткой. Пишем отсюда (0085, решение 4).
      const message = e instanceof Error ? e.message : String(e)
      void noteIfImmutable(supabase, message, 'ємність: відкриття')
      toast.error(t('inventory.pao.error.open'), message)
      return
    }
    setBusy(null)
    toast.success(t('inventory.container.opened.title'), t('inventory.container.opened.desc'))
    router.refresh()
  }

  async function finish(c: Container, disposed: boolean) {
    setBusy(c.id)
    const { error } = await supabase.from('material_containers')
      .update({ status: disposed ? 'disposed' : 'finished' }).eq('id', c.id)
    setBusy(null)
    if (error) {
      void noteIfImmutable(supabase, error.message, 'ємність: закриття')
      toast.error(t('inventory.container.saveError'), error.message); return
    }
    toast.success(disposed ? t('inventory.pao.disposed') : t('inventory.pao.finished'))
    router.refresh()
  }

  // Розлив идёт только функцией decant_container: она пишет партию,
  // код из пер-арендаторного счётчика и не даёт «омолодить» срок.
  // Прямой вставкой этого не повторить — и не нужно.
  async function decant(parent: Container, volume: number, note: string) {
    setBusy('decant')
    const { data, error } = await supabase.rpc('decant_container', {
      p_parent_id: parent.id,
      p_volume: volume,
      p_note: note.trim() || null,
    })
    if (error) {
      setBusy(null)
      toast.error(t('inventory.pao.decant.error'), error.message)
      return
    }
    const child = (Array.isArray(data) ? data[0] : data) as { id: string; code: string } | null
    if (!child) {
      setBusy(null)
      toast.error(t('inventory.pao.decant.error'), t('inventory.pao.decant.noRow'))
      return
    }

    // Наклейку берём у базы, а не собираем на экране: пять реквизитов
    // ТЗ отдаёт функция container_label, и она же печатается на бумаге.
    const { data: text } = await supabase.rpc('container_label', { p_container_id: child.id })
    setBusy(null)
    setDecantOf(null)
    setLabel({ code: child.code, id: child.id, text: String(text ?? '') })
    toast.success(t('inventory.pao.decant.created', { code: child.code }))
    router.refresh()
  }

  // Наклейку любой ёмкости отдаёт база одной строкой — тем же вызовом,
  // что печатается на бумаге. Собирать её второй раз на экране нельзя:
  // две сборки разъедутся, а реквизитов ровно пять и они из ТЗ.
  async function showLabel(c: Container) {
    setBusy(c.id)
    const { data, error } = await supabase.rpc('container_label', { p_container_id: c.id })
    setBusy(null)
    if (error) { toast.error(t('inventory.pao.label.error'), error.message); return }
    setLabel({ code: c.code, id: c.id, text: String(data ?? '') })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-sm rise" style={{ color: 'var(--color-muted)' }}>{material.name}</p>
      {loadError && <p className="field-error rise">{loadError}</p>}

      {material.isCosmetic && material.paoMonths == null && (
        <p className="field-hint rise">{t('inventory.pao.noPao')}</p>
      )}

      {/* ── Банки: учёт PAO по каждой ────────────────────────── */}
      {live.length === 0 ? (
        <div className="card rise-1 empty">{t('inventory.pao.empty')}</div>
      ) : live.map((c) => {
        const state = expiryState(c.useBy)
        const left = daysLeft(c.useBy)
        const b = batchOf(c.batchId)
        return (
          <section key={c.id} className="card rise-1">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="tabular t-lg">{c.code}</h3>
              <span className={EXPIRY_BADGE[state]}>
                {c.status === 'sealed'
                  ? t('inventory.pao.status.sealed')
                  : t(EXPIRY_KEY[state])}
              </span>
            </div>

            {/* Номер партии и объём — данные арендатора. */}
            <Row label={t('inventory.pao.row.batch')} value={b?.number ?? '—'} />
            <Row label={t('inventory.pao.row.volume')}
                 value={c.volume != null
                   ? `${t.number(c.volume)} ${c.unit ?? material.unit}`
                   : '—'} />
            <Row label={t('inventory.pao.row.openedAt')} value={t.date(c.openedAt)} />
            <Row label={t('inventory.pao.row.pao')}
                 value={(c.paoMonths ?? material.paoMonths)
                   ? t.plural('inventory.pao.months', (c.paoMonths ?? material.paoMonths)!)
                   : '—'} />
            <Row label={t('inventory.pao.row.useBy')}
                 value={c.useBy
                   ? <>{t.date(c.useBy)}{left != null && left >= 0
                       ? ` · ${t.plural('inventory.days', left)}`
                       : ''}</>
                   : t('inventory.pao.useBy.pending')} />
            <Row label={t('inventory.pao.row.status')} value={statusLabel(c.status)} />

            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === 'sealed' && canOpen && (
                <button className="btn-primary" disabled={busy === c.id}
                        onClick={() => void open(c)}>
                  {t('inventory.container.open')}
                </button>
              )}
              {c.status === 'opened' && canOpen && (
                <>
                  <button className="btn-primary" disabled={busy === c.id}
                          onClick={() => setDecantOf(c)}>
                    {t('inventory.pao.decant.create')}
                  </button>
                  <button className="btn-secondary" disabled={busy === c.id}
                          onClick={() => void finish(c, false)}>
                    {t('inventory.container.finished')}
                  </button>
                  <button className="btn-danger" disabled={busy === c.id}
                          onClick={() => void finish(c, true)}>
                    {t('inventory.container.dispose')}
                  </button>
                </>
              )}
              {canPrint && (
                <a href={`/app/inventory/labels?ids=${c.id}`} target="_blank" rel="noreferrer"
                   className="btn-ghost t-sm">{t('inventory.pao.print')}</a>
              )}
            </div>

            {c.status === 'sealed' && (
              <p className="field-hint mt-2">{t('inventory.pao.sealed.hint')}</p>
            )}
          </section>
        )
      })}

      {/* ── История розливов ─────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="t-sm" style={{ color: 'var(--color-faint)' }}>
            {t('inventory.pao.decants.title')}
          </h3>
          <span className="badge tabular">{t.number(decants.length)}</span>
        </div>
        {decants.length === 0 ? (
          <div className="empty !py-6">{t('inventory.pao.decants.empty')}</div>
        ) : decants.map((d) => {
          const state = expiryState(d.useBy)
          return (
            <div key={d.id} className="row px-5">
              <div className="min-w-0">
                <p className="tabular t-md">{d.code}
                  <span style={{ color: 'var(--color-faint)' }}>
                    {' '}· {d.volume != null ? t.number(d.volume) : '—'} {d.unit ?? material.unit}
                  </span>
                </p>
                <p className="tabular t-xs" style={{ color: 'var(--color-faint)' }}>
                  {t.date(d.decantedAt ?? d.openedAt)}
                  {d.note ? ` · ${d.note}` : ''}
                  {d.status !== 'opened' ? ` · ${statusLabel(d.status)}` : ''}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`tabular ${EXPIRY_BADGE[state]}`}>
                  {t('inventory.pao.decant.until', { date: t.date(d.useBy) })}
                </span>
                <button className="btn-icon" aria-label={t('inventory.pao.label.aria')}
                        disabled={busy === d.id}
                        onClick={() => void showLabel(d)}>▤</button>
              </span>
            </div>
          )
        })}
      </section>

      {/* ── Розлив ───────────────────────────────────────────── */}
      <Sheet open={decantOf !== null} onClose={() => setDecantOf(null)}
             title={t('inventory.pao.sheet.decant')}>
        {decantOf && (
          <DecantForm
            parent={decantOf}
            unit={decantOf.unit ?? material.unit}
            busy={busy === 'decant'}
            onSave={(v, note) => void decant(decantOf, v, note)}
            onCancel={() => setDecantOf(null)}
          />
        )}
      </Sheet>

      {/* ── Наклейка ─────────────────────────────────────────── */}
      <Sheet open={label !== null} onClose={() => setLabel(null)}
             title={t('inventory.pao.sheet.label')}>
        {label && (
          <div className="flex flex-col gap-3">
            <p className="tabular display t-2xl">{label.code}</p>
            <div className="card-flat">
              <p className="t-md" style={{ whiteSpace: 'pre-line' }}>
                {label.text.split(' · ').join('\n')}
              </p>
            </div>
            <p className="field-hint">{t('inventory.pao.label.hint')}</p>
            <div className="flex flex-wrap gap-2">
              <a href={`/app/inventory/labels?ids=${label.id}`} target="_blank" rel="noreferrer"
                 className="btn-primary">{t('inventory.pao.label.print')}</a>
              <button type="button" className="btn-ghost" onClick={() => setLabel(null)}>
                {t('inventory.common.close')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

// Дата и мастер на розливе не выбираются, и это не упрощение.
// Наклейка — часть неизменяемого журнала: «відповідальний майстер» там
// обязан быть тем, кто нажал кнопку, а «дата розливу» — моментом самого
// действия. Дать выбрать их в форме значит разрешить подписать чужим
// именем задним числом — ровно то, от чего защищает Audit Trail в ТЗ.
function DecantForm({
  parent, unit, busy, onSave, onCancel,
}: {
  parent: { code: string; volume: number | null }
  unit: string
  busy: boolean
  onSave: (volume: number, note: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [volume, setVolume] = useState('')
  const [note, setNote] = useState('')
  const v = Number(volume)
  const max = parent.volume ?? 0
  const tooMuch = max > 0 && v >= max

  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave(v, note) }}>
      <div className="card-flat">
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {t('inventory.pao.decant.from')}
        </p>
        <p className="tabular t-lg">{parent.code}
          {parent.volume != null && (
            <span style={{ color: 'var(--color-faint)' }}>
              {' '}· {t('inventory.pao.decant.rest', {
                volume: t.number(parent.volume), unit,
              })}
            </span>
          )}
        </p>
      </div>

      <div>
        <label className="field-label">
          {t('inventory.pao.decant.volume.label', { unit })}
        </label>
        <input required autoFocus type="number" min="0" step="any"
               className={tooMuch ? 'input input-error' : 'input'}
               placeholder="100" value={volume}
               onChange={(e) => setVolume(e.target.value)} />
        {tooMuch && (
          <p className="field-error">{t('inventory.pao.decant.tooMuch')}</p>
        )}
      </div>

      <div>
        <label className="field-label">{t('inventory.pao.decant.note.label')}</label>
        <input className="input" maxLength={100}
               placeholder={t('inventory.pao.decant.note.placeholder')}
               value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="field-hint">{note.length}/100</p>
      </div>

      <p className="field-hint">{t('inventory.pao.decant.hint')}</p>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !volume || v <= 0 || tooMuch}>
          {busy ? t('inventory.pao.decant.busy') : t('inventory.pao.decant.submit')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
