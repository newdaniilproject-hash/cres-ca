'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { noteIfImmutable } from '@/lib/security-log'
import { dbErrorText } from '@/lib/errors/db'
import {
  IconBack, IconCalendar, IconClipboard, IconLayers, IconPlus, IconScissors,
} from '@/components/icons'

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

// Карта — это не строка, а стопка версий, поэтому группа, а не запись.
type Group = { title: string; versions: Card[]; latest: Card; currentId: string | null }

// Вкладки веб-версии. Делят карты по тому, единственному признаку,
// который у них есть данными: привязана карта к услуге или общая для
// салона. Вкладок «опубліковані / чернетки», как в других разделах,
// здесь нет и быть не может: утверждённая карта чернеткой не бывает —
// она утверждается сразу и навсегда (0014).
type Tab = 'all' | 'linked' | 'general'

// ── Список версий: ОДНО тело на обе раскладки ──────────────────────────
//
// На телефоне он внутри карточки, на вебе — под строкой таблицы. Вторая
// копия разъехалась бы с первой на первой правке (урок М43, «картка
// учасника»), а расходятся такие пары всегда и молча.
function VersionList({ t, group, openVersion, setOpenVersion }: {
  t: T
  group: Group
  openVersion: string | null
  setOpenVersion: (id: string | null) => void
}) {
  return (
    <div className="flex flex-col">
      {group.versions.map((v) => {
        const steps = normalizeSteps(v.steps)
        const open = openVersion === v.id
        return (
          <div key={v.id}>
            <div className="row">
              <button className="btn-ghost tabular !px-0"
                      style={{ minHeight: 'var(--tap-min)' }}
                      onClick={() => setOpenVersion(open ? null : v.id)}>
                <span aria-hidden>{open ? '▾' : '▸'}</span>
                {t('techcards.version.line', {
                  n: t.number(v.version),
                  date: t.date(v.createdAt, DAY),
                  steps: t.number(steps.length),
                })}
              </button>
              <span className={v.id === group.currentId ? 'badge-success' : 'badge'}>
                {v.id === group.currentId
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
  )
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
  // Вкладка, открытая карточка и шаг визарда — только веб-версия.
  // На телефоне вкладок нет, значение остаётся 'all', карточка не
  // рисуется вовсе (`hidden lg:*`), и мобильный список видит все карты,
  // как и раньше.
  const [tab, setTab] = useState<Tab>('all')
  // README §6 (`techItem`): картка техкарти. Отдельного адреса
  // `/app/techcards/<id>` в продукте нет, и заводить его ради веб-вида
  // значит менять навигацию, а не вид, — поэтому карточка живёт
  // состоянием клиента: строка таблицы открывает её на месте списка.
  // Ключ — НАЗВАНИЕ группы, а не id версии: карта это стопка версий,
  // и после выпуска новой версии карточка обязана остаться открытой.
  const [webCard, setWebCard] = useState<string | null>(null)
  const [cardTab, setCardTab] = useState<'steps' | 'history'>('steps')
  // README §7 (`techNew`): шаг визарда. Из пяти шагов макета данными
  // существуют три: Основне · Етапи · Перевірка. «Матеріали» — это
  // `variant_materials` каталога (расход, а не регламент; М43 то же
  // решение у карточки засоба), «Примітки» отдельным полем карта
  // не хранит — примітка живёт в каждом шаге.
  const [wstep, setWstep] = useState(0)

  // Группировка по названию: карта — это не строка, а стопка версий.
  const groups = useMemo<Group[]>(() => {
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

  // Счётчики вкладок считаются по последней версии карты: именно она
  // говорит, к чему карта относится сегодня.
  const linked = useMemo(() => groups.filter((g) => g.latest.offeringId), [groups])
  const general = useMemo(() => groups.filter((g) => !g.latest.offeringId), [groups])
  const shownGroups = tab === 'linked' ? linked : tab === 'general' ? general : groups

  const tabItems: [Tab, string, number][] = [
    ['all', t('techcards.web.tab.all'), groups.length],
    ['linked', t('techcards.web.tab.linked'), linked.length],
    ['general', t('techcards.web.tab.general'), general.length],
  ]

  // Колонки §5. «Категорія» заменена на «Версії»: категорий у техкарты
  // нет ни в базе, ни по смыслу — регламент не товар, — а число версий
  // это то, ради чего таблица версионная. Мініатюра заменена значком:
  // фотографии у регламента нет и не будет, а серый квадрат читается
  // как несостоявшаяся загрузка.
  const WGRID = '2.4fr 1.4fr 1.2fr 1fr 1.1fr 40px'

  // Открытая карточка ищется в СВЕЖИХ группах, а не хранится копией:
  // после `router.refresh()` пропсы новые, и копия показывала бы
  // вчерашнюю версию. Исчезла группа (сменилось название при выпуске
  // из другого окна) — карточка молча закрывается в список.
  const webGroup = webCard ? groups.find((g) => g.title === webCard) ?? null : null
  // Карточка показывает ЧИННУ версию — ту, по которой салон работает
  // сегодня; если активной нет (все сняты), показывается последняя.
  const webVersion = webGroup
    ? webGroup.versions.find((v) => v.id === webGroup.currentId) ?? webGroup.latest
    : null
  const webSteps = webVersion ? normalizeSteps(webVersion.steps) : []

  function startNew() {
    setErr('')
    setWstep(0)
    setDraft({ title: '', lockTitle: false, version: 1, offeringId: '', steps: [{ ...EMPTY_STEP }] })
  }

  // Правки нет и быть не может — есть копия предыдущей версии как черновик
  // следующей. Мастеру это привычнее правки: он видит то, по чему работал.
  function startNextVersion(group: { title: string; latest: Card }) {
    setErr('')
    setWstep(0)
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

  // «Далі» визарда пускает вперёд только через ту же проверку, что и
  // сохранение: пустое название или пустые шаги на «Перевірці» означали
  // бы отказ в самом конце — там, где человек уже ничего не заполняет.
  function nextStep() {
    if (!draft) return
    setErr('')
    if (wstep === 0 && !draft.title.trim()) { setErr(t('techcards.error.noTitle')); return }
    if (wstep === 1 && !draft.steps.some((s) => s.step.trim())) {
      setErr(t('techcards.error.noSteps')); return
    }
    setWstep((w) => Math.min(2, w + 1))
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
    <div className="flex flex-col gap-4">
      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, которым его называет панель
          и вкладка браузера; справа — то же единственное действие,
          что и на телефоне: выпуск новой карты.

          Хедер, метрики, вкладки и таблица НЕ рисуются, пока на lg
          открыта карточка (§6) или визард (§7): в README это отдельные
          экраны с «Назад до техкарт», а не панель поверх списка.
          Мобильной раскладки условие не касается — все эти блоки
          и так `hidden` ниже lg. */}
      {!draft && !webGroup && (
      <div className="hidden items-center justify-between lg:flex">
        <h1 className="webh1">{t('app.screen.techcards.title')}</h1>
        {canWrite && (
          <button type="button" className="btn-primary" onClick={startNew}>
            {t('techcards.new')}
          </button>
        )}
      </div>
      )}

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Те же три числа, что и в мобильном ряду ниже, в виде .wmetric
          с иконкой-плашкой. Плитки не нажимаются: фильтр живёт
          во вкладках, и второй орган управления с тем же действием —
          это два входа в одно место. */}
      {!draft && !webGroup && (
      <section className="rise hidden gap-4 lg:grid lg:grid-cols-3">
        {([
          { key: 'cards', n: groups.length, label: t('techcards.stats.cards'), tone: 'violet', icon: IconClipboard },
          { key: 'linked', n: linked.length, label: t('techcards.stats.linked'), tone: 'blue', icon: IconScissors },
          { key: 'versions', n: cards.length, label: t('techcards.stats.versions'), tone: 'emerald', icon: IconLayers },
        ] as const).map((s) => (
          <div key={s.key} className="wmetric">
            <span className="min-w-0">
              <span className="wmetric-label block">{s.label}</span>
              <span className="wmetric-value tabular block">{t.number(s.n)}</span>
            </span>
            <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
          </div>
        ))}
      </section>
      )}

      {/* README, розділ G: «стат-хедер». Сетки миниатюр из макета здесь
          НЕТ намеренно: у техкарты нет ни фото, ни чего-либо, что можно
          показать картинкой, — это регламент обработки. Плитка с пустым
          серым квадратом честнее не станет.

          Числа настоящие и отвечают на разные вопросы: сколько карт
          всего, сколько из них привязано к услуге (остальные общие
          по салону) и сколько версий выпущено — последнее и есть
          показатель того, что регламент живёт, а не лежит. */}
      <section className="rise grid grid-cols-3 gap-2 lg:hidden">
        <div className="metric">
          <span className="metric-value tabular">{t.number(groups.length)}</span>
          <span className="metric-label">{t('techcards.stats.cards')}</span>
        </div>
        <div className="metric" data-tone="blue">
          <span className="metric-value tabular">
            {t.number(groups.filter((g) => g.latest.offeringId).length)}
          </span>
          <span className="metric-label">{t('techcards.stats.linked')}</span>
        </div>
        <div className="metric">
          <span className="metric-value tabular">{t.number(cards.length)}</span>
          <span className="metric-label">{t('techcards.stats.versions')}</span>
        </div>
      </section>

      {/* Ссылок на «Журнали» и «Документи» здесь больше нет: оба раздела
          лежат под аватаром, и второй вход в них с этого экрана —
          дублирование навигации. Единственное действие экрана —
          создать техкарту, и оно одно. */}
      {canWrite && (
        <button className="btn-primary rise-1 lg:hidden" onClick={startNew}
                disabled={draft !== null}>
          {t('techcards.new')}
        </button>
      )}

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {draft && (
        <form onSubmit={save} className="card rise-1 flex flex-col gap-4">
          {/* ── CRESKO Web §7: шапка визарда (только lg) ────────────
              «Назад до техкарт» закрывает черновик — черновика в базе
              не существует, карта затверджується одразу (0014), поэтому
              и кнопки «Зберегти чернетку» из макета здесь нет: она
              обещала бы то, чего модель данных не делает. Справа —
              навигация по шагам; затвердження только с последнего. */}
          <div className="hidden flex-col gap-3 lg:flex">
            <button type="button"
                    className="btn-ghost self-start !px-0"
                    onClick={() => { setDraft(null); setErr('') }}>
              <IconBack size={18} />
              {t('techcards.webitem.back')}
            </button>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="webh1" data-size="27">
                  {/* Назва техкарти — данные заклада. */}
                  {draft.lockTitle
                    ? t('techcards.draft.newVersion', { title: draft.title })
                    : t('techcards.new')}
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                  {t('techcards.wizard.subtitle')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="badge-accent tabular">
                  {t('techcards.draft.version', { n: t.number(draft.version) })}
                </span>
                {wstep > 0 && (
                  <button type="button" className="btn-secondary"
                          onClick={() => { setErr(''); setWstep((w) => Math.max(0, w - 1)) }}>
                    {t('techcards.wizard.prev')}
                  </button>
                )}
                {wstep < 2 ? (
                  <button type="button" className="btn-primary" onClick={nextStep}>
                    {t('techcards.wizard.next')}
                  </button>
                ) : (
                  <button className="btn-primary" disabled={busy}>
                    {busy
                      ? t('common.saving')
                      : t('techcards.submit', { n: t.number(draft.version) })}
                  </button>
                )}
              </div>
            </div>
            {/* Стрічка шагов из README: кружечок 24px с номером, подпись
                14/650, активный подчёркнут акцентом. Назад по стрічке
                можно, вперёд — только через «Далі» с проверкой. */}
            <div className="flex" style={{ gap: 34 }}>
              {([
                t('techcards.wizard.step.basics'),
                t('techcards.wizard.step.steps'),
                t('techcards.wizard.step.review'),
              ] as const).map((label, i) => (
                <button key={label} type="button"
                        onClick={() => { if (i < wstep) { setErr(''); setWstep(i) } }}
                        className="flex items-center gap-2"
                        style={{
                          paddingBottom: 6,
                          borderBottom: i === wstep
                            ? '2px solid var(--color-accent)'
                            : '2px solid transparent',
                          cursor: i < wstep ? 'pointer' : 'default',
                        }}>
                  <span className="tabular flex items-center justify-center"
                        style={{
                          width: 24, height: 24, borderRadius: 999,
                          fontSize: 13, fontWeight: 700,
                          background: i === wstep
                            ? 'var(--color-accent)'
                            : 'var(--web-border-dash, var(--color-border))',
                          color: i === wstep
                            ? 'var(--color-accent-text)'
                            : 'var(--web-muted-soft, var(--color-muted))',
                        }}>
                    {i + 1}
                  </span>
                  <span style={{
                    fontSize: 14, fontWeight: 650,
                    color: i === wstep
                      ? 'var(--color-text)'
                      : 'var(--web-muted-soft, var(--color-muted))',
                  }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 lg:hidden">
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

          <div className={`grid gap-3 sm:grid-cols-2 ${wstep === 0 ? '' : 'lg:hidden'}`}>
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

          <div className={`flex flex-col gap-3 ${wstep === 1 ? '' : 'lg:hidden'}`}>
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

          {/* ── CRESKO Web §7, шаг «Перевірка» (только lg) ──────────
              То, что уйдёт в базу, глазами: название, услуга и шаги
              читаются, а не редактируются. Пустые шаги (без назви дії)
              при сохранении отбрасываются — здесь они не показываются
              по той же причине. */}
          <div className={wstep === 2 ? 'hidden flex-col gap-3 lg:flex' : 'hidden'}>
            <h3 className="webh2">{t('techcards.wizard.review.title')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="field-label">{t('techcards.field.title.label')}</span>
                {/* Назва і послуга — данные заклада. */}
                <p style={{ fontWeight: 650 }}>{draft.title}</p>
              </div>
              <div>
                <span className="field-label">{t('techcards.field.service.label')}</span>
                <p style={{ fontWeight: 650 }}>
                  {services.find((s) => s.id === draft.offeringId)?.title
                    ?? t('techcards.field.service.general')}
                </p>
              </div>
            </div>
            <ol className="flex flex-col">
              {draft.steps.filter((s) => s.step.trim()).map((s, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5"
                    style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                  <span className="tabular flex shrink-0 items-center justify-center"
                        style={{
                          width: 22, height: 22, borderRadius: 999, fontSize: 12,
                          fontWeight: 700, background: 'var(--color-accent-soft)',
                          color: 'var(--color-accent-ink)',
                        }}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block" style={{ fontWeight: 650 }}>{s.step}</span>
                    {(s.solution || s.proportion || s.note) && (
                      <span className="block" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                        {[
                          s.solution,
                          s.proportion && t('techcards.step.proportionShort', { value: s.proportion }),
                          s.note,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {s.minutes && (
                    <span className="tabular shrink-0" style={{ fontSize: 13, fontWeight: 650 }}>
                      {t('techcards.step.minutesShort', { n: s.minutes })}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap gap-2 lg:hidden">
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

      {/* ── CRESKO Web §6: картка техкарти (только lg) ─────────────
          Пока открыт визард выпуска версии, карточка спрятана: после
          затвердження `router.refresh()` привозит свежие версии, и она
          возвращается уже с новой чинною — ключом служит название.

          Из макета НЕ рисуются, потому что этих данных не существует:
          фото (у регламента его нет), «Опис» и «Примітки» (карта хранит
          только шаги), «Матеріали та продукти» (`variant_materials` —
          расход рецептуры каталога, к техкарте базой не привязан; то же
          решение, что у карточки засоба в М43), «Файли та вкладення»
          и «Зняти з публікації» (статуса публикации нет: карта чинна,
          пока не выпущена следующая). Вместо «Редагувати» — «Створити
          нову версію»: затверджена версія незмінна (0014), и кнопка
          правки обещала бы то, что база уронит. */}
      {webGroup && !draft && (
        <section className="hidden flex-col gap-4 lg:flex">
          <button type="button" className="btn-ghost self-start !px-0"
                  onClick={() => setWebCard(null)}>
            <IconBack size={18} />
            {t('techcards.webitem.back')}
          </button>

          <div className="webcard">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                {/* Плашка на месте фото 110×78: у регламента нет
                    картинки, серый прямоугольник читался бы как
                    несостоявшаяся загрузка. */}
                <span aria-hidden className="flex shrink-0 items-center justify-center"
                      style={{
                        width: 110, height: 78, borderRadius: 12,
                        background: 'var(--color-accent-soft)',
                        color: 'var(--color-accent-ink)',
                      }}>
                  <IconClipboard size={30} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Назва техкарти — данные заклада. 26px — из §6 README. */}
                    <h1 className="webh1" style={{ fontSize: 26 }}>{webGroup.title}</h1>
                    <span className={webGroup.currentId ? 'badge-success' : 'badge'}>
                      {webGroup.currentId
                        ? t('techcards.version.current')
                        : t('techcards.version.archived')}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"
                       style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden style={{ color: 'var(--color-accent-ink)' }}>
                        <IconScissors size={15} />
                      </span>
                      {webGroup.latest.offeringTitle
                        ?? (webGroup.latest.offeringId
                          ? t('techcards.card.linked')
                          : t('techcards.field.service.general'))}
                    </span>
                    <span className="tabular flex items-center gap-1.5">
                      <span aria-hidden style={{ color: 'var(--color-accent-ink)' }}>
                        <IconLayers size={15} />
                      </span>
                      {t('techcards.webitem.meta.version', { n: t.number(webVersion?.version ?? 0) })}
                    </span>
                    <span className="tabular flex items-center gap-1.5">
                      <span aria-hidden style={{ color: 'var(--color-accent-ink)' }}>
                        <IconCalendar size={15} />
                      </span>
                      {t('techcards.webitem.meta.approved', {
                        date: t.date(webVersion?.createdAt ?? webGroup.latest.createdAt, DAY),
                      })}
                    </span>
                  </div>
                </div>
              </div>
              {canWrite && (
                <button type="button" className="btn-secondary shrink-0"
                        onClick={() => startNextVersion(webGroup)}>
                  {t('techcards.card.newVersion')}
                </button>
              )}
            </div>
          </div>

          {/* Табы §6: из пяти данными существуют два. Опис и Примітки
              карта не хранит, Матеріали — чужая модель (см. выше). */}
          <div className="wtabs">
            {([
              ['steps', t('techcards.webitem.tab.steps')],
              ['history', t('techcards.webitem.tab.history')],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" className="wtab"
                      data-active={cardTab === key}
                      onClick={() => setCardTab(key)}>
                {label}
              </button>
            ))}
          </div>

          <div className="grid items-start gap-5"
               style={{ gridTemplateColumns: 'minmax(0, 1fr) 330px' }}>
            <div className="flex flex-col gap-4">
              {cardTab === 'steps' ? (
                <div className="webcard">
                  <h2 className="webh2">{t('techcards.webitem.steps.title')}</h2>
                  {webSteps.length === 0 ? (
                    <p className="prose-muted mt-3">{t('techcards.steps.empty')}</p>
                  ) : (
                    <ol className="mt-2 flex flex-col">
                      {/* Текст шага, раствор, пропорция и примечание —
                          регламент заклада, то есть данные: они не
                          переводятся. Переводится только обвязка. */}
                      {webSteps.map((s, i) => (
                        <li key={i} className="flex items-start gap-3 py-2.5"
                            style={{
                              borderBottom: i === webSteps.length - 1
                                ? 'none'
                                : '1px dashed var(--web-border-dash, var(--color-border))',
                            }}>
                          <span className="tabular flex shrink-0 items-center justify-center"
                                style={{
                                  width: 22, height: 22, borderRadius: 999, fontSize: 12,
                                  fontWeight: 700, background: 'var(--color-accent-soft)',
                                  color: 'var(--color-accent-ink)',
                                }}>
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block" style={{ fontWeight: 650 }}>{s.step}</span>
                            {(s.solution || s.proportion || s.note) && (
                              <span className="block"
                                    style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                                {[
                                  s.solution,
                                  s.proportion
                                    && t('techcards.step.proportionShort', { value: s.proportion }),
                                  s.note,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </span>
                          {s.minutes && (
                            <span className="tabular shrink-0"
                                  style={{ fontSize: 13, fontWeight: 650 }}>
                              {t('techcards.step.minutesShort', { n: s.minutes })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : (
                <div className="webcard">
                  <h2 className="webh2">{t('techcards.webitem.tab.history')}</h2>
                  <div className="mt-2">
                    <VersionList t={t} group={webGroup}
                                 openVersion={openVersion} setOpenVersion={setOpenVersion} />
                  </div>
                </div>
              )}
            </div>

            {/* Права колонка 330px из §6: «Інформація» и блок статуса.
                Всё в ней — настоящие величины карты. */}
            <div className="flex flex-col gap-4">
              <div className="webcard">
                <h2 className="webh2">{t('techcards.webitem.info.title')}</h2>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
                  {([
                    [t('techcards.webitem.info.service'),
                      webGroup.latest.offeringTitle
                        ?? (webGroup.latest.offeringId
                          ? t('techcards.card.linked')
                          : t('techcards.field.service.general'))],
                    [t('techcards.webitem.info.status'),
                      webGroup.currentId
                        ? t('techcards.version.current')
                        : t('techcards.version.archived')],
                    [t('techcards.webitem.info.version'),
                      t('techcards.webitem.meta.version', { n: t.number(webVersion?.version ?? 0) })],
                    [t('techcards.webitem.info.versions'), t.number(webGroup.versions.length)],
                    [t('techcards.webitem.info.steps'), t.number(webSteps.length)],
                    [t('techcards.webitem.info.approved'),
                      t.date(webVersion?.createdAt ?? webGroup.latest.createdAt, DAY)],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <span className="block" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                        {label}
                      </span>
                      <span className="tabular block truncate"
                            style={{ fontSize: 13, fontWeight: 650 }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Аналог блока «Публікація»: у карты нет статуса
                  публикации, зато есть главное правило её жизни —
                  и оно уже записано словарём (`techcards.footer`). */}
              <div className="webcard">
                <h2 className="webh2">{t('techcards.webitem.publish.title')}</h2>
                <p className="mt-2" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                  {t('techcards.footer')}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>{t('techcards.empty.title')}</p>
            <p className="prose-muted">{t('techcards.empty.desc')}</p>
          </div>
        </div>
      ) : (
        <>
        {!draft && !webGroup && (
        <>
        {/* ── CRESKO Web: вкладки чертой (только lg) ─────────────
            Делят карты по единственному признаку, который у них есть
            данными: привязана к услуге или общая для салона. */}
        <div className="wtabs hidden lg:flex">
          {tabItems.map(([key, label, n]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
                    className="wtab" data-active={tab === key}
                    style={{ minHeight: 'var(--tap-min)' }}>
              {label}{n > 0 ? ` · ${t.number(n)}` : ''}
            </button>
          ))}
        </div>

        {/* ── CRESKO Web: техкарты таблицей (только lg) ──────────
            Строка — КАРТА (стопка версий), а не версия: карта и есть
            то, чем оперирует салон, а версии — её история. Нажатие
            на название открывает картку (§6) на месте списка: README
            называет вход в `techItem` именно строкой таблицы, а
            отдельного адреса `/app/techcards/<id>` в продукте нет —
            заводить его ради веб-раскладки значит менять навигацию.

            Строка целиком кнопкой быть не может: справа живёт кнопка
            выпуска версии, а кнопка внутри кнопки недопустима. Нажимается
            ячейка названия — тем же действием, что и на телефоне. */}
        <section className="hidden lg:block">
          <div className="wtable">
            <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
              <span>{t('techcards.web.table.card')}</span>
              <span>{t('techcards.web.table.service')}</span>
              <span>{t('techcards.web.table.versions')}</span>
              <span>{t('techcards.web.table.updated')}</span>
              <span>{t('techcards.web.table.status')}</span>
              <span aria-hidden />
            </div>

            {shownGroups.length === 0 ? (
              <div className="empty">{t('techcards.web.empty.filter')}</div>
            ) : shownGroups.map((g) => (
                <div key={g.title} className="wtable-row"
                     style={{ gridTemplateColumns: WGRID }}>
                  <button type="button"
                          onClick={() => { setWebCard(g.title); setCardTab('steps') }}
                          className="flex min-w-0 items-center gap-3 text-left"
                          style={{ minHeight: 'var(--tap-min)' }}>
                    {/* Плашка 42px вместо миниатюры: у регламента нет
                        ни фото, ни чего-либо, что можно показать
                        картинкой. Значок, а не глиф — «▤» на части
                        прошивок приезжает квадратом (М31). */}
                    <span aria-hidden
                          className="flex shrink-0 items-center justify-center"
                          style={{
                            width: 42, height: 42, borderRadius: 12,
                            background: 'var(--color-accent-soft)',
                            color: 'var(--color-accent-ink)',
                          }}>
                      <IconClipboard size={20} />
                    </span>
                    <span className="min-w-0">
                      {/* Назва техкарти — данные заклада. */}
                      <span className="block truncate font-semibold"
                            style={{ color: 'var(--color-text)' }}>{g.title}</span>
                      <span className="block truncate"
                            style={{ color: 'var(--color-faint)' }}>
                        {t('techcards.web.row.open')}
                      </span>
                    </span>
                  </button>
                  <span className="min-w-0 truncate">
                    {/* Та же развилка, что и на телефоне: подписать
                        привязанную карту «загальною» значит соврать
                        про регламент. */}
                    {g.latest.offeringTitle
                      ?? (g.latest.offeringId
                        ? t('techcards.card.linked')
                        : t('techcards.field.service.general'))}
                  </span>
                  <span className="tabular">{t.number(g.versions.length)}</span>
                  <span className="tabular">{t.date(g.latest.createdAt, DAY)}</span>
                  <span>
                    <span className={g.currentId ? 'badge-success' : 'badge'}>
                      {g.currentId
                        ? t('techcards.version.current')
                        : t('techcards.version.archived')}
                    </span>
                  </span>
                  <span className="text-right">
                    {canWrite && (
                      // Подпись для скринридера: «+» он не прочтёт.
                      <button type="button" className="btn-icon"
                              aria-label={t('techcards.card.newVersion')}
                              title={t('techcards.card.newVersion')}
                              onClick={() => startNextVersion(g)}>
                        <IconPlus size={18} />
                      </button>
                    )}
                  </span>
                </div>
            ))}

            {shownGroups.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('techcards.web.table.total', { n: t.number(shownGroups.length) })}
                </span>
              </div>
            )}
          </div>
        </section>
        </>
        )}

        <div className="flex flex-col gap-4 lg:hidden">
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

              <VersionList t={t} group={g}
                           openVersion={openVersion} setOpenVersion={setOpenVersion} />
            </section>
          ))}
        </div>
        </>
      )}

      <p className="field-hint rise-3">{t('techcards.footer')}</p>
    </div>
  )
}
