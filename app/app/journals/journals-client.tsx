'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'

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
  const tab: 'cleaning' | 'solutions' | 'sterilization' | 'actions' =
    raw === 'solutions' || raw === 'sterilization' || raw === 'actions' ? raw : 'cleaning'
  // Параметр назван `next`, а не `t`: `t` — переводчик.
  const setTab = (next: typeof tab) =>
    router.replace(next === 'cleaning' ? '/app/journals' : `/app/journals?tab=${next}`)
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
    setBusy(null)
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
    setBusy(null)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        {/* Подпись кнопки — интерфейс и переводится. САМ отчёт по этой ссылке
            собирается всегда по-украински и от языка кабинета не зависит:
            это документ для Держпродспоживслужби (lib/report/sanitation-report.ts). */}
        <a href="/app/journals/report" target="_blank" rel="noreferrer"
           className="btn-primary t-sm">
          {t('journals.report.open')}
        </a>
        <span className="hidden w-px lg:block" />
        {/* На телефоне эти же вкладки живут в нижней панели приложения —
            дублировать их чипсами значит съесть экран дважды. */}
        <button onClick={() => setTab('cleaning')}
                className={(tab === 'cleaning' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>{t('journals.tab.cleaning')}</button>
        <button onClick={() => setTab('solutions')}
                className={(tab === 'solutions' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>{t('journals.tab.solutions')}</button>
        <button onClick={() => setTab('sterilization')}
                className={(tab === 'sterilization' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>{t('journals.tab.sterilization')}</button>
        <button onClick={() => setTab('actions')}
                className={(tab === 'actions' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>{t('journals.tab.actions')}</button>
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {tab === 'cleaning' && (
        <section className="flex flex-col gap-4">
          <div className="card rise-1 !p-0">
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
                <div>
                  <p className="t-md">{task.name}</p>
                  {task.doneToday && task.doneAt ? (
                    <p className="t-xs prose-muted">
                      {t.dateTime(task.doneAt, AT)} · <Performer name={task.donePerformer} />
                    </p>
                  ) : task.schedule ? (
                    <p className="t-xs prose-muted">{task.schedule}</p>
                  ) : null}
                </div>
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
          {canManage && (
            <form onSubmit={addTask} className="rise-2 flex gap-2">
              <input className="input" placeholder={t('journals.cleaning.newTask.placeholder')}
                     value={newTask} onChange={(e) => setNewTask(e.target.value)} />
              <button className="btn-secondary shrink-0" disabled={!newTask.trim() || busy === 'newtask'}>
                {t('journals.cleaning.newTask.submit')}
              </button>
            </form>
          )}
          <p className="field-hint">{t('journals.cleaning.hint')}</p>
        </section>
      )}

      {tab === 'solutions' && (
        <section className="flex flex-col gap-4">
          {canWrite && (
          <form onSubmit={addSolution} className="card rise-1 grid gap-3 sm:grid-cols-2">
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
            <button className="btn-primary self-end" disabled={busy === 'solution'}>
              {t('journals.solution.submit')}
            </button>
          </form>
          )}

          <div className="card rise-2 !p-0">
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
        <section className="flex flex-col gap-4">
          {canWrite && (
          <form onSubmit={addCycle} className="card rise-1 grid gap-3 sm:grid-cols-2">
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
            <button className="btn-primary self-end" disabled={busy === 'cycle'}>
              {t('journals.cycle.submit')}
            </button>
          </form>
          )}

          <div className="card rise-2 !p-0">
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
        <section className="flex flex-col gap-4">
          <p className="field-hint rise">{t('journals.audit.hint')}</p>
          <div className="card rise-1 !p-0">
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
