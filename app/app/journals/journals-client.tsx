'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'

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
  return name
    ? <>{name}</>
    : <span title="Учасника вилучено зі складу команди — сам запис незмінний">
        імʼя недоступне
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
  const setTab = (t: typeof tab) =>
    router.replace(t === 'cleaning' ? '/app/journals' : `/app/journals?tab=${t}`)
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
        await enqueue('Прибирання: відмітка', {
          kind: 'journal.cleaning', tenantId, taskId, userId,
        })
        setOffDone((prev) => new Set(prev).add(taskId))
        toast.info('Збережено офлайн', 'Запис піде в журнал, щойно зʼявиться мережа.')
        return
      }
      setErr(e instanceof Error ? e.message : String(e))
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
    if (error) { setErr(error.message); return }
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
        await enqueue(`Дезрозчин: ${agent}`, {
          kind: 'journal.solution', tenantId, userId,
          agentName: agent, concentration: conc,
          volume: Number(vol) || null, expiresAt,
        })
        toast.info('Збережено офлайн', 'Розчин зʼявиться в журналі після синхронізації.')
        setAgent(''); setConc(''); setVol('')
        return
      }
      setErr(ex instanceof Error ? ex.message : String(ex))
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
        await enqueue(`Стерилізація: ${device}`, {
          kind: 'journal.sterilization', tenantId, userId, device,
          temperatureC: Number(temp), durationMinutes: Number(mins),
          indicatorOk: indicator,
        })
        toast.info('Збережено офлайн', 'Цикл зʼявиться в журналі після синхронізації.')
        return
      }
      setErr(ex instanceof Error ? ex.message : String(ex))
      return
    }
    setBusy(null)
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <a href="/app/journals/report" target="_blank" rel="noreferrer"
           className="btn-primary t-sm">
          Звіт для перевірки → PDF
        </a>
        <span className="hidden w-px lg:block" />
        {/* На телефоне эти же вкладки живут в нижней панели приложения —
            дублировать их чипсами значит съесть экран дважды. */}
        <button onClick={() => setTab('cleaning')}
                className={(tab === 'cleaning' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>Прибирання</button>
        <button onClick={() => setTab('solutions')}
                className={(tab === 'solutions' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>Дезрозчини</button>
        <button onClick={() => setTab('sterilization')}
                className={(tab === 'sterilization' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>Стерилізація</button>
        <button onClick={() => setTab('actions')}
                className={(tab === 'actions' ? 'chip-active' : 'chip') + ' hidden lg:inline-flex'}>Дії</button>
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {tab === 'cleaning' && (
        <section className="flex flex-col gap-4">
          <div className="card rise-1 !p-0">
            {tasks.length === 0 ? (
              <div className="empty">
                {canManage
                  ? 'Додайте пункти чек-листа нижче — «Кварцування», «Обробка крісла»…'
                  : 'Чек-лист прибирання ще не заведено.'}
              </div>
            ) : tasks.map((t) => (
              <div key={t.id} className="row px-5">
                <div>
                  <p className="t-md">{t.name}</p>
                  {t.doneToday && t.doneAt ? (
                    <p className="t-xs prose-muted">
                      {fmt(t.doneAt)} · <Performer name={t.donePerformer} />
                    </p>
                  ) : t.schedule ? (
                    <p className="t-xs prose-muted">{t.schedule}</p>
                  ) : null}
                </div>
                {t.doneToday || offDone.has(t.id) ? (
                  <span className="badge-success">сьогодні ✓</span>
                ) : canWrite ? (
                  <button className="btn-secondary t-sm" disabled={busy === t.id}
                          onClick={() => void markTask(t.id)}>
                    Виконано
                  </button>
                ) : (
                  <span className="badge">не відмічено</span>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <form onSubmit={addTask} className="rise-2 flex gap-2">
              <input className="input" placeholder="Новий пункт чек-листа…"
                     value={newTask} onChange={(e) => setNewTask(e.target.value)} />
              <button className="btn-secondary shrink-0" disabled={!newTask.trim() || busy === 'newtask'}>
                Додати
              </button>
            </form>
          )}
          <p className="field-hint">
            Кожна відмітка — запис журналу з часом і виконавцем. Виправити
            або стерти її неможливо — це і є доказ для перевірки.
          </p>
        </section>
      )}

      {tab === 'solutions' && (
        <section className="flex flex-col gap-4">
          {canWrite && (
          <form onSubmit={addSolution} className="card rise-1 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label">Засіб</label>
              <input required className="input" placeholder="Бланідас-Актив"
                     value={agent} onChange={(e) => setAgent(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Концентрація</label>
              <input required className="input" placeholder="0,5%"
                     value={conc} onChange={(e) => setConc(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Обʼєм, л</label>
              <input required type="number" step="0.1" min="0.1" className="input"
                     value={vol} onChange={(e) => setVol(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Придатний, годин</label>
              <input required type="number" min="1" className="input"
                     value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <button className="btn-primary self-end" disabled={busy === 'solution'}>
              Записати приготування
            </button>
          </form>
          )}

          <div className="card rise-2 !p-0">
            {solutions.length === 0 ? (
              <div className="empty">Журнал порожній</div>
            ) : solutions.map((s) => {
              const active = new Date(s.expires_at) > new Date()
              return (
                <div key={s.id} className="row px-5">
                  <div>
                    <p className="t-md">{s.agent_name} · {s.concentration}</p>
                    <p className="tabular t-xs prose-muted">
                      {Number(s.volume)} {s.unit} · приготовано {fmt(s.prepared_at)}
                      {' · '}<Performer name={s.performer} />
                    </p>
                  </div>
                  <span className={active ? 'badge-success tabular' : 'badge tabular'}>
                    {active ? `до ${fmt(s.expires_at)}` : 'непридатний'}
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
              <label className="field-label">Пристрій</label>
              <input required className="input" value={device}
                     onChange={(e) => setDevice(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Температура, °C</label>
              <input required type="number" min="1" className="input"
                     value={temp} onChange={(e) => setTemp(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Тривалість, хв</label>
              <input required type="number" min="1" className="input"
                     value={mins} onChange={(e) => setMins(e.target.value)} />
            </div>
            <label className="t-md flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={indicator}
                     onChange={(e) => setIndicator(e.target.checked)} />
              Індикатор змінив колір (цикл успішний)
            </label>
            <button className="btn-primary self-end" disabled={busy === 'cycle'}>
              Записати цикл
            </button>
          </form>
          )}

          <div className="card rise-2 !p-0">
            {cycles.length === 0 ? (
              <div className="empty">Циклів поки не записано</div>
            ) : cycles.map((c) => (
              <div key={c.id} className="row px-5">
                <div>
                  <p className="t-md">{c.device}</p>
                  <p className="tabular t-xs prose-muted">
                    {c.temperature_c}°C · {c.duration_minutes} хв · {fmt(c.performed_at)}
                    {' · '}<Performer name={c.performer} />
                  </p>
                </div>
                <span className={c.indicator_ok ? 'badge-success' : 'badge-danger'}>
                  {c.indicator_ok ? 'успішно' : 'провал'}
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
          <p className="field-hint rise">
            Сюди автоматично потрапляє кожна зміна: картки засобів, партії,
            ємності, техкарти, довідники, команда. Записи не можна ні
            виправити, ні стерти — навіть власнику.
          </p>
          <div className="card rise-1 !p-0">
            {audit === null ? (
              <div className="empty">Завантажуємо…</div>
            ) : audit.length === 0 ? (
              <div className="empty">Поки жодної зміни не зафіксовано</div>
            ) : audit.map((a) => (
              <div key={a.id} className="row px-5">
                <div className="min-w-0">
                  <p className="t-md truncate">
                    {ACTION_UA[a.action] ?? a.action}{' '}
                    {ENTITY_UA[a.entity] ?? a.entity}
                    {a.label ? <span className="prose-muted"> · {a.label}</span> : null}
                  </p>
                  <p className="t-xs prose-muted truncate">{a.actor_email ?? 'система'}</p>
                </div>
                <span className="badge tabular shrink-0">{fmt(a.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// Словарики журнала действий. Тригер пишет техническое (insert/update,
// имя таблицы) — человеку показываем человеческое. Неизвестное значение
// выводится как есть: лучше английское слово, чем спрятанная запись.
const ACTION_UA: Record<string, string> = {
  insert: 'Створено',
  update: 'Змінено',
  delete: 'Видалено',
}
const ENTITY_UA: Record<string, string> = {
  materials: 'засіб',
  material_batches: 'партію',
  material_containers: 'ємність',
  material_documents: 'документ',
  material_barcodes: 'штрихкод',
  tech_cards: 'техкарту',
  cleaning_tasks: 'пункт чек-листа',
  customers: 'клієнта',
  offerings: 'позицію каталогу',
  offering_variants: 'варіант позиції',
  variant_materials: 'рецептуру',
  suppliers: 'постачальника',
  storage_locations: 'місце зберігання',
  staff: 'співробітника',
  tenant_members: 'учасника команди',
  tenants: 'налаштування закладу',
}
