'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { noteIfImmutable } from '@/lib/security-log'
import { dbErrorText } from '@/lib/errors/db'

// Дата выпуска версии — «12 січ. 2024». Набор опций, а не своя `fmt`:
// форматирует `t.date`, то есть локаль, а не экран.
const DAY: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', year: 'numeric',
}

type Card = {
  id: string; title: string; version: number; steps: unknown
  isActive: boolean; offeringId: string | null; offeringTitle: string | null
  createdAt: string
}
type Service = { id: string; title: string }

// Ключи шага заданы ТЗ 3.4 — «використані розчини, пропорції, час витримки»,
// и отчёт для проверяющего читает именно их: step / solution / proportion /
// minutes / note (lib/report/sanitation-report.ts).
//
// ГРАБЛЯ 14.08.2026, ради которой это переписано. Экран писал свои ключи
// (title / detail / minutes), отчёт читал ТЗ-шные — и у карты, заведённой
// через интерфейс, в документе печаталась пустая строка «<b></b>, N хв».
// То есть проверяющему показывали бумагу, в которой нет ровно того, ради
// чего пункт ТЗ написан: раствора и пропорции. Экран приведён к отчёту,
// а не наоборот, потому что имена полей здесь диктует ТЗ, а не вёрстка.
//
// В форме minutes живёт строкой: пустое поле — это «час не нормований»,
// а не ноль. В базу уходит число или null.
type Step = {
  step: string
  solution: string
  proportion: string
  minutes: string
  note: string
}

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

const EMPTY_STEP: Step = { step: '', solution: '', proportion: '', minutes: '', note: '' }

// Читаем ТРИ поколения ключей, иначе история версий — ради которой таблица
// и версионная — покажется пустой:
// 1) нынешние, они же ТЗ-шные: step / solution / proportion / minutes / note;
// 2) экранные до 14.08.2026: title / detail / minutes. `detail` был одним
//    полем «как саме», куда писали и раствор, и пропорцию вперемешку, —
//    кладём его в solution, разделить задним числом нечем;
// 3) самые первые, из комментария миграции 0014: step / solution / note.
function normalizeSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>
    return {
      step: String(o.step ?? o.title ?? ''),
      solution: String(o.solution ?? o.detail ?? ''),
      proportion: String(o.proportion ?? ''),
      minutes: o.minutes == null ? '' : String(o.minutes),
      note: String(o.note ?? ''),
    }
  })
}

export function TechCardsClient({
  tenantId, userId, canWrite, cards, services, loadError,
}: {
  tenantId: string; userId: string
  /**
   * `compliance.write` — выпуск новой версии карты. Читателю без него
   * (инспектор, наблюдатель, мастер) кнопок не показываем: утверждение
   * упёрлось бы в `tech_cards_insert` (0014).
   */
  canWrite: boolean
  cards: Card[]; services: Service[]; loadError: string
}) {
  const t = useT()
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
        step: s.step.trim(),
        solution: s.solution.trim() || null,
        proportion: s.proportion.trim() || null,
        minutes: s.minutes.trim() === '' ? null : Number(s.minutes),
        note: s.note.trim() || null,
      }))
      .filter((s) => s.step.length > 0)
    if (!title) { setErr(t('techcards.error.noTitle')); return }
    if (steps.length === 0) { setErr(t('techcards.error.noSteps')); return }

    setBusy(true); setErr('')
    const { error } = await supabase.from('tech_cards').insert({
      tenant_id: tenantId,
      title,
      version: draft.version,
      steps,
      offering_id: draft.offeringId || null,
      approved_by: userId,
    })
    if (error) { setBusy(false); setErr(dbErrorText(t, error)); return }

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
    // Текст отказа базы подставляется КАК ЕСТЬ — он её, а не наш.
    if (offError) {
      // Сюда попадает и сторож утверждённой карты (0014). Он роняет
      // транзакцию, поэтому событие пишется отсюда, уже снаружи неё
      // (0085, решение 4), а не из самой базы.
      void noteIfImmutable(supabase, offError.message, 'техкарта: зняття попередніх версій', tenantId)
      setErr(t('techcards.error.activeLeft', { error: dbErrorText(t, offError) }))
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        {canWrite && (
          <button className="btn-primary t-sm" onClick={startNew} disabled={draft !== null}>
            {t('techcards.new')}
          </button>
        )}
        <Link href="/app/journals" className="btn-ghost">{t('techcards.nav.journals')}</Link>
        <Link href="/app/documents" className="btn-ghost">{t('techcards.nav.documents')}</Link>
      </div>

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {draft && (
        <form onSubmit={save} className="card rise-1 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display t-lg">
              {/* Назва техкарти — данные заклада, она приезжает подстановкой. */}
              {draft.lockTitle
                ? t('techcards.draft.newVersion', { title: draft.title })
                : t('techcards.new')}
            </h2>
            <span className="badge-accent tabular">
              {t('techcards.draft.version', { n: t.number(draft.version) })}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">{t('techcards.field.title.label')}</label>
              <input
                required className="input" placeholder={t('techcards.field.title.placeholder')}
                value={draft.title} disabled={draft.lockTitle}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              {draft.lockTitle && (
                <p className="field-hint">{t('techcards.field.title.hint')}</p>
              )}
            </div>
            <div>
              <label className="field-label">{t('techcards.field.service.label')}</label>
              <select
                className="select" value={draft.offeringId}
                onChange={(e) => setDraft({ ...draft, offeringId: e.target.value })}
              >
                <option value="">{t('techcards.field.service.general')}</option>
                {/* Назви послуг — данные каталога заклада. */}
                {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <p className="field-hint">{t('techcards.field.service.hint')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {draft.steps.map((step, i) => (
              <div key={i} className="card-flat grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
                <div className="sm:col-span-3 flex items-center justify-between gap-2">
                  <span className="badge tabular">
                    {t('techcards.step.badge', { n: t.number(i + 1) })}
                  </span>
                  {/* Подписи для скринридера: стрелку и крестик он не прочтёт. */}
                  <span className="flex gap-1">
                    <button type="button" className="btn-icon" aria-label={t('techcards.step.up.aria')}
                            disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
                    <button type="button" className="btn-icon" aria-label={t('techcards.step.down.aria')}
                            disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
                    <button type="button" className="btn-icon" aria-label={t('common.delete')}
                            onClick={() => removeStep(i)}>✕</button>
                  </span>
                </div>
                <div>
                  <label className="field-label">{t('techcards.step.action.label')}</label>
                  <input className="input" placeholder={t('techcards.step.action.placeholder')}
                         value={step.step}
                         onChange={(e) => patchStep(i, { step: e.target.value })} />
                </div>
                {/* Розчин і пропорція — ОТДЕЛЬНЫМИ полями, а не одной строкой.
                    ТЗ 3.4 называет их порознь, и отчёт для проверяющего печатает
                    их порознь: «Замочування — розчин соди, пропорція 1:10, 15 хв». */}
                <div>
                  <label className="field-label">{t('techcards.step.solution.label')}</label>
                  <input className="input" placeholder={t('techcards.step.solution.placeholder')}
                         value={step.solution}
                         onChange={(e) => patchStep(i, { solution: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('techcards.step.proportion.label')}</label>
                  <input className="input" placeholder={t('techcards.step.proportion.placeholder')}
                         value={step.proportion}
                         onChange={(e) => patchStep(i, { proportion: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('techcards.step.minutes.label')}</label>
                  <input className="input" type="number" min="1"
                         placeholder={t('techcards.step.minutes.placeholder')}
                         value={step.minutes}
                         onChange={(e) => patchStep(i, { minutes: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('techcards.step.note.label')}</label>
                  <input className="input" placeholder={t('techcards.step.note.placeholder')}
                         value={step.note}
                         onChange={(e) => patchStep(i, { note: e.target.value })} />
                </div>
              </div>
            ))}
            <button type="button" className="btn-secondary self-start"
                    onClick={() => setDraft({ ...draft, steps: [...draft.steps, { ...EMPTY_STEP }] })}>
              {t('techcards.step.add')}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy}>
              {busy
                ? t('common.saving')
                : t('techcards.submit', { n: t.number(draft.version) })}
            </button>
            <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => { setDraft(null); setErr('') }}>
              {t('common.cancel')}
            </button>
          </div>
          <p className="field-hint">{t('techcards.form.hint')}</p>
        </form>
      )}

      {groups.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>{t('techcards.empty.title')}</p>
            <p className="prose-muted">{t('techcards.empty.desc')}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.title} className="card rise-2 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {/* Назва техкарти і назва послуги — данные заклада. */}
                  <h2 className="display t-lg">{g.title}</h2>
                  {/* «Загальна для салону» — только когда услуги и правда
                      нет. Название приходит из `compliance_offerings`
                      (0083) и есть у всех, кто видит карту, включая
                      инспектора; подпись «привʼязана до послуги» без
                      названия осталась как последняя защита: подписать
                      привязанную карту «загальною» значит соврать
                      про регламент. */}
                  <p className="tabular t-xs prose-muted">
                    {g.latest.offeringTitle
                      ?? (g.latest.offeringId
                        ? t('techcards.card.linked')
                        : t('techcards.field.service.general'))}
                    {' · '}
                    {t('techcards.card.versions', { n: t.number(g.versions.length) })}
                  </p>
                </div>
                {canWrite && (
                  <button className="btn-secondary t-sm" disabled={draft !== null}
                          onClick={() => startNextVersion(g)}>
                    {t('techcards.card.newVersion')}
                  </button>
                )}
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
                          {t('techcards.version.line', {
                            n: t.number(v.version),
                            date: t.date(v.createdAt, DAY),
                            steps: t.number(steps.length),
                          })}
                        </button>
                        <span className={v.id === g.currentId ? 'badge-success' : 'badge'}>
                          {v.id === g.currentId
                            ? t('techcards.version.current')
                            : t('techcards.version.archived')}
                        </span>
                      </div>
                      {open && (
                        <ol className="t-md flex flex-col gap-2 pb-3 pl-5">
                          {steps.length === 0 && (
                            <li className="prose-muted">{t('techcards.steps.empty')}</li>
                          )}
                          {/* Текст шага, раствор, пропорция и примечание —
                              регламент заклада, то есть данные: они не
                              переводятся. Переводится только обвязка. */}
                          {steps.map((s, i) => (
                            <li key={i}>
                              <span className="font-medium">{i + 1}. {s.step}</span>
                              {s.minutes && (
                                <span className="prose-muted">
                                  {' · '}{t('techcards.step.minutesShort', { n: s.minutes })}
                                </span>
                              )}
                              {(s.solution || s.proportion) && (
                                <p className="t-xs prose-muted">
                                  {s.solution}
                                  {s.solution && s.proportion ? ', ' : ''}
                                  {s.proportion
                                    && t('techcards.step.proportionShort', { value: s.proportion })}
                                </p>
                              )}
                              {s.note && <p className="t-xs prose-muted">{s.note}</p>}
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

      <p className="field-hint rise-3">{t('techcards.footer')}</p>
    </div>
  )
}
