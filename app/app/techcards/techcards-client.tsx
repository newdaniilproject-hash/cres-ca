'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Card = {
  id: string; title: string; version: number; steps: unknown
  isActive: boolean; offeringId: string | null; offeringTitle: string | null
  createdAt: string
}
type Service = { id: string; title: string }

// В форме minutes живёт строкой: пустое поле — это «час не нормований»,
// а не ноль. В базу уходит число или null.
type Step = { title: string; detail: string; minutes: string }

type Draft = {
  title: string
  // Новая версия существующей карты: название менять нельзя, иначе
  // получится не версия, а вторая карта — версии связаны именно title
  // (unique (tenant_id, title, version)).
  lockTitle: boolean
  version: number
  offeringId: string
  steps: Step[]
}

const EMPTY_STEP: Step = { title: '', detail: '', minutes: '' }

// Шаги первых карт заводились под ключами из комментария миграции 0014
// («step», «solution», «note»). Читаем оба набора: иначе история версий,
// ради которой таблица и версионная, покажется пустой.
function normalizeSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>
    return {
      title: String(o.title ?? o.step ?? ''),
      detail: String(o.detail ?? o.solution ?? o.note ?? ''),
      minutes: o.minutes == null ? '' : String(o.minutes),
    }
  })
}

export function TechCardsClient({
  tenantId, userId, cards, services, loadError,
}: {
  tenantId: string; userId: string
  cards: Card[]; services: Service[]; loadError: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openVersion, setOpenVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Группировка по названию: карта — это не строка, а стопка версий.
  const groups = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const c of cards) {
      const list = map.get(c.title)
      if (list) list.push(c)
      else map.set(c.title, [c])
    }
    return Array.from(map.entries()).map(([title, items]) => {
      const versions = items.slice().sort((a, b) => b.version - a.version)
      return {
        title,
        versions,
        latest: versions[0],
        currentId: versions.find((v) => v.isActive)?.id ?? null,
      }
    })
  }, [cards])

  function startNew() {
    setErr('')
    setDraft({ title: '', lockTitle: false, version: 1, offeringId: '', steps: [{ ...EMPTY_STEP }] })
  }

  // Правки нет и быть не может — есть копия предыдущей версии как черновик
  // следующей. Мастеру это привычнее правки: он видит то, по чему работал.
  function startNextVersion(group: { title: string; latest: Card }) {
    setErr('')
    const base = normalizeSteps(group.latest.steps)
    setDraft({
      title: group.title,
      lockTitle: true,
      version: group.latest.version + 1,
      offeringId: group.latest.offeringId ?? '',
      steps: base.length > 0 ? base : [{ ...EMPTY_STEP }],
    })
  }

  function patchStep(index: number, patch: Partial<Step>) {
    setDraft((d) => d && {
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  function removeStep(index: number) {
    setDraft((d) => d && { ...d, steps: d.steps.filter((_, i) => i !== index) })
  }

  function moveStep(index: number, delta: number) {
    setDraft((d) => {
      if (!d) return d
      const to = index + delta
      if (to < 0 || to >= d.steps.length) return d
      const steps = d.steps.slice()
      const [moved] = steps.splice(index, 1)
      steps.splice(to, 0, moved)
      return { ...d, steps }
    })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    const steps = draft.steps
      .map((s) => ({
        title: s.title.trim(),
        detail: s.detail.trim(),
        minutes: s.minutes.trim() === '' ? null : Number(s.minutes),
      }))
      .filter((s) => s.title.length > 0)
    if (!title) { setErr('Вкажіть назву техкарти'); return }
    if (steps.length === 0) { setErr('Додайте хоча б один крок із назвою'); return }

    setBusy(true); setErr('')
    const { error } = await supabase.from('tech_cards').insert({
      tenant_id: tenantId,
      title,
      version: draft.version,
      steps,
      offering_id: draft.offeringId || null,
      approved_by: userId,
    })
    if (error) { setBusy(false); setErr(error.message); return }

    // Предыдущие версии перестают быть актуальными. Триггер tech_cards_guard
    // этому не мешает: он стережёт steps, title и version, а флаг is_active —
    // единственное, что у утверждённой карты разрешено менять.
    const { error: offError } = await supabase.from('tech_cards')
      .update({ is_active: false })
      .eq('tenant_id', tenantId)
      .eq('title', title)
      .lt('version', draft.version)
      .eq('is_active', true)

    setBusy(false)
    setDraft(null)
    if (offError) setErr(`Версію збережено, але попередні лишились активними: ${offError.message}`)
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString('uk-UA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <button className="btn-primary t-sm" onClick={startNew} disabled={draft !== null}>
          Нова техкарта
        </button>
        <Link href="/app/journals" className="btn-ghost">← Санітарні журнали</Link>
        <Link href="/app/documents" className="btn-ghost">Документи на матеріали</Link>
      </div>

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {draft && (
        <form onSubmit={save} className="card rise-1 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display t-lg">
              {draft.lockTitle ? `Нова версія: ${draft.title}` : 'Нова техкарта'}
            </h2>
            <span className="badge-accent tabular">версія {draft.version}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">Назва</label>
              <input
                required className="input" placeholder="Підготовка канекалону"
                value={draft.title} disabled={draft.lockTitle}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              {draft.lockTitle && (
                <p className="field-hint">
                  Назва звʼязує версії між собою, тому в новій версії вона незмінна.
                </p>
              )}
            </div>
            <div>
              <label className="field-label">Послуга</label>
              <select
                className="select" value={draft.offeringId}
                onChange={(e) => setDraft({ ...draft, offeringId: e.target.value })}
              >
                <option value="">Загальна для салону</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <p className="field-hint">Необовʼязково: карта може стосуватись усього салону.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {draft.steps.map((step, i) => (
              <div key={i} className="card-flat grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
                <div className="sm:col-span-3 flex items-center justify-between gap-2">
                  <span className="badge tabular">крок {i + 1}</span>
                  <span className="flex gap-1">
                    <button type="button" className="btn-icon" aria-label="Вище"
                            disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                    <button type="button" className="btn-icon" aria-label="Нижче"
                            disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                    <button type="button" className="btn-icon" aria-label="Видалити"
                            onClick={() => removeStep(i)}>✕</button>
                  </span>
                </div>
                <div>
                  <label className="field-label">Дія</label>
                  <input className="input" placeholder="Замочування"
                         value={step.title}
                         onChange={(e) => patchStep(i, { title: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">Як саме</label>
                  <input className="input" placeholder="Розчин соди 1:10, температура 40°C"
                         value={step.detail}
                         onChange={(e) => patchStep(i, { detail: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">Хвилин</label>
                  <input className="input" type="number" min="1" placeholder="15"
                         value={step.minutes}
                         onChange={(e) => patchStep(i, { minutes: e.target.value })} />
                </div>
              </div>
            ))}
            <button type="button" className="btn-secondary self-start"
                    onClick={() => setDraft({ ...draft, steps: [...draft.steps, { ...EMPTY_STEP }] })}>
              Додати крок
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Зберігаємо…' : `Затвердити версію ${draft.version}`}
            </button>
            <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => { setDraft(null); setErr('') }}>
              Скасувати
            </button>
          </div>
          <p className="field-hint">
            Після збереження цю версію не можна буде змінити — тільки випустити
            наступну. Так і має бути: по затвердженій карті вже працювали, і саме
            вона є доказом для перевірки.
          </p>
        </form>
      )}

      {groups.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>Техкарт ще немає.</p>
            <p className="prose-muted">
              Техкарта — це регламент обробки: чим замочуємо, у якій пропорції
              та скільки хвилин. Перевірка запитує саме її.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.title} className="card rise-2 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="display t-lg">{g.title}</h2>
                  <p className="tabular t-xs prose-muted">
                    {g.latest.offeringTitle ?? 'Загальна для салону'} · версій: {g.versions.length}
                  </p>
                </div>
                <button className="btn-secondary t-sm" disabled={draft !== null}
                        onClick={() => startNextVersion(g)}>
                  Створити нову версію
                </button>
              </div>

              <div className="flex flex-col">
                {g.versions.map((v) => {
                  const steps = normalizeSteps(v.steps)
                  const open = openVersion === v.id
                  return (
                    <div key={v.id}>
                      <div className="row">
                        <button className="btn-ghost tabular !px-0"
                                onClick={() => setOpenVersion(open ? null : v.id)}>
                          <span aria-hidden>{open ? '▾' : '▸'}</span>
                          Версія {v.version} · {fmt(v.createdAt)} · кроків: {steps.length}
                        </button>
                        <span className={v.id === g.currentId ? 'badge-success' : 'badge'}>
                          {v.id === g.currentId ? 'чинна' : 'архів'}
                        </span>
                      </div>
                      {open && (
                        <ol className="t-md flex flex-col gap-2 pb-3 pl-5">
                          {steps.length === 0 && <li className="prose-muted">Кроків не записано</li>}
                          {steps.map((s, i) => (
                            <li key={i}>
                              <span className="font-medium">{i + 1}. {s.title}</span>
                              {s.minutes && <span className="prose-muted"> · {s.minutes} хв</span>}
                              {s.detail && <p className="t-xs prose-muted">{s.detail}</p>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="field-hint rise-3">
        Стару версію неможливо ані виправити, ані видалити: по ній уже працювали,
        і вона доводить, за яким регламентом оброблявся матеріал у той період.
        Зміна регламенту — це завжди нова версія, попередня лишається в історії.
      </p>
    </div>
  )
}
