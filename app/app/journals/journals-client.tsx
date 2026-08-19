'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import {
  IconBack, IconBeaker, IconCheck, IconChevronRight, IconClipboard, IconDoc, IconPlus,
  IconScissors,
} from '@/components/icons'

// Дата и время записи журнала — «16 серп., 14:05». Это НАБОР ОПЦИЙ,
// а не своя `fmt`: форматирует по-прежнему `t.dateTime`, то есть язык
// и порядок частей выбирает локаль, а не мы (lib/i18n/format.ts).
const AT: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}

// `performer` — имя исполнителя или null. Null значит «имя не достаётся»
// (человека вывели из состава команды, оговорка 0083), а НЕ «исполнителя
// нет»: сами колонки `prepared_by` / `performed_by` объявлены `not null`.
// Разница видна на экране: см. `Performer` ниже.
type Solution = {
  id: string; agent_name: string; concentration: string
  volume: number; unit: string; prepared_at: string; expires_at: string
  performer: string | null
}
type Task = {
  id: string; name: string; schedule: string | null; doneToday: boolean
  donePerformer: string | null; doneAt: string | null
}
/** Строка истории отметок по пункту чек-листа. */
type HistoryRow = { id: string; at: string; performer: string | null }

type Cycle = {
  id: string; device: string; temperature_c: number
  duration_minutes: number; indicator_ok: boolean; performed_at: string
  performer: string | null
}
type AuditRow = {
  id: number; action: string; entity: string
  label: string | null; actor_email: string | null; at: string
}
// `compliance_batch_history` (0043) — та же запись аудита, но без
// коммерческих полей: `entity` в ней не хранится, он всегда
// `material_batches`, а `label` называется `batch_number`.
type BatchHistoryRow = {
  id: number; action: string; batch_number: string | null
  actor_email: string | null; at: string
}

// Исполнитель записи журнала. Обязательный реквизит: отчёт для проверки
// печатает эту же колонку и утверждает в подвале, что «у кожного запису
// зафіксовано час та виконавця». Пока экрана с исполнителем не было,
// проверить это утверждение было негде — а имя не показывалось никому,
// включая владельца (вложенная связь к `profiles` отдаёт null, 0083).
function Performer({ name }: { name: string | null }) {
  const t = useT()
  // Само имя — данные арендатора, оно не переводится никогда. Переводится
  // только объяснение, почему имени нет.
  return name
    ? <>{name}</>
    : <span title={t('journals.performer.gone.title')}>
        {t('journals.performer.gone')}
      </span>
}

// Три журнала одним экраном. Каждая запись — одно касание или одна
// короткая форма: заполнять их будут между клиентами, стоя.
export function JournalsClient({
  tenantId, userId, canWrite, canManage, solutions, tasks, cycles,
  totals, cleaningLastAt,
}: {
  tenantId: string; userId: string
  /**
   * Можно ли делать записи в журналы: `compliance.journal.write`
   * (мастер, 0039) или `compliance.write`. Без права формы не рисуются
   * вовсе — иначе инспектор жмёт «Виконано» и получает отказ RLS
   * вместо честного «вам сюда только смотреть».
   */
  canWrite: boolean
  /**
   * Можно ли менять САМ чек-лист. Политика `cleaning_tasks_insert`
   * требует `compliance.write` и НЕ принимает `compliance.journal.write`:
   * мастер отмечает уборку, но состав чек-листа задаёт заведение.
   */
  canManage: boolean
  solutions: Solution[]; tasks: Task[]; cycles: Cycle[]
  /**
   * Сколько записей в каждом журнале ВСЕГО. Считает база (`count: 'exact'`),
   * потому что сами списки обрезаны тридцатью строками: карточка журнала
   * на десктопе называет число, и оно обязано быть настоящим.
   */
  totals: { cleaning: number; solutions: number; cycles: number }
  /** Последняя отметка прибирання за всё время — `entries` даёт только сегодня. */
  cleaningLastAt: string | null
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  // Активная вкладка живёт в адресе (?tab=), а не в состоянии.
  // Причины две: нижние табы приложения — это ссылки, и ссылку
  // «покажи журнал стерилизации» можно отправить мастеру в чат.
  const search = useSearchParams()
  const raw = search.get('tab')
  // ⚠️ ДВЕ РАЗНЫЕ ВЕЛИЧИНЫ, и различие несёт всю мобильную раскладку.
  //
  //   `chosen` — журнал, который человек ВЫБРАЛ. `null` значит «ещё
  //     не выбрал», и на телефоне это отдельный экран: список журналов
  //     (хендофф CRESKO, раздел F — `journals` → `journalDay`).
  //   `tab` — какой журнал ПОКАЗЫВАТЬ. На широком экране список и
  //     содержимое стоят рядом, поэтому пустого состояния там нет:
  //     без выбора показывается первый журнал, как и раньше.
  //
  // Пока величина была одна, телефон открывал сразу чек-лист прибирання,
  // а остальные три журнала жили за лентой чипов — то есть экран начинался
  // с органа управления, которого в макете нет вовсе.
  const chosen: 'cleaning' | 'solutions' | 'sterilization' | 'actions' | null =
    raw === 'solutions' || raw === 'sterilization' || raw === 'actions' || raw === 'cleaning'
      ? raw : null
  const tab = chosen ?? 'cleaning'
  // Параметр назван `next`, а не `t`: `t` — переводчик.
  const setTab = (next: NonNullable<typeof chosen>) =>
    router.replace(next === 'cleaning' ? '/app/journals' : `/app/journals?tab=${next}`)
  // Форма записи в журнал — шторкой, а не блоком поверх списка. Причина
  // та же, по которой так сделана загрузка документа: четыре поля
  // занимали первый экран телефона, и записи журнала, ради которых сюда
  // заходят, начинались за сгибом. Записывают раз в смену, смотрят —
  // на каждой проверке. На широком экране форма остаётся на месте:
  // там она ничего не вытесняет (см. `solutionForm` ниже).
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // Отметки, сделанные без сети: показываем «сьогодні ✓» сразу,
  // не дожидаясь досылки, — иначе мастер жмёт кнопку второй раз.
  const [offDone, setOffDone] = useState<Set<string>>(new Set())

  // Журнал действий (Audit Trail из ТЗ): грузится при первом открытии
  // вкладки, а не с экраном, — обычно он нужен раз в месяц, при проверке.
  //
  // Читается ИЗ ДВУХ мест, и это не дублирование:
  //
  //   `audit_log` — общая лента. Её политика (0043) отдаёт инспектору
  //     только компланс-сущности и намеренно ВЫРЕЗАЕТ `material_batches`:
  //     в записи о приёмке партии лежат поставщик и заметка, то есть
  //     коммерция.
  //   `compliance_batch_history` — та же лента по партиям, но с уже
  //     вычищенными `supplier_id` и `note` (0043). Ради этого
  //     представление и заведено; до сих пор его не читал никто, и
  //     история партий у инспектора просто отсутствовала.
  //
  // Ветвления по роли снова нет: оба запроса уходят всегда, каждый
  // отдаёт ровно то, на что есть право, а склейка идёт по `id` записи
  // аудита — он общий, поэтому у владельца, который видит партии
  // в обеих лентах, строка не задвоится.
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  useEffect(() => {
    if (tab !== 'actions' || audit !== null) return
    void Promise.all([
      // Фильтр по арендатору стоит ЯВНО, хотя изоляцию держит RLS.
      // Причина не в безопасности, а в `limit(200)`: у того, кто состоит
      // в двух заведениях, лента чужого заклада вытесняла бы записи
      // этого — экран показывал бы «здесь ничего не менялось» там, где
      // менялось. Правило 1 читается и так: у каждой строки есть
      // `tenant_id`, значит запрос обязан его называть.
      supabase.from('audit_log')
        .select('id, action, entity, label, actor_email, at')
        .eq('tenant_id', tenantId)
        .order('at', { ascending: false })
        .limit(200),
      supabase.from('compliance_batch_history')
        .select('id, action, batch_number, actor_email, at')
        .eq('tenant_id', tenantId)
        .order('at', { ascending: false })
        .limit(200),
    ]).then(([general, batches]) => {
      const rows = new Map<number, AuditRow>()
      for (const r of (general.data as AuditRow[] | null) ?? []) rows.set(r.id, r)
      for (const r of (batches.data as BatchHistoryRow[] | null) ?? []) {
        if (rows.has(r.id)) continue
        rows.set(r.id, {
          id: r.id, action: r.action, entity: 'material_batches',
          label: r.batch_number, actor_email: r.actor_email, at: r.at,
        })
      }
      setAudit(Array.from(rows.values())
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, 200))
    })
  }, [tab, audit, supabase, tenantId])

  // формы
  const [agent, setAgent] = useState(''); const [conc, setConc] = useState('')
  const [vol, setVol] = useState(''); const [hours, setHours] = useState('24')
  // Назва пристрою — ЗНАЧЕНИЕ, которое уедет в журнал стерилизации и оттуда
  // в отчёт для проверяющего, а не подпись на экране. Поэтому оно не в
  // словаре и остаётся украинским при любом языке интерфейса: перевод
  // умолчания означал бы русскую запись в документе для Держпродспоживслужби
  // (CLAUDE.md → «Локализация»: данные арендатора не переводятся).
  const [device, setDevice] = useState('сухожарова шафа')
  const [temp, setTemp] = useState('180'); const [mins, setMins] = useState('60')
  const [indicator, setIndicator] = useState(true)
  const [newTask, setNewTask] = useState('')

  // ── История отметок по пункту чек-листа ──────────────────────────────────
  //
  // ТЗ 3.3 называет это ЖУРНАЛОМ прибирання, а экран до 19.08.2026 показывал
  // только сегодняшнее состояние: «відмічено о 9:20, Оксана» либо «не
  // відмічено». Вчерашнего дня не видел никто — ни владелец, ни инспектор,
  // хотя записи лежат в `cleaning_entries` и печатаются в отчёте для
  // проверки. То есть данные были, а показать их в приложении было негде:
  // на вопрос «а позавчера прибирали?» ответом был PDF.
  //
  // Грузится ПО НАЖАТИЮ, а не вместе с экраном: у салона это тридцать
  // записей на пункт в месяц, и тянуть их для всех пунктов сразу — платить
  // за то, что смотрят изредка. Тот же приём, что у колокола и поиска.
  const [history, setHistory] = useState<{ task: Task; rows: HistoryRow[] | null } | null>(null)

  async function openHistory(task: Task) {
    setHistory({ task, rows: null })
    // Имена исполнителей — отдельным запросом к `compliance_actors`,
    // а не вложенной связью к `profiles`: та отдаёт профиль ТОЛЬКО про
    // себя, и связь вернула бы null всем, включая владельца (0083).
    const [{ data: rows }, { data: actors }] = await Promise.all([
      supabase.from('cleaning_entries')
        .select('id, performed_at, performed_by')
        .eq('task_id', task.id)
        .order('performed_at', { ascending: false })
        .limit(60),
      supabase.from('compliance_actors').select('user_id, full_name'),
    ])
    const nameOf = new Map((actors ?? []).map((a) => [a.user_id as string, a.full_name as string | null]))
    setHistory({
      task,
      rows: (rows ?? []).map((r) => ({
        id: r.id as string,
        at: r.performed_at as string,
        performer: nameOf.get(r.performed_by as string) ?? null,
      })),
    })
  }

  async function markTask(taskId: string) {
    setBusy(taskId); setErr('')
    try {
      const { error } = await supabase.from('cleaning_entries').insert({
        tenant_id: tenantId, task_id: taskId, performed_by: userId,
      })
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      // Мастер в подвале без сети — ровно тот случай, ради которого
      // ТЗ требует офлайн. Отметка ложится в очередь со временем
      // нажатия и уходит сама; галочка загорается сразу.
      if (isNetworkError(e)) {
        // Подпись очереди берётся на языке, на котором мастер нажал кнопку,
        // и дальше живёт в IndexedDB как есть: это снимок момента, а не
        // строка экрана. Переводить её при досылке было бы нечем — в очереди
        // лежит текст, а не ключ.
        await enqueue(t('journals.offline.cleaning.label'), {
          kind: 'journal.cleaning', tenantId, taskId, userId,
        })
        setOffDone((prev) => new Set(prev).add(taskId))
        toast.info(t('journals.offline.saved'), t('journals.offline.cleaning.desc'))
        return
      }
      setErr(dbErrorText(t, e))
      return
    }
    setBusy(null)
    router.refresh()
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    setBusy('newtask')
    const { error } = await supabase.from('cleaning_tasks').insert({
      tenant_id: tenantId, name: newTask,
    })
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    // Шторка закрывается сама: оставленная открытой поверх обновлённого
    // списка она читается как «не сохранилось».
    setAdding(false)
    setNewTask(''); router.refresh()
  }

  async function addSolution(e: React.FormEvent) {
    e.preventDefault()
    setBusy('solution'); setErr('')
    const expiresAt = new Date(Date.now() + Number(hours) * 36e5).toISOString()
    try {
      const { error } = await supabase.from('sanitation_solutions').insert({
        tenant_id: tenantId, agent_name: agent, concentration: conc,
        volume: Number(vol), prepared_by: userId, expires_at: expiresAt,
      })
      if (error) throw new Error(error.message)
    } catch (ex) {
      setBusy(null)
      if (isNetworkError(ex)) {
        // Назва засобу подставляется данными, поэтому строка с подстановкой,
        // а не склейка: порядок слов в других языках другой.
        await enqueue(t('journals.offline.solution.label', { agent }), {
          kind: 'journal.solution', tenantId, userId,
          agentName: agent, concentration: conc,
          volume: Number(vol) || null, expiresAt,
        })
        toast.info(t('journals.offline.saved'), t('journals.offline.solution.desc'))
        setAgent(''); setConc(''); setVol('')
        return
      }
      setErr(dbErrorText(t, ex))
      return
    }
    setBusy(null); setAdding(false)
    setAgent(''); setConc(''); setVol(''); router.refresh()
  }

  async function addCycle(e: React.FormEvent) {
    e.preventDefault()
    setBusy('cycle'); setErr('')
    try {
      const { error } = await supabase.from('sterilization_cycles').insert({
        tenant_id: tenantId, device, temperature_c: Number(temp),
        duration_minutes: Number(mins), indicator_ok: indicator, performed_by: userId,
      })
      if (error) throw new Error(error.message)
    } catch (ex) {
      setBusy(null)
      if (isNetworkError(ex)) {
        await enqueue(t('journals.offline.cycle.label', { device }), {
          kind: 'journal.sterilization', tenantId, userId, device,
          temperatureC: Number(temp), durationMinutes: Number(mins),
          indicatorOk: indicator,
        })
        toast.info(t('journals.offline.saved'), t('journals.offline.cycle.desc'))
        return
      }
      setErr(dbErrorText(t, ex))
      return
    }
    setBusy(null); setAdding(false)
    router.refresh()
  }

  // ── Вкладки — ОДИН список на обе раскладки ───────────────────────────────
  // На телефоне это чипы, на lg — `.wtab` с чертой. Имена и порядок живут
  // здесь один раз: два списка разъехались бы на первой новой вкладке.
  const tabItems = [
    ['cleaning', t('journals.tab.cleaning')],
    ['solutions', t('journals.tab.solutions')],
    ['sterilization', t('journals.tab.sterilization')],
    ['actions', t('journals.tab.actions')],
  ] as const

  // ── Реестр журналов: ОДИН список на обе раскладки ────────────────────────
  //
  // На телефоне это экран-оглавление (хендофф, раздел F: плашка, назва,
  // опис, «Останній запис», лічильник, chevron), на lg — три карточки над
  // вкладками. Два списка разъехались бы на первом же новом журнале.
  //
  // Три САНИТАРНЫХ журнала — ровно те, что требует Техрегламент №65.
  // Журнал ДІЙ сюда не входит: это аудит изменений данных, а не журнал
  // уборки, и число строк в нём ничего не говорит о готовности к проверке.
  // Поэтому на lg карточек по-прежнему три.
  //
  // Тон плашки — ОПОЗНАВАТЕЛЬНЫЙ знак журнала, а не состояние: четыре
  // одинаковых серых кружка читались бы как один пункт, разбитый переносом.
  // Состояние показывают бейджи в самих журналах.
  const sanitaryJournals = [
    {
      key: 'cleaning' as const, icon: IconClipboard, tone: 'blue' as const,
      title: t('journals.tab.cleaning'), desc: t('journals.card.cleaning.desc'),
      n: totals.cleaning as number | null, last: cleaningLastAt as string | null,
    },
    {
      key: 'solutions' as const, icon: IconBeaker, tone: 'violet' as const,
      title: t('journals.tab.solutions'), desc: t('journals.card.solutions.desc'),
      n: totals.solutions as number | null,
      // Список уже отсортирован базой по убыванию — первая строка и есть
      // последняя запись. Второй сортировки на клиенте быть не должно.
      last: (solutions[0]?.prepared_at ?? null) as string | null,
    },
    {
      key: 'sterilization' as const, icon: IconCheck, tone: 'emerald' as const,
      title: t('journals.tab.sterilization'), desc: t('journals.card.sterilization.desc'),
      n: totals.cycles as number | null,
      last: (cycles[0]?.performed_at ?? null) as string | null,
    },
  ]

  // Оглавление телефона — те же три плюс журнал действий. На телефоне
  // он обязан быть здесь: ленты чипов больше нет, и без строки в списке
  // «Дії» недостижимы вовсе.
  const journalCards = [
    ...sanitaryJournals,
    {
      // Число записей и дата последней у аудита НЕИЗВЕСТНЫ до открытия:
      // лента грузится по нажатию (двести последних строк), и считать их
      // вместе с экраном значило бы платить за то, что смотрят раз в месяц.
      // Поэтому у этой строки нет ни счётчика, ни даты — а не «0», которого
      // не бывает: в аудите есть запись о самом заведении.
      key: 'actions' as const, icon: IconDoc, tone: 'amber' as const,
      title: t('journals.tab.actions'), desc: t('journals.card.actions.desc'),
      n: null as number | null, last: null as string | null,
    },
  ]

  // ── Формы записи: ОДНО описание на обе раскладки ─────────────────────────
  //
  // На широком экране форма стоит над таблицей, на телефоне — в шторке
  // по кнопке «Додати запис». Это не две формы, а одно и то же дерево,
  // положенное в два места: значение и обработчик общие, и разъехаться
  // им негде. Вторая копия разметки на первой же правке показывала бы
  // на телефоне не то, что на вебе (урок М43).
  //
  // Компонентами это делать НЕЛЬЗЯ: функция, объявленная внутри рендера,
  // на каждом нажатии клавиши — новый тип элемента, React сносит поддерево,
  // и поле теряет фокус после первой буквы. Элемент JSX — просто данные,
  // и такой беды у него нет.
  const solutionForm = canWrite ? (
    <form onSubmit={addSolution} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="field-label">{t('journals.solution.agent.label')}</label>
        <input required className="input" placeholder={t('journals.solution.agent.placeholder')}
               value={agent} onChange={(e) => setAgent(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('journals.solution.conc.label')}</label>
        <input required className="input" placeholder={t('journals.solution.conc.placeholder')}
               value={conc} onChange={(e) => setConc(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('journals.solution.volume.label')}</label>
        <input required type="number" step="0.1" min="0.1" className="input"
               value={vol} onChange={(e) => setVol(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('journals.solution.hours.label')}</label>
        <input required type="number" min="1" className="input"
               value={hours} onChange={(e) => setHours(e.target.value)} />
      </div>
      <button className="btn-primary self-end sm:col-span-2 sm:justify-self-start"
              disabled={busy === 'solution'}>
        {t('journals.solution.submit')}
      </button>
    </form>
  ) : null

  const cycleForm = canWrite ? (
    <form onSubmit={addCycle} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="field-label">{t('journals.cycle.device.label')}</label>
        <input required className="input" value={device}
               onChange={(e) => setDevice(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('journals.cycle.temp.label')}</label>
        <input required type="number" min="1" className="input"
               value={temp} onChange={(e) => setTemp(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('journals.cycle.mins.label')}</label>
        <input required type="number" min="1" className="input"
               value={mins} onChange={(e) => setMins(e.target.value)} />
      </div>
      <label className="t-md flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={indicator}
               onChange={(e) => setIndicator(e.target.checked)} />
        {t('journals.cycle.indicator.label')}
      </label>
      <button className="btn-primary self-end sm:col-span-2 sm:justify-self-start"
              disabled={busy === 'cycle'}>
        {t('journals.cycle.submit')}
      </button>
    </form>
  ) : null

  // Пункт чек-листа заводит ЗАКЛАД, а не мастер: `cleaning_tasks_insert`
  // требует `compliance.write` и не принимает `compliance.journal.write`.
  const taskForm = canManage ? (
    <form onSubmit={addTask} className="flex gap-2">
      <input className="input" placeholder={t('journals.cleaning.newTask.placeholder')}
             value={newTask} onChange={(e) => setNewTask(e.target.value)} />
      <button className="btn-secondary shrink-0"
              disabled={!newTask.trim() || busy === 'newtask'}>
        {t('journals.cleaning.newTask.submit')}
      </button>
    </form>
  ) : null

  // Что открывает кнопка «Додати запис» этого журнала. У аудита такой
  // кнопки нет вовсе: его строки пишет триггер, руками туда не пишут.
  const addForm = tab === 'cleaning' ? taskForm
    : tab === 'solutions' ? solutionForm
      : tab === 'sterilization' ? cycleForm : null
  const addTitle = tab === 'cleaning'
    ? t('journals.cleaning.newTask.title')
    : t('journals.add')

  // Колонки таблиц CRESKO Web. Единственное место, где размер задаётся
  // строкой, — так велит `.wtable`: сетку задаёт экран, а не класс.
  const GRID_CLEANING = '2.2fr 1fr 1.2fr 1.1fr 150px'
  const GRID_SOLUTIONS = '1.9fr .8fr 1.2fr 1.1fr 1fr'
  const GRID_CYCLES = '1.7fr .9fr 1.2fr 1.1fr .8fr'
  const GRID_AUDIT = '1.5fr 1.4fr 1.4fr 1fr'

  return (
    <div className="flex flex-col gap-5">
      {/* ⚠️ ЖУРНАЛЫ ДОСТУПНЫ НА ОБЕИХ РАСКЛАДКАХ, и это условие сильнее вида.
          Когда-то на переключателе висело `hidden lg:inline-flex`
          с объяснением «на телефоне эти же вкладки живут в нижней панели
          приложения» — оно устарело 15.08.2026, когда панель перестала
          держать экраны раздела и стала держать сами разделы (CLAUDE.md →
          «Мобильная версия»), и с того дня с телефона нельзя было открыть
          ни «Розчини», ні «Стерилізацію», ні «Дії».

          Сейчас переключателя на телефоне нет ВООБЩЕ, и это не откат
          к тому же: журналы стали экраном-оглавлением (хендофф CRESKO,
          раздел F), то есть каждый журнал открывается ссылкой на самом
          экране, а не лентой чипов над содержимым. На lg остались
          карточки и `.wtab`: там список и содержимое стоят рядом.
          Оба входа строятся из одного `journalCards` — иначе новый
          журнал появился бы ровно в одной раскладке. */}
      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, которым его называет панель
          и вкладка браузера; справа — единственное действие уровня
          экрана, отчёт для проверки. Второй кнопки «Новий запис» здесь
          нет намеренно: запись в каждый журнал своя и делается формой
          внутри вкладки, а кнопка, ведущая «куда-то в журналы», была бы
          третьим входом в то же самое. */}
      <div className="hidden items-center justify-between lg:flex">
        <h1 className="webh1">{t('app.screen.journals.title')}</h1>
        <div className="flex items-center gap-2">
          {/* Техкарти — экран ТОГО ЖЕ модуля соответствия (одно право
              `compliance.read`, той же связки санитарного учёта), но
              своего пункта в навигации у него нет: реестр модулей ведёт
              на `/app/journals`, и без этой ссылки раздел недостижим
              вовсе (аудит 19.08.2026). Это ЕДИНСТВЕННЫЙ вход, а не
              второй — потому он здесь, а не «заодно». */}
          <Link href="/app/techcards" className="btn-secondary">
            {t('journals.links.techcards')}
          </Link>
          <a href="/app/journals/report" target="_blank" rel="noreferrer"
             className="btn-primary">
            {t('journals.report.open')}
          </a>
        </div>
      </div>

      {/* ── CRESKO Web: карточки трёх журналов (только lg) ────────
          Число записей и дата последней — то, ради чего на этот экран
          заходят перед проверкой: «чи ведеться журнал і коли востаннє».
          Нажатие переключает вкладку ниже, то есть карточки и вкладки —
          один орган управления, а не два входа в одно место: карточка
          несёт величины, которых у вкладки нет. */}
      <section className="rise hidden lg:grid lg:grid-cols-3" style={{ gap: 14 }}>
        {sanitaryJournals.map((c) => (
          <button key={c.key} type="button" aria-pressed={tab === c.key}
                  onClick={() => setTab(c.key)}
                  className="webcard text-left"
                  style={{
                    minHeight: 'var(--tap-min)',
                    borderColor: tab === c.key ? 'var(--color-accent)' : undefined,
                  }}>
            <span className="flex items-start justify-between gap-3">
              <span className="wmetric-icon" data-tone={c.tone}><c.icon size={19} /></span>
              {/* `aria-hidden` иконки ставит сам компонент — здесь только
                  цвет, иначе шеврон спорит по весу с числом. */}
              <span className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                <IconChevronRight size={18} />
              </span>
            </span>
            <span className="mt-3 block"
                  style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>
              {c.title}
            </span>
            <span className="tabular mt-1 flex items-baseline gap-1.5">
              <span style={{ fontSize: 21, fontWeight: 800, color: 'var(--color-text)' }}>
                {t.number(c.n ?? 0)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                {t('journals.web.card.records')}
              </span>
            </span>
            {/* Пунктирная черта и строка под ней — из README карточки.
                Пустой журнал говорит об этом словом, а не прочерком:
                «—» рядом с подписью «Останній» читается как сбой. */}
            <span className="mt-3.5 block pt-3"
                  style={{
                    borderTop: '1px dashed var(--web-border-dash, var(--color-border))',
                    fontSize: 12, color: 'var(--color-muted)',
                  }}>
              {c.last
                ? t('journals.web.card.last', { date: t.dateTime(c.last, AT) })
                : t('journals.web.card.never')}
            </span>
          </button>
        ))}
      </section>

      {/* ── CRESKO Web: вкладки чертой (только lg) ───────────────
          Тот же `tabItems` и тот же `setTab`, что и у карточек выше, —
          отличается только вид. */}
      <div className="wtabs hidden lg:flex">
        {tabItems.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
                  className="wtab" data-active={tab === key}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Оглавление журналов (телефон) ────────────────────────
          Хендофф, раздел F: плашка, назва, опис, «Останній запис»,
          лічильник, chevron. Ленты чипов над содержимым больше нет:
          она была ОРГАНОМ УПРАВЛЕНИЯ на первом экране — четыре
          пилюли, из которых три уезжали за край, — и человек видел
          первый журнал раньше, чем узнавал, что журналов четыре.

          Каждая строка — ссылка, а не кнопка состояния: адрес журнала
          отправляют мастеру в чат, и жест «назад» обязан возвращать
          в оглавление сам, без нашей помощи. */}
      {chosen === null && (
        <section className="rise flex flex-col gap-2 lg:hidden">
          {journalCards.map((c) => (
            <Link key={c.key} href={`/app/journals?tab=${c.key}`}
                  className="list-card !items-start">
              <span className="stat-tile-icon shrink-0" data-tone={c.tone}>
                <c.icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-md clamp-2 block">{c.title}</span>
                <span className="t-sm prose-muted mt-0.5 block">{c.desc}</span>
                {c.last && (
                  <span className="tabular t-xs mt-1 block"
                        style={{ color: 'var(--color-faint)' }}>
                    {t('journals.web.card.last', { date: t.dateTime(c.last, AT) })}
                  </span>
                )}
              </span>
              {c.n !== null && (
                <span className="badge tabular shrink-0">{t.number(c.n)}</span>
              )}
              <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                <IconChevronRight size={18} />
              </span>
            </Link>
          ))}

          {/* Техкарти — экран ТОГО ЖЕ модуля соответствия, но своего
              пункта в навигации у него нет: реестр модулей ведёт на
              `/app/journals`, и без этой строки раздел недостижим
              с телефона вовсе. Это ЕДИНСТВЕННЫЙ вход, а не второй —
              потому он и стоит в оглавлении, рядом с журналами,
              а не кнопкой над каждым из них, как было до 19.08.2026. */}
          <Link href="/app/techcards" className="list-card">
            {/* Значок НЕ повторяет чей-либо из журналов: плашка здесь —
                опознавательный знак строки, и второй планшет подряд
                читался бы как ещё один журнал прибирання. */}
            <span className="stat-tile-icon shrink-0" data-tone="rose">
              <IconScissors size={18} />
            </span>
            <span className="t-md min-w-0 flex-1">{t('journals.links.techcards')}</span>
            <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
              <IconChevronRight size={18} />
            </span>
          </Link>

          {/* Подпись кнопки — интерфейс и переводится. САМ отчёт по этой
              ссылке собирается всегда по-украински и от языка кабинета
              не зависит: это документ для Держпродспоживслужби
              (lib/report/sanitation-report.ts). На lg та же ссылка стоит
              в хедере экрана, поэтому второй раз здесь её нет. */}
          <a href="/app/journals/report" target="_blank" rel="noreferrer"
             className="btn-secondary mt-2">
            {t('journals.report.open')}
          </a>

          {/* Раздел F требует примечание про Audit Log именно здесь,
              на оглавлении: оно отвечает на вопрос «а можно ли это
              подделать» раньше, чем человек откроет первый журнал.

              Строка СВОЯ, а не `journals.audit.hint`: та говорит про
              журнал ДІЙ («сюди потрапляє кожна зміна карток і партій»)
              и стоит внутри него. Поставить её и здесь значило бы
              обещать на оглавлении не то, что под ним лежит. */}
          <p className="field-hint">{t('journals.list.hint')}</p>
        </section>
      )}

      {/* Возврат в оглавление. Стрелка шапки сюда не годится: она
          считается из АДРЕСА (`backOf` в app-shell), а журнал живёт
          в параметре того же адреса — для оболочки это тот же экран. */}
      {chosen !== null && (
        <Link href="/app/journals" className="btn-ghost rise self-start !px-0 lg:hidden">
          <IconBack size={18} />
          {t('journals.back')}
        </Link>
      )}

      {/* Какой журнал открыт. Шапка кабинета называет РАЗДЕЛ («Журнали»),
          а не журнал: она собирается из адреса, а журнал живёт в его
          параметре. Без этой строки человек, пришедший по ссылке из чата,
          видит записи и не знает, чьи они. */}
      {chosen !== null && (
        <p className="eyebrow lg:hidden">
          {journalCards.find((c) => c.key === tab)?.title}
        </p>
      )}

      {/* Единственное действие журнала — «Додати запис» (хендофф, раздел F:
          `journalDay` → `journalAdd`). Форм на самом экране больше нет:
          отчёт и техкарты ушли в оглавление, а поля — в шторку.

          Заливкой акцента набрано только то, что ПИШЕТ В ЖУРНАЛ. Состав
          чек-листа — настройка заклада, её трогают раз в жизни, и кричать
          громче отметки «Виконано» она не имеет права (CLAUDE.md: акцент —
          дефицитный ресурс). */}
      {chosen !== null && addForm !== null && (
        <button type="button"
                className={`${tab === 'cleaning' ? 'btn-secondary' : 'btn-primary'} rise-1 lg:hidden`}
                onClick={() => { setErr(''); setAdding(true) }}>
          <IconPlus size={18} />
          {addTitle}
        </button>
      )}

      {err && <p className="field-error rise">{err}</p>}

      {tab === 'cleaning' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          <div className="card rise-1 !p-0 lg:hidden">
            {tasks.length === 0 ? (
              <div className="empty">
                {canManage
                  ? t('journals.cleaning.empty.manage')
                  : t('journals.cleaning.empty.read')}
              </div>
            ) : tasks.map((task) => (
              // Параметр назван `task`, а не `t`: `t` — переводчик.
              // Название пункта чек-листа и его расписание — данные заклада,
              // они не переводятся.
              <div key={task.id} className="row px-5">
                {/* Пункт чек-листа ОТКРЫВАЕТСЯ — это журнал, а не список
                    состояний на сегодня. Кнопкой, а не ссылкой: история
                    приезжает шторкой и своего адреса не имеет. */}
                <button type="button" className="min-w-0 flex-1 text-left"
                        onClick={() => void openHistory(task)}>
                  <p className="t-md">{task.name}</p>
                  {task.doneToday && task.doneAt ? (
                    <p className="t-xs prose-muted">
                      {t.dateTime(task.doneAt, AT)} · <Performer name={task.donePerformer} />
                    </p>
                  ) : task.schedule ? (
                    <p className="t-xs prose-muted">{task.schedule}</p>
                  ) : null}
                </button>
                {task.doneToday || offDone.has(task.id) ? (
                  <span className="badge-success">{t('journals.cleaning.doneToday')}</span>
                ) : canWrite ? (
                  <button className="btn-secondary t-sm" disabled={busy === task.id}
                          onClick={() => void markTask(task.id)}>
                    {t('journals.cleaning.mark')}
                  </button>
                ) : (
                  <span className="badge">{t('journals.cleaning.notMarked')}</span>
                )}
              </div>
            ))}
          </div>

          {/* ── CRESKO Web: чек-лист таблицей (только lg) ──────────
              Те же самые `tasks` и те же два действия, что у карточек
              выше: открыть историю отметок и отметить выполнение.
              Второй логики здесь нет — иначе на широком экране
              показывалось бы не то же самое, что на узком.

              Строка — НЕ одна большая ссылка: внутри неё живёт кнопка
              «Виконано», а вложенная кнопка внутри кнопки недопустима.
              Поэтому целью нажатия остаётся первая ячейка — ровно как
              на телефоне, где нажимается название пункта. Ей задан
              `--tap-min`: 44px по HIG держатся и на десктопе, потому
              что тем же экраном пользуются с планшета. */}
          <div className="wtable hidden lg:block">
            <div className="wtable-head" style={{ gridTemplateColumns: GRID_CLEANING }}>
              <span>{t('journals.web.table.task')}</span>
              <span>{t('journals.web.table.schedule')}</span>
              <span>{t('journals.web.table.today')}</span>
              <span>{t('journals.web.table.performer')}</span>
              <span>{t('journals.web.table.status')}</span>
            </div>
            {tasks.length === 0 ? (
              <div className="empty">
                {canManage
                  ? t('journals.cleaning.empty.manage')
                  : t('journals.cleaning.empty.read')}
              </div>
            ) : tasks.map((task) => (
              <div key={task.id} className="wtable-row"
                   style={{ gridTemplateColumns: GRID_CLEANING }}>
                <button type="button"
                        className="flex min-w-0 items-center text-left"
                        style={{ minHeight: 'var(--tap-min)' }}
                        onClick={() => void openHistory(task)}>
                  {/* Название пункта — данные заклада, не переводится. */}
                  <span className="truncate font-semibold"
                        style={{ color: 'var(--color-text)' }}>{task.name}</span>
                </button>
                {/* Периодичность — тоже данные заклада. */}
                <span className="truncate">{task.schedule || t('common.noValue')}</span>
                <span className="tabular">
                  {task.doneToday && task.doneAt
                    ? t.dateTime(task.doneAt, AT)
                    : t('common.noValue')}
                </span>
                <span className="truncate">
                  {task.doneToday
                    ? <Performer name={task.donePerformer} />
                    : t('common.noValue')}
                </span>
                <span>
                  {task.doneToday || offDone.has(task.id) ? (
                    <span className="badge-success">{t('journals.cleaning.doneToday')}</span>
                  ) : canWrite ? (
                    <button className="btn-secondary t-sm" disabled={busy === task.id}
                            onClick={() => void markTask(task.id)}>
                      {t('journals.cleaning.mark')}
                    </button>
                  ) : (
                    <span className="badge">{t('journals.cleaning.notMarked')}</span>
                  )}
                </span>
              </div>
            ))}
            {tasks.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('journals.web.table.total', { n: t.number(tasks.length) })}
                </span>
              </div>
            )}
          </div>

          {/* На телефоне эта же форма приезжает шторкой по кнопке
              «Новий пункт чек-листа» — см. `addForm` ниже. */}
          {taskForm && <div className="rise-2 hidden lg:block">{taskForm}</div>}
          <p className="field-hint">{t('journals.cleaning.hint')}</p>
        </section>
      )}

      {tab === 'solutions' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          {/* На телефоне та же форма приезжает шторкой по кнопке
              «Додати запис»: четыре поля занимали первый экран, и записи
              журнала начинались за сгибом. */}
          {solutionForm && <div className="card rise-1 hidden lg:block">{solutionForm}</div>}

          {/* ── CRESKO Web: журнал розчинів таблицей (только lg) ────
              Ни одного действия у строки нет и на телефоне — розчин
              записывают формой выше, а запись журнала неизменяема.
              Поэтому строки здесь не нажимаются: нажатие, которое
              ничего не открывает, читается как поломка. */}
          <div className="wtable hidden lg:block">
            <div className="wtable-head" style={{ gridTemplateColumns: GRID_SOLUTIONS }}>
              <span>{t('journals.web.table.agent')}</span>
              <span>{t('journals.web.table.volume')}</span>
              <span>{t('journals.web.table.prepared')}</span>
              <span>{t('journals.web.table.performer')}</span>
              <span>{t('journals.web.table.validity')}</span>
            </div>
            {solutions.length === 0 ? (
              <div className="empty">{t('journals.solutions.empty')}</div>
            ) : solutions.map((s) => {
              const active = new Date(s.expires_at) > new Date()
              return (
                <div key={s.id} className="wtable-row"
                     style={{ gridTemplateColumns: GRID_SOLUTIONS }}>
                  <span className="min-w-0">
                    {/* Назва засобу и концентрация — данные записи журнала. */}
                    <span className="block truncate font-semibold"
                          style={{ color: 'var(--color-text)' }}>{s.agent_name}</span>
                    <span className="block truncate" style={{ color: 'var(--color-faint)' }}>
                      {s.concentration}
                    </span>
                  </span>
                  <span className="tabular">{t.number(Number(s.volume))} {s.unit}</span>
                  <span className="tabular">{t.dateTime(s.prepared_at, AT)}</span>
                  <span className="truncate"><Performer name={s.performer} /></span>
                  <span>
                    <span className={active ? 'badge-success tabular' : 'badge tabular'}>
                      {active
                        ? t('journals.solution.until', { date: t.dateTime(s.expires_at, AT) })
                        : t('journals.solution.expired')}
                    </span>
                  </span>
                </div>
              )
            })}
            {solutions.length > 0 && (
              <div className="wtable-foot">
                {/* Показано последние 30, а всего их `totals.solutions` —
                    подвал называет обе величины, иначе «Разом» спорил бы
                    с числом на карточке журнала выше. */}
                <span className="tabular">
                  {t('journals.web.table.total', { n: t.number(totals.solutions) })}
                </span>
                {totals.solutions > solutions.length && (
                  <span className="tabular">
                    {t('journals.web.table.shown', { n: t.number(solutions.length) })}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="card rise-2 !p-0 lg:hidden">
            {solutions.length === 0 ? (
              <div className="empty">{t('journals.solutions.empty')}</div>
            ) : solutions.map((s) => {
              const active = new Date(s.expires_at) > new Date()
              return (
                <div key={s.id} className="row px-5">
                  <div>
                    {/* Назва засобу и концентрация — данные записи журнала. */}
                    <p className="t-md">{s.agent_name} · {s.concentration}</p>
                    <p className="tabular t-xs prose-muted">
                      {t.number(Number(s.volume))} {s.unit}
                      {' · '}{t('journals.solution.prepared', { date: t.dateTime(s.prepared_at, AT) })}
                      {' · '}<Performer name={s.performer} />
                    </p>
                  </div>
                  <span className={active ? 'badge-success tabular' : 'badge tabular'}>
                    {active
                      ? t('journals.solution.until', { date: t.dateTime(s.expires_at, AT) })
                      : t('journals.solution.expired')}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'sterilization' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          {/* На телефоне та же форма приезжает шторкой по кнопке
              «Додати запис». */}
          {cycleForm && <div className="card rise-1 hidden lg:block">{cycleForm}</div>}

          {/* ── CRESKO Web: журнал стерилізації таблицей (только lg) ── */}
          <div className="wtable hidden lg:block">
            <div className="wtable-head" style={{ gridTemplateColumns: GRID_CYCLES }}>
              <span>{t('journals.web.table.device')}</span>
              <span>{t('journals.web.table.mode')}</span>
              <span>{t('journals.web.table.done')}</span>
              <span>{t('journals.web.table.performer')}</span>
              <span>{t('journals.web.table.indicator')}</span>
            </div>
            {cycles.length === 0 ? (
              <div className="empty">{t('journals.cycles.empty')}</div>
            ) : cycles.map((c) => (
              <div key={c.id} className="wtable-row"
                   style={{ gridTemplateColumns: GRID_CYCLES }}>
                {/* Назва пристрою — данные записи журнала. */}
                <span className="truncate font-semibold"
                      style={{ color: 'var(--color-text)' }}>{c.device}</span>
                <span className="tabular">
                  {t('journals.cycle.line', {
                    temp: t.number(c.temperature_c),
                    mins: t.number(c.duration_minutes),
                  })}
                </span>
                <span className="tabular">{t.dateTime(c.performed_at, AT)}</span>
                <span className="truncate"><Performer name={c.performer} /></span>
                <span>
                  <span className={c.indicator_ok ? 'badge-success' : 'badge-danger'}>
                    {c.indicator_ok ? t('journals.cycle.ok') : t('journals.cycle.fail')}
                  </span>
                </span>
              </div>
            ))}
            {cycles.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('journals.web.table.total', { n: t.number(totals.cycles) })}
                </span>
                {totals.cycles > cycles.length && (
                  <span className="tabular">
                    {t('journals.web.table.shown', { n: t.number(cycles.length) })}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="card rise-2 !p-0 lg:hidden">
            {cycles.length === 0 ? (
              <div className="empty">{t('journals.cycles.empty')}</div>
            ) : cycles.map((c) => (
              <div key={c.id} className="row px-5">
                <div>
                  {/* Назва пристрою — данные записи журнала. */}
                  <p className="t-md">{c.device}</p>
                  <p className="tabular t-xs prose-muted">
                    {t('journals.cycle.line', {
                      temp: t.number(c.temperature_c),
                      mins: t.number(c.duration_minutes),
                    })}
                    {' · '}{t.dateTime(c.performed_at, AT)}
                    {' · '}<Performer name={c.performer} />
                  </p>
                </div>
                <span className={c.indicator_ok ? 'badge-success' : 'badge-danger'}>
                  {c.indicator_ok ? t('journals.cycle.ok') : t('journals.cycle.fail')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Журнал дій — Audit Trail з ТЗ (п.4). Кожна зміна даних пишеться
          тригером у незмінювану таблицю; тут її лише читають. Це відповідь
          на запитання інспектора «хто і коли це виправив» — і водночас
          захист самого власника від «я нічого не міняв». */}
      {tab === 'actions' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          <p className="field-hint rise">{t('journals.audit.hint')}</p>

          {/* ── CRESKO Web: журнал дій таблицей (только lg) ─────────
              Четыре колонки вместо склеенной строки: на широком экране
              «хто» и «коли» — то, по чему этот журнал читают, и держать
              их в одном абзаце с названием сущности значит заставлять
              искать глазами. Строки не нажимаются: аудит неизменяем,
              открывать в нём нечего. */}
          <div className="wtable hidden lg:block">
            <div className="wtable-head" style={{ gridTemplateColumns: GRID_AUDIT }}>
              <span>{t('journals.web.table.event')}</span>
              <span>{t('journals.web.table.object')}</span>
              <span>{t('journals.web.table.who')}</span>
              <span>{t('journals.web.table.when')}</span>
            </div>
            {audit === null ? (
              <div className="empty">{t('journals.audit.loading')}</div>
            ) : audit.length === 0 ? (
              <div className="empty">{t('journals.audit.empty')}</div>
            ) : audit.map((a) => (
              <div key={a.id} className="wtable-row"
                   style={{ gridTemplateColumns: GRID_AUDIT }}>
                <span className="truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                  {actionLabel(t, a.action)} {entityLabel(t, a.entity)}
                </span>
                {/* `label` — имя изменённой строки (назва засобу, номер
                    партії): данные арендатора, не переводятся. */}
                <span className="truncate">{a.label || t('common.noValue')}</span>
                <span className="truncate">{a.actor_email ?? t('journals.audit.system')}</span>
                <span className="tabular">{t.dateTime(a.at, AT)}</span>
              </div>
            ))}
            {audit !== null && audit.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('journals.web.table.total', { n: t.number(audit.length) })}
                </span>
              </div>
            )}
          </div>

          <div className="card rise-1 !p-0 lg:hidden">
            {audit === null ? (
              <div className="empty">{t('journals.audit.loading')}</div>
            ) : audit.length === 0 ? (
              <div className="empty">{t('journals.audit.empty')}</div>
            ) : audit.map((a) => (
              <div key={a.id} className="row px-5">
                <div className="min-w-0">
                  <p className="t-md truncate">
                    {actionLabel(t, a.action)}{' '}
                    {entityLabel(t, a.entity)}
                    {/* `label` — имя изменённой строки (назва засобу, номер
                        партії): данные арендатора, не переводятся. */}
                    {a.label ? <span className="prose-muted"> · {a.label}</span> : null}
                  </p>
                  <p className="t-xs prose-muted truncate">
                    {a.actor_email ?? t('journals.audit.system')}
                  </p>
                </div>
                <span className="badge tabular shrink-0">{t.dateTime(a.at, AT)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* ── Запись в журнал (телефон) ───────────────────────────
          Одна шторка на все журналы: поля берутся у того, что открыт.
          Три шторки подряд означали бы три состояния «открыто» и три
          места, где можно забыть закрыть. */}
      <Sheet open={adding && addForm !== null} onClose={() => setAdding(false)}
             title={addTitle}>
        {err && <p className="field-error mb-3">{err}</p>}
        {addForm}
      </Sheet>

      {/* ── История отметок по пункту чек-листа ─────────────────
          ТЗ 3.3 называет это журналом, а не «состоянием на сегодня».
          Здесь видно ровно то, что напечатано в отчёте для проверки:
          когда и кто отмечал, без правки — журнал неизменяем и защищён
          дважды (нет политик UPDATE и DELETE плюс триггер). */}
      <Sheet open={history !== null} onClose={() => setHistory(null)}
             title={history?.task.name}>
        {history?.rows === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-row px-1"><span /><span /><span /><span /></div>
            ))}
          </div>
        ) : (history?.rows ?? []).length === 0 ? (
          <div className="empty">
            <p className="empty-title">{t('journals.cleaning.history.empty')}</p>
            <p className="empty-desc">{t('journals.cleaning.history.emptyDesc')}</p>
          </div>
        ) : (
          <>
            <p className="field-hint mb-2">
              {t('journals.cleaning.history.count', { n: (history?.rows ?? []).length })}
            </p>
            <div className="flex flex-col">
              {(history?.rows ?? []).map((r) => (
                <div key={r.id} className="row">
                  <span className="tabular t-md">{t.dateTime(r.at, AT)}</span>
                  <span className="t-sm prose-muted"><Performer name={r.performer} /></span>
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>

    </div>
  )
}

// ── Значения базы и подписи к ним — РАЗНЫЕ вещи ────────────────────────────
//
// Триггер пишет техническое: действие (`insert`) и имя таблицы
// (`material_batches`). Это служебные значения, они не переводятся никогда
// и остаются здесь списком; переводится ПОДПИСЬ к значению, и живёт она
// в словаре (`journals.audit.action.insert`, `journals.audit.entity.materials`)
// — тот же приём, что у ролей в `/app/team`.
//
// Значение, которого нет в списке, показывается КАК ЕСТЬ: новая таблица
// попадёт в аудит раньше, чем строка в словарь, и увидеть `shipments`
// полезнее, чем пустоту.
const ACTIONS = ['insert', 'update', 'delete'] as const
type AuditActionKind = (typeof ACTIONS)[number]
const actionLabel = (t: T, a: string): string =>
  ((ACTIONS as readonly string[]).includes(a)
    ? t(`journals.audit.action.${a as AuditActionKind}`) : a)

const ENTITIES = [
  'materials', 'material_batches', 'material_containers', 'material_documents',
  'material_barcodes', 'tech_cards', 'cleaning_tasks', 'customers', 'offerings',
  'offering_variants', 'variant_materials', 'suppliers', 'storage_locations',
  'staff', 'tenant_members', 'tenants',
] as const
type AuditEntity = (typeof ENTITIES)[number]
const entityLabel = (t: T, e: string): string =>
  ((ENTITIES as readonly string[]).includes(e)
    ? t(`journals.audit.entity.${e as AuditEntity}`) : e)
