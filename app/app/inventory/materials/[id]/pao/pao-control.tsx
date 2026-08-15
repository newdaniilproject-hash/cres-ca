'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { EXPIRY_BADGE, EXPIRY_LABEL, daysLeft, expiryState, fmtDate } from '@/lib/expiry'

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

const STATUS_LABEL: Record<string, string> = {
  sealed: 'Запечатана',
  opened: 'Відкрита',
  finished: 'Закінчилась',
  disposed: 'Списана',
}

export function PaoControl({
  canOpen, material, containers, batches, loadError,
}: {
  canOpen: boolean
  material: { id: string; name: string; unit: string; paoMonths: number | null; isCosmetic: boolean }
  containers: Container[]
  batches: Batch[]
  loadError: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

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
        await enqueue(`Відкрити банку · ${c.code}`,
          { kind: 'container.status', containerId: c.id, status: 'opened' })
        toast.info('Збережено офлайн', 'Надішлеться само, щойно зʼявиться мережа.')
        return
      }
      toast.error('Не вдалося відкрити', e instanceof Error ? e.message : String(e))
      return
    }
    setBusy(null)
    toast.success('Банку відкрито', 'Термін придатності перераховано за PAO.')
    router.refresh()
  }

  async function finish(c: Container, disposed: boolean) {
    setBusy(c.id)
    const { error } = await supabase.from('material_containers')
      .update({ status: disposed ? 'disposed' : 'finished' }).eq('id', c.id)
    setBusy(null)
    if (error) { toast.error('Не вдалося зберегти', error.message); return }
    toast.success(disposed ? 'Ємність списано' : 'Ємність закрито')
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
      toast.error('Розлив не виконано', error.message)
      return
    }
    const child = (Array.isArray(data) ? data[0] : data) as { id: string; code: string } | null
    if (!child) { setBusy(null); toast.error('Розлив не виконано', 'База не повернула ємність'); return }

    // Наклейку берём у базы, а не собираем на экране: пять реквизитов
    // ТЗ отдаёт функция container_label, и она же печатается на бумаге.
    const { data: text } = await supabase.rpc('container_label', { p_container_id: child.id })
    setBusy(null)
    setDecantOf(null)
    setLabel({ code: child.code, id: child.id, text: String(text ?? '') })
    toast.success(`Дозатор ${child.code} створено`)
    router.refresh()
  }

  // Наклейку любой ёмкости отдаёт база одной строкой — тем же вызовом,
  // что печатается на бумаге. Собирать её второй раз на экране нельзя:
  // две сборки разъедутся, а реквизитов ровно пять и они из ТЗ.
  async function showLabel(c: Container) {
    setBusy(c.id)
    const { data, error } = await supabase.rpc('container_label', { p_container_id: c.id })
    setBusy(null)
    if (error) { toast.error('Наліпку не отримано', error.message); return }
    setLabel({ code: c.code, id: c.id, text: String(data ?? '') })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-sm rise" style={{ color: 'var(--color-muted)' }}>{material.name}</p>
      {loadError && <p className="field-error rise">{loadError}</p>}

      {material.isCosmetic && material.paoMonths == null && (
        <p className="field-hint rise">
          PAO у картці засобу не вказаний. Тоді термін після відкриття
          дорівнює терміну партії — а це не те, що вимагає техрегламент.
          Впишіть значок відкритої баночки з етикетки.
        </p>
      )}

      {/* ── Банки: учёт PAO по каждой ────────────────────────── */}
      {live.length === 0 ? (
        <div className="card rise-1 empty">
          Відкритих чи запечатаних банок немає. Заведіть банку на складі —
          і сюди прийде облік її терміну після відкриття.
        </div>
      ) : live.map((c) => {
        const state = expiryState(c.useBy)
        const left = daysLeft(c.useBy)
        const b = batchOf(c.batchId)
        return (
          <section key={c.id} className="card rise-1">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="tabular t-lg">{c.code}</h3>
              <span className={EXPIRY_BADGE[state]}>
                {c.status === 'sealed' ? STATUS_LABEL.sealed : EXPIRY_LABEL[state]}
              </span>
            </div>

            <Row label="Партія" value={b?.number ?? '—'} />
            <Row label="Обʼєм" value={c.volume != null ? `${c.volume} ${c.unit ?? material.unit}` : '—'} />
            <Row label="Дата відкриття" value={fmtDate(c.openedAt)} />
            <Row label="PAO (період)"
                 value={(c.paoMonths ?? material.paoMonths) ? `${c.paoMonths ?? material.paoMonths} місяців` : '—'} />
            <Row label="Розрахований термін дії"
                 value={c.useBy
                   ? <>{fmtDate(c.useBy)}{left != null && left >= 0 ? ` · ${left} дн` : ''}</>
                   : 'порахується при відкритті'} />
            <Row label="Статус" value={STATUS_LABEL[c.status] ?? c.status} />

            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === 'sealed' && canOpen && (
                <button className="btn-primary" disabled={busy === c.id}
                        onClick={() => void open(c)}>
                  Відкрити банку
                </button>
              )}
              {c.status === 'opened' && canOpen && (
                <>
                  <button className="btn-primary" disabled={busy === c.id}
                          onClick={() => setDecantOf(c)}>
                    Створити QR-код розливу
                  </button>
                  <button className="btn-secondary" disabled={busy === c.id}
                          onClick={() => void finish(c, false)}>
                    Закінчилась
                  </button>
                  <button className="btn-danger" disabled={busy === c.id}
                          onClick={() => void finish(c, true)}>
                    Списати
                  </button>
                </>
              )}
              <a href={`/app/inventory/labels?ids=${c.id}`} target="_blank" rel="noreferrer"
                 className="btn-ghost t-sm">Друк наліпки</a>
            </div>

            {c.status === 'sealed' && (
              <p className="field-hint mt-2">
                Термін після відкриття порахується в момент натискання:
                менше з двох — термін партії або сьогодні плюс PAO.
              </p>
            )}
          </section>
        )
      })}

      {/* ── История розливов ─────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="t-sm" style={{ color: 'var(--color-faint)' }}>ІСТОРІЯ РОЗЛИВІВ</h3>
          <span className="badge tabular">{decants.length}</span>
        </div>
        {decants.length === 0 ? (
          <div className="empty !py-6">
            Розливів ще не було. Коли переллєте засіб у робочий дозатор,
            система згенерує внутрішній код і наліпку з пʼятьма реквізитами.
          </div>
        ) : decants.map((d) => {
          const state = expiryState(d.useBy)
          return (
            <div key={d.id} className="row px-5">
              <div className="min-w-0">
                <p className="tabular t-md">{d.code}
                  <span style={{ color: 'var(--color-faint)' }}>
                    {' '}· {d.volume ?? '—'} {d.unit ?? material.unit}
                  </span>
                </p>
                <p className="tabular t-xs" style={{ color: 'var(--color-faint)' }}>
                  {fmtDate(d.decantedAt ?? d.openedAt)}
                  {d.note ? ` · ${d.note}` : ''}
                  {d.status !== 'opened' ? ` · ${STATUS_LABEL[d.status] ?? d.status}` : ''}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`tabular ${EXPIRY_BADGE[state]}`}>до {fmtDate(d.useBy)}</span>
                <button className="btn-icon" aria-label="Наліпка" disabled={busy === d.id}
                        onClick={() => void showLabel(d)}>▤</button>
              </span>
            </div>
          )
        })}
      </section>

      {/* ── Розлив ───────────────────────────────────────────── */}
      <Sheet open={decantOf !== null} onClose={() => setDecantOf(null)}
             title="Створення QR-коду розливу">
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
      <Sheet open={label !== null} onClose={() => setLabel(null)} title="Наліпка на дозатор">
        {label && (
          <div className="flex flex-col gap-3">
            <p className="tabular display t-2xl">{label.code}</p>
            <div className="card-flat">
              <p className="t-md" style={{ whiteSpace: 'pre-line' }}>
                {label.text.split(' · ').join('\n')}
              </p>
            </div>
            <p className="field-hint">
              Пʼять реквізитів ТЗ: назва, партія, дата розливу, відповідальний
              майстер і кінцевий термін. Роздрукуйте наліпку — на ній ще й
              QR-код, за яким дозатор відкривається скануванням.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`/app/inventory/labels?ids=${label.id}`} target="_blank" rel="noreferrer"
                 className="btn-primary">Друк наліпки з QR</a>
              <button type="button" className="btn-ghost" onClick={() => setLabel(null)}>
                Закрити
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
  const [volume, setVolume] = useState('')
  const [note, setNote] = useState('')
  const v = Number(volume)
  const max = parent.volume ?? 0
  const tooMuch = max > 0 && v >= max

  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave(v, note) }}>
      <div className="card-flat">
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>З ємності</p>
        <p className="tabular t-lg">{parent.code}
          {parent.volume != null && (
            <span style={{ color: 'var(--color-faint)' }}> · залишок {parent.volume} {unit}</span>
          )}
        </p>
      </div>

      <div>
        <label className="field-label">Обʼєм розливу, {unit}</label>
        <input required autoFocus type="number" min="0" step="any"
               className={tooMuch ? 'input input-error' : 'input'}
               placeholder="100" value={volume}
               onChange={(e) => setVolume(e.target.value)} />
        {tooMuch && (
          <p className="field-error">
            Більше, ніж є в банці. Порожню банку закривають статусом
            «Закінчилась», а не розливом у нуль.
          </p>
        )}
      </div>

      <div>
        <label className="field-label">Примітка</label>
        <input className="input" maxLength={100} placeholder="робоча ємність №1"
               value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="field-hint">{note.length}/100</p>
      </div>

      <p className="field-hint">
        Дата розливу і відповідальний майстер підставляються самі — це ви
        і зараз. Вони йдуть у незмінюваний журнал і на наліпку, тому
        вибирати їх не можна: підпис чужим імʼям зруйнував би доказовість.
      </p>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !volume || v <= 0 || tooMuch}>
          {busy ? 'Розливаємо…' : 'Зберегти QR-код'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  )
}
