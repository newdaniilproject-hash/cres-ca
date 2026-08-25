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
  IconBack, IconBeaker, IconCheck, IconChevronRight, IconClipboard, IconDoc, IconList,
  IconPlus, IconRepeat, IconScissors,
} from '@/components/icons'

// Дата и время записи журнала — «16 серп., 14:05». Это НАБОР ОПЦИЙ,
// а не своя `fmt`: форматирует по-прежнему `t.dateTime`, то есть язык
// и порядок частей выбирает локаль, а не мы (lib/i18n/format.ts).
const AT: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}

// Только время — «10:15». Хендофф, раздел G (`inspJournals`): у записи
// журнала час стоит ОТДЕЛЬНОЙ колонкой слева и набран акцентом. Дата
// в строке при этом не повторяется: её называет заголовок дня над
// группой (`journalDay` — «Записи за 09.05.2025»).
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

// День записи — «19.08.2026». Заголовок группы; цифрами, а не словом
// месяца, ровно как в хендоффе («ЗАПИСИ ЗА 9.05.2025»): надзаголовок
// набран капслоком с разрядкой, и «19 СЕРПНЯ 2026 Р.» занимает в нём
// всю ширину телефона.
const DAY: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: '2-digit', year: 'numeric',
}

// Один ли это календарный день. Сравнение в МЕСТНОМ поясе браузера,
// а не по строке ISO: строка приходит в UTC, и раствор, приготовленный
// в 23:00 по Киеву, лежит в ней вчерашним днём.
function sameLocalDay(a: string, b: string): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear()
    && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate()
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

// ── Записи журнала, разложенные по дням ────────────────────────────────────
//
// Хендофф, раздел F: `journalDay` показывает «Записи за 09.05.2025», то есть
// журнал читается ДНЯМИ, а не сплошной лентой. Календаря-месяца у нас нет
// (см. оговорку у самих списков), но день как единица чтения обязан быть:
// без него у записи негде показать дату, кроме как в строке рядом с часом,
// а тогда строка перестаёт помещаться на 390px.
//
// Список приезжает УЖЕ отсортированным базой по убыванию времени, поэтому
// группировка идёт подряд, без второй сортировки на клиенте.
function byDay<R>(rows: R[], at: (r: R) => string): { key: string; at: string; items: R[] }[] {
  const out: { key: string; at: string; items: R[] }[] = []
  for (const r of rows) {
    const key = new Date(at(r)).toDateString()
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(r)
    else out.push({ key, at: at(r), items: [r] })
  }
  return out
}

// Строка записи журнала (хендофф, раздел G): час акцентом слева, название
// и исполнитель посередине, бейдж состояния справа. Нажатие открывает
// карточку записи — `journalEntry` из раздела F.
//
// Объявлена НА ВЕРХНЕМ УРОВНЕ модуля, а не внутри рендера: функция,
// созданная на каждой отрисовке, — новый тип элемента, и React сносит
// поддерево (та же грабля, из-за которой формы ниже лежат элементами JSX).
function EntryRow({ at, title, meta, badge, onOpen }: {
  at: string; title: string; meta: React.ReactNode
  badge: React.ReactNode; onOpen: () => void
}) {
  const t = useT()
  return (
    <div className="row px-5">
      <button type="button" onClick={onOpen}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              style={{ minHeight: 'var(--tap-min)' }}>
        {/* Час — единственное место экрана, где акцент стоит на тексте:
            по нему запись и находят глазами. 42px — ширина колонки времени
            из хендоффа (раздел D, вид «День»); без фиксированной ширины
            «09:05» и «15:45» разъезжаются, и колонка перестаёт быть
            колонкой. Своего токена под ширину колонки в системе нет —
            это величина макета, как и 110×78 у плашки техкарты. */}
        <span className="tabular t-base shrink-0 font-bold"
              style={{ color: 'var(--color-accent-ink)', width: 42 }}>
          {t.dateTime(at, TIME)}
        </span>
        <span className="min-w-0 flex-1">
          {/* Назва засобу або пристрою — данные записи журнала. */}
          <span className="t-md clamp-2 block">{title}</span>
          <span className="t-xs prose-muted mt-0.5 block truncate">{meta}</span>
        </span>
      </button>
      {badge}
    </div>
  )
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

  // ── Карточка записи (`journalEntry` из раздела F) ────────────────────────
  //
  // Хендофф показывает поля записи таблицей «ключ → значення». Ради этого
  // строка списка и стала короткой: раньше объём, концентрация, время
  // и исполнитель были склеены в одну строку под названием и на 390px
  // занимали три строки текста — то есть карточка записи существовала,
  // просто её роль исполняла строка списка.
  //
  // ⚠️ КНОПОК «Редагувати» И «Видалити запис» ЗДЕСЬ НЕТ, хотя в макете они
  // есть. Записи санитарных журналов неизменяемы СВОЙСТВОМ БАЗЫ: политик
  // UPDATE и DELETE у них не существует, плюс триггер безусловно роняет
  // любую попытку. Кнопка, которая гарантированно упрётся в отказ, хуже
  // её отсутствия: она обещает то, чего в продукте нет ни у кого, включая
  // владельца. Ошибочная запись гасится встречной — как движение склада.
  const [entry, setEntry] = useState<{ title: string; rows: [string, React.ReactNode][] } | null>(null)

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
  // ── Есть ли что повторять ────────────────────────────────────────────
  //
  // Только у двух журналов из трёх: у прибирання повторять нечего —
  // там и так одна кнопка «Виконано» на пункт чек-листа.
  //
  // Списки приходят отсортированными по убыванию времени (`page.tsx`),
  // поэтому последняя запись — нулевая. Второй сортировки здесь нет
  // намеренно: она разошлась бы с первой в день, когда порядок в запросе
  // поменяют, и кнопка молча начала бы подставлять старое.
  const lastSolution = solutions[0] ?? null
  const lastCycle = cycles[0] ?? null
  const repeatable = canWrite && (
    (tab === 'solutions' && lastSolution !== null)
    || (tab === 'sterilization' && lastCycle !== null))

  function repeatLast() {
    if (tab === 'solutions' && lastSolution) {
      // Назва засобу, концентрація і об'єм — дані орендаря, переносятся
      // как есть. Срок годности раствора считается от МОМЕНТА записи,
      // поэтому переносится не дата, а число часов, на которое его
      // готовят: подставленная старая дата означала бы просроченный
      // раствор в момент создания.
      setAgent(lastSolution.agent_name)
      setConc(lastSolution.concentration)
      setVol(String(lastSolution.volume))
      setHours(String(Math.max(1, Math.round(
        (new Date(lastSolution.expires_at).getTime()
          - new Date(lastSolution.prepared_at).getTime()) / 36e5))))
      return
    }
    if (tab === 'sterilization' && lastCycle) {
      setDevice(lastCycle.device)
      setTemp(String(lastCycle.temperature_c))
      setMins(String(lastCycle.duration_minutes))
      // Индикатор НЕ переносится: это результат конкретного цикла,
      // и подставлять его прошлым значением значит подсказать ответ
      // на вопрос проверки. Мастер смотрит цвет и отмечает сам.
      setIndicator(false)
    }
  }

  // Сколько пунктов чек-листа отмечено сегодня. Считается по тому же
  // признаку, что рисует строку, — включая отметки, ушедшие в офлайн-
  // очередь: иначе строка говорила бы «виконано», а счётчик над ней нет.
  const doneCount = tasks.filter((x) => x.doneToday || offDone.has(x.id)).length

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
      <div className="hidden items-center justify-between gap-4 lg:flex">
        {/* §12: H1 со значком журнала и подписью под ним. Значок — тот же
            приём, что у «Клієнтів» и «Фінансів»: плашка 44px акцентом.
            Взят `IconList`, а не `IconCheck` (значок раздела в панели)
            и не `IconClipboard`: обоими уже помечены КАРТОЧКИ журналов
            ниже — стерилизация и прибирання, — и третья такая же плашка
            над ними читалась бы как ещё один журнал. Подпись — тот же
            ключ, которым раздел описан в шторке профиля. */}
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconList size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1" data-size="27">{t('app.screen.journals.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.journals.desc')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
      {/* ── «ПОВТОРИТИ ОСТАННЄ» ──────────────────────────────────
          Отзыв владельца 25.08.2026 дословно: «это должно занимать пару
          секунд, иначе это делать не будут». Он прав, и это не придирка
          к оформлению: журнал, который дорого заполнять, заполняют
          задним числом перед проверкой — то есть он перестаёт быть
          доказательством и становится сочинением.

          Из трёх журналов ТЗ 3.3 быстрым был один: прибирання — одна
          кнопка «Відмітити». Дезрозчини и стерилізація требовали по
          четыре поля НАБРАТЬ, хотя изо дня в день там одно и то же:
          тот же засіб, та же концентрация, та же сухожаровая шкаф,
          та же температура и время.

          Поэтому кнопка подставляет прошлую запись и ОТКРЫВАЕТ ФОРМУ,
          а не отправляет сразу. Разница принципиальная: санитарный
          журнал неизменяем (0014 — нет политик UPDATE и DELETE плюс
          триггер), и запись, созданная промахом пальца, останется
          в нём навсегда. Два нажатия и ноль набора — это и есть
          «пара секунд», а один слепой тап — это риск испортить
          доказательство.

          У стерилизации при этом переносится ВСЁ, кроме индикатора:
          прибор, температура и время повторяются, а результат цвета
          индикатора — единственное, что мастер обязан посмотреть
          и отметить сам. Подставлять его прошлым значением значило бы
          подсказать ответ на вопрос проверки. */}
      {/* ⚠️ ПРИБИРАННЯ ЗДЕСЬ НЕТ, и это не пропуск. У остальных журналов
          вход в действие — «додати запис», и его место сверху. У чек-листа
          действие мастера — отметить пункт, оно уже в каждой строке, а эта
          кнопка заводит НОВЫЙ ПУНКТ, то есть правит справочник заведения
          (право `compliance.write`, не `compliance.journal.write`).
          Настройка, которую трогают раз в жизни, стояла выше работы,
          которую делают после каждого клиента, — и была первым, что
          мастер видел, открыв журнал. Она переехала ПОД список. */}
      {chosen !== null && addForm !== null && tab !== 'cleaning' && (
        <div className="rise-1 flex flex-col gap-2 lg:hidden">
          {repeatable && (
            <button type="button" className="btn-primary"
                    onClick={() => { setErr(''); repeatLast(); setAdding(true) }}>
              <IconRepeat size={18} />
              {t('journals.repeatLast')}
            </button>
          )}
          <button type="button"
                  className={repeatable ? 'btn-secondary' : 'btn-primary'}
                  onClick={() => { setErr(''); setAdding(true) }}>
            <IconPlus size={18} />
            {addTitle}
          </button>
        </div>
      )}

      {err && <p className="field-error rise">{err}</p>}

      {tab === 'cleaning' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          {/* ── ОТВЕТ НА ВОПРОС, С КОТОРЫМ ОТКРЫВАЮТ ЧЕК-ЛИСТ ────────────
              «Сколько мне ещё осталось». До 25.08.2026 его на экране
              не было вовсе: семь одинаковых строк, и сосчитать
              невыполненные можно было только глазами по каждой.

              Считается по ТОМУ ЖЕ признаку, что рисует строку, включая
              отметки, отправленные офлайн (`offDone`), — иначе мастер
              без сети видел бы «виконано» на строке и старое число
              в заголовке. */}
          {tasks.length > 0 && (
            <div className="card rise-1 lg:hidden">
              <p className="eyebrow">{t('journals.cleaning.today')}</p>
              <p className="hero-value tabular">
                {t('journals.cleaning.progress', {
                  done: t.number(doneCount), total: t.number(tasks.length),
                })}
              </p>
              <div className="hero-bar mt-3">
                <span style={{
                  width: `${Math.round((doneCount / tasks.length) * 100)}%`,
                  background: 'var(--color-success)',
                }} />
              </div>
              <p className="field-hint mt-2">
                {doneCount === tasks.length
                  ? t('journals.cleaning.progress.allDone')
                  : t('journals.cleaning.progress.left', {
                    n: t.number(tasks.length - doneCount),
                  })}
              </p>
            </div>
          )}

          <div className="card rise-1 !p-0 lg:hidden">
            {tasks.length === 0 ? (
              <div className="empty">
                {canManage
                  ? t('journals.cleaning.empty.manage')
                  : t('journals.cleaning.empty.read')}
              </div>
            ) : tasks.map((task) => {
              // Параметр назван `task`, а не `t`: `t` — переводчик.
              // Название пункта чек-листа и его расписание — данные заклада,
              // они не переводятся.
              const done = task.doneToday || offDone.has(task.id)
              return (
              // Выполненное ПРИГЛУШЕНО, а не спрятано и не переставлено
              // вниз. Спрятать нельзя — журнал обязан показывать, что
              // сделано; переставить нельзя — порядок пунктов задаёт
              // заведение (`position`), и прыгающая при отметке строка
              // сбивает палец на следующей. Тот же приём, что у нулевого
              // остатка на складе: вес говорит «сюда смотреть не надо».
              <div key={task.id} className="row px-5"
                   style={done ? { opacity: 0.6 } : undefined}>
                {/* Пункт чек-листа ОТКРЫВАЕТСЯ — это журнал, а не список
                    состояний на сегодня. Кнопкой, а не ссылкой: история
                    приезжает шторкой и своего адреса не имеет. */}
                <button type="button" className="min-w-0 flex-1 text-left"
                        onClick={() => void openHistory(task)}>
                  <p className="t-md">{task.name}</p>
                  {/* Расписание показывается ВСЕГДА, а не только у
                      неотмеченного. Оно отвечает на «как часто это надо
                      делать» — вопрос, который не исчезает оттого, что
                      сегодня пункт уже отмечен; а пропадающая строка
                      к тому же дёргала высоту при каждой отметке. */}
                  {task.schedule && (
                    <p className="t-xs prose-muted">{task.schedule}</p>
                  )}
                  {/* Час и исполнитель — отдельной строкой, без точки
                      между ними (решение владельца 25.08.2026). */}
                  {task.doneToday && task.doneAt && (
                    <p className="t-xs prose-muted">
                      {t.dateTime(task.doneAt, TIME)}{' — '}
                      <Performer name={task.donePerformer} />
                    </p>
                  )}
                </button>
                {done ? (
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
              )
            })}
          </div>

          {/* Заведение нового пункта чек-листа — ПОД списком: это правка
              справочника заведения, а не работа мастера (см. выше). */}
          {chosen !== null && canManage && (
            <button type="button" className="btn-secondary rise-1 lg:hidden"
                    onClick={() => { setErr(''); setAdding(true) }}>
              <IconPlus size={18} />
              {addTitle}
            </button>
          )}

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
              «Новий пункт чек-листа» — см. `addForm` ниже.

              На lg она лежит В КАРТОЧКЕ, как формы двух других журналов
              рядом: поле и кнопка прямо на фоне страницы — единственное
              место экрана без поверхности под собой, и на светлом фоне
              CRESKO Web это читается как обрывок таблицы выше. */}
          {taskForm && (
            <div className="card rise-2 hidden lg:block">
              <h2 className="webh2 mb-3">{t('journals.cleaning.newTask.title')}</h2>
              {taskForm}
            </div>
          )}
          <p className="field-hint">{t('journals.cleaning.hint')}</p>
        </section>
      )}

      {tab === 'solutions' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
          {/* ── CRESKO Web: журнал розчинів таблицей (только lg) ────
              Ни одного действия у строки нет и на телефоне — розчин
              записывают формой под таблицей, а запись журнала неизменяема.
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

          {/* ⚠️ ФОРМА СТОИТ ПОД ТАБЛИЦЕЙ, А НЕ НАД НЕЙ (перенесено
              20.08.2026). Пять полей над журналом занимали первый экран
              и на 1440×900 оставляли под собой две строки записей: сюда
              заходят СМОТРЕТЬ (на каждой проверке), а записывают раз
              в смену. В §12 хендоффа формы на экране нет вовсе — там
              запись открывается кнопкой; шторка у нас именно так
              и работает ниже lg. Тот же порядок теперь у всех трёх
              журналов: сначала записи, потом форма. */}
          {solutionForm && (
            <div className="card rise-2 hidden lg:block">
              <h2 className="webh2 mb-3">{t('journals.add')}</h2>
              {solutionForm}
            </div>
          )}

          {/* ── Журнал розчинів по дням (телефон) ────────────────
              Хендофф, раздел F: «Записи за {дата}» и строка записи
              с часом акцентом. Бейдж набран ОДНИМ СЛОВОМ («придатний» /
              «непридатний»): до 19.08.2026 в него уезжала дата
              окончания срока, и на 390px пилюля переносилась в две
              строки, разваливая строку записи. Сам срок никуда не делся
              — он в карточке записи, где у него есть подпись. */}
          {solutions.length === 0 ? (
            <div className="card rise-2 lg:hidden">
              <div className="empty">{t('journals.solutions.empty')}</div>
            </div>
          ) : byDay(solutions, (s) => s.prepared_at).map((day) => (
            <div key={day.key} className="rise-2 flex flex-col gap-2 lg:hidden">
              <p className="eyebrow">
                {t('journals.day.records', { date: t.date(day.at, DAY) })}
              </p>
              <div className="card !p-0">
                {day.items.map((s) => {
                  const active = new Date(s.expires_at) > new Date()
                  return (
                    <EntryRow
                      key={s.id} at={s.prepared_at}
                      // Назва засобу — данные записи журнала. Концентрация
                      // ушла во вторую строку: в заголовке она разрывала
                      // название засоба переносом на 390px, а различают
                      // засоби по имени, а не по проценту.
                      title={s.agent_name}
                      // Концентрація і виконавець — дві РІЗНІ величини,
                      // і розділяє їх зазор, а не крапка: те саме правило,
                      // яким владелец зняв крапки-роздільники зі складу
                      // 25.08.2026. Правило не про один екран.
                      meta={(
                        <span className="flex flex-wrap items-baseline gap-x-3">
                          <span>{s.concentration}</span>
                          <Performer name={s.performer} />
                        </span>
                      )}
                      // ── ЧАС, ДО ЯКОГО РОЗЧИН ПРИДАТНИЙ, — У РЯДКУ ────
                      //
                      // ТЗ 3.3 називає «термін придатності робочого
                      // розчину» серед обов'язкових полів, і саме він —
                      // питання, з яким майстер відкриває цей журнал:
                      // «цим ще можна працювати?». Досі рядок казав
                      // тільки «придатний», а година лежала в картці,
                      // тобто за ще одним натисканням — і це на журналі,
                      // який дивляться між клієнтами стоячи.
                      //
                      // У простроченого години немає навмисно: «непридатний»
                      // — вичерпна відповідь, а година минулого дня поруч
                      // із нею читається як пропозиція ще встигнути.
                      badge={(
                        <span className="shrink-0 text-right">
                          <span className={`${active ? 'badge-success' : 'badge'} block`}>
                            {active
                              ? t('journals.solution.valid')
                              : t('journals.solution.expired')}
                          </span>
                          {active && (
                            <span className="tabular t-xs mt-1 block prose-muted">
                              {t('journals.solution.untilShort', {
                                // День дописывается, если срок НЕ сегодня.
                                // Голое «до 06:00» у раствора, который
                                // держат сутки, читается как «шесть утра
                                // уже прошло» — то есть ровно наоборот.
                                time: t.dateTime(
                                  s.expires_at,
                                  sameLocalDay(s.expires_at, s.prepared_at) ? TIME : AT,
                                ),
                              })}
                            </span>
                          )}
                        </span>
                      )}
                      onOpen={() => setEntry({
                        title: s.agent_name,
                        rows: [
                          [t('journals.entry.at'), t.dateTime(s.prepared_at, AT)],
                          [t('journals.solution.conc.label'), s.concentration],
                          [t('journals.web.table.volume'),
                            `${t.number(Number(s.volume))} ${s.unit}`],
                          [t('journals.web.table.validity'),
                            active
                              ? t('journals.solution.until', { date: t.dateTime(s.expires_at, AT) })
                              : t('journals.solution.expired')],
                          [t('journals.web.table.performer'),
                            <Performer key="p" name={s.performer} />],
                        ],
                      })}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'sterilization' && (
        <section className={`flex flex-col gap-4 ${chosen === null ? 'hidden lg:flex' : ''}`}>
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
                <span className="tabular flex flex-wrap items-baseline gap-x-2">
                  <span>{t('journals.cycle.temp', { temp: t.number(c.temperature_c) })}</span>
                  <span>{t('journals.cycle.mins', { mins: t.number(c.duration_minutes) })}</span>
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

          {/* Форма — под таблицей, как у двух журналов выше (разбор там же). */}
          {cycleForm && (
            <div className="card rise-2 hidden lg:block">
              <h2 className="webh2 mb-3">{t('journals.add')}</h2>
              {cycleForm}
            </div>
          )}

          {/* ── Журнал стерилізації по дням (телефон) ────────────
              Провал цикла — ТАКАЯ ЖЕ запись, как успешный: журнал
              обязан показывать её рядом, а не прятать. Красный бейдж
              и есть то, ради чего проверка сюда смотрит. */}
          {cycles.length === 0 ? (
            <div className="card rise-2 lg:hidden">
              <div className="empty">{t('journals.cycles.empty')}</div>
            </div>
          ) : byDay(cycles, (c) => c.performed_at).map((day) => (
            <div key={day.key} className="rise-2 flex flex-col gap-2 lg:hidden">
              <p className="eyebrow">
                {t('journals.day.records', { date: t.date(day.at, DAY) })}
              </p>
              <div className="card !p-0">
                {day.items.map((c) => (
                  <EntryRow
                    key={c.id} at={c.performed_at}
                    // Назва пристрою — данные записи журнала.
                    title={c.device}
                    meta={(
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span>{t('journals.cycle.temp', { temp: t.number(c.temperature_c) })}</span>
                        <span>{t('journals.cycle.mins', { mins: t.number(c.duration_minutes) })}</span>
                        <Performer name={c.performer} />
                      </span>
                    )}
                    badge={(
                      <span className={c.indicator_ok ? 'badge-success' : 'badge-danger'}>
                        {c.indicator_ok ? t('journals.cycle.ok') : t('journals.cycle.fail')}
                      </span>
                    )}
                    onOpen={() => setEntry({
                      title: c.device,
                      rows: [
                        [t('journals.entry.at'), t.dateTime(c.performed_at, AT)],
                        [t('journals.cycle.temp.label'), `${t.number(c.temperature_c)} °C`],
                        [t('journals.cycle.mins.label'), t.number(c.duration_minutes)],
                        [t('journals.web.table.indicator'),
                          c.indicator_ok ? t('journals.cycle.ok') : t('journals.cycle.fail')],
                        [t('journals.web.table.performer'),
                          <Performer key="p" name={c.performer} />],
                      ],
                    })}
                  />
                ))}
              </div>
            </div>
          ))}
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

          {/* ── Журнал дій по дням (телефон) ─────────────────────
              Та же строка записи, что и в санитарных журналах: час
              акцентом слева, событие и автор посередине. Дата уехала
              из бейджа справа в заголовок дня — она повторялась
              у каждой строки подряд, а бейджем набирают СОСТОЯНИЕ,
              и дата в его форме читалась как «статус: 19 серп.».
              Карточки у записи аудита нет: всё, что о ней известно,
              уже в строке — открывать нечего. */}
          {audit === null ? (
            <div className="card rise-1 lg:hidden">
              <div className="empty">{t('journals.audit.loading')}</div>
            </div>
          ) : audit.length === 0 ? (
            <div className="card rise-1 lg:hidden">
              <div className="empty">{t('journals.audit.empty')}</div>
            </div>
          ) : byDay(audit, (a) => a.at).map((day) => (
            <div key={day.key} className="rise-1 flex flex-col gap-2 lg:hidden">
              <p className="eyebrow">
                {t('journals.day.records', { date: t.date(day.at, DAY) })}
              </p>
              <div className="card !p-0">
                {day.items.map((a) => (
                  <div key={a.id} className="row px-5">
                    <span className="tabular t-base shrink-0 font-bold"
                          style={{ color: 'var(--color-accent-ink)', width: 42 }}>
                      {t.dateTime(a.at, TIME)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-md clamp-2 block">
                        {actionLabel(t, a.action)}{' '}
                        {entityLabel(t, a.entity)}
                        {/* `label` — имя изменённой строки (назва засобу,
                            номер партії): данные арендатора, не переводятся. */}
                        {a.label ? <span className="prose-muted"> · {a.label}</span> : null}
                      </span>
                      <span className="t-xs prose-muted mt-0.5 block truncate">
                        {a.actor_email ?? t('journals.audit.system')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
                  {/* Дата акцентом — тем же приёмом, что и час в строке
                      записи: по времени эту таблицу и читают. */}
                  <span className="tabular t-base font-bold"
                        style={{ color: 'var(--color-accent-ink)' }}>
                    {t.dateTime(r.at, AT)}
                  </span>
                  <span className="t-sm prose-muted"><Performer name={r.performer} /></span>
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>

      {/* ── Картка запису журналу (`journalEntry`, розділ F) ────
          Поля таблицей «ключ → значення», как в хендоффе. Ни правки,
          ни удаления: запись санитарного журнала неизменяема свойством
          базы, и об этом же говорит подпись внизу — иначе отсутствие
          кнопок читается как «забыли сделать». */}
      <Sheet open={entry !== null} onClose={() => setEntry(null)}
             title={entry?.title}>
        <div className="kv">
          {(entry?.rows ?? []).map(([label, value]) => (
            <div key={label} className="kv-row">
              <span className="kv-key">{label}</span>
              <span className="kv-val tabular">{value}</span>
            </div>
          ))}
        </div>
        <p className="field-hint mt-3">{t('journals.entry.hint')}</p>
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
