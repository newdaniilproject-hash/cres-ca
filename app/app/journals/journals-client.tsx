'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Solution = {
  id: string; agent_name: string; concentration: string
  volume: number; unit: string; prepared_at: string; expires_at: string
}
type Task = { id: string; name: string; schedule: string | null; doneToday: boolean }
type Cycle = {
  id: string; device: string; temperature_c: number
  duration_minutes: number; indicator_ok: boolean; performed_at: string
}

// Три журнала одним экраном. Каждая запись — одно касание или одна
// короткая форма: заполнять их будут между клиентами, стоя.
export function JournalsClient({
  tenantId, userId, solutions, tasks, cycles,
}: {
  tenantId: string; userId: string
  solutions: Solution[]; tasks: Task[]; cycles: Cycle[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [tab, setTab] = useState<'cleaning' | 'solutions' | 'sterilization'>('cleaning')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // формы
  const [agent, setAgent] = useState(''); const [conc, setConc] = useState('')
  const [vol, setVol] = useState(''); const [hours, setHours] = useState('24')
  const [device, setDevice] = useState('сухожарова шафа')
  const [temp, setTemp] = useState('180'); const [mins, setMins] = useState('60')
  const [indicator, setIndicator] = useState(true)
  const [newTask, setNewTask] = useState('')

  async function markTask(taskId: string) {
    setBusy(taskId); setErr('')
    const { error } = await supabase.from('cleaning_entries').insert({
      tenant_id: tenantId, task_id: taskId, performed_by: userId,
    })
    setBusy(null)
    if (error) { setErr(error.message); return }
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
    const { error } = await supabase.from('sanitation_solutions').insert({
      tenant_id: tenantId, agent_name: agent, concentration: conc,
      volume: Number(vol), prepared_by: userId,
      expires_at: new Date(Date.now() + Number(hours) * 36e5).toISOString(),
    })
    setBusy(null)
    if (error) { setErr(error.message); return }
    setAgent(''); setConc(''); setVol(''); router.refresh()
  }

  async function addCycle(e: React.FormEvent) {
    e.preventDefault()
    setBusy('cycle'); setErr('')
    const { error } = await supabase.from('sterilization_cycles').insert({
      tenant_id: tenantId, device, temperature_c: Number(temp),
      duration_minutes: Number(mins), indicator_ok: indicator, performed_by: userId,
    })
    setBusy(null)
    if (error) { setErr(error.message); return }
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <a href="/app/journals/report" target="_blank" rel="noreferrer"
           className="btn-primary h-9 t-sm">
          Звіт для перевірки → PDF
        </a>
        <span className="w-full sm:w-px" />
        <button onClick={() => setTab('cleaning')}
                className={tab === 'cleaning' ? 'chip-active' : 'chip'}>Прибирання</button>
        <button onClick={() => setTab('solutions')}
                className={tab === 'solutions' ? 'chip-active' : 'chip'}>Дезрозчини</button>
        <button onClick={() => setTab('sterilization')}
                className={tab === 'sterilization' ? 'chip-active' : 'chip'}>Стерилізація</button>
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {tab === 'cleaning' && (
        <section className="flex flex-col gap-4">
          <div className="card rise-1 !p-0">
            {tasks.length === 0 ? (
              <div className="empty">Додайте пункти чек-листа нижче — «Кварцування», «Обробка крісла»…</div>
            ) : tasks.map((t) => (
              <div key={t.id} className="row px-5">
                <div>
                  <p className="t-md">{t.name}</p>
                  {t.schedule && <p className="t-xs prose-muted">{t.schedule}</p>}
                </div>
                {t.doneToday ? (
                  <span className="badge-success">сьогодні ✓</span>
                ) : (
                  <button className="btn-secondary h-9 t-sm" disabled={busy === t.id}
                          onClick={() => void markTask(t.id)}>
                    Виконано
                  </button>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={addTask} className="rise-2 flex gap-2">
            <input className="input" placeholder="Новий пункт чек-листа…"
                   value={newTask} onChange={(e) => setNewTask(e.target.value)} />
            <button className="btn-secondary shrink-0" disabled={!newTask.trim() || busy === 'newtask'}>
              Додати
            </button>
          </form>
          <p className="field-hint">
            Кожна відмітка — запис журналу з часом і виконавцем. Виправити
            або стерти її неможливо — це і є доказ для перевірки.
          </p>
        </section>
      )}

      {tab === 'solutions' && (
        <section className="flex flex-col gap-4">
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

          <div className="card rise-2 !p-0">
            {cycles.length === 0 ? (
              <div className="empty">Циклів поки не записано</div>
            ) : cycles.map((c) => (
              <div key={c.id} className="row px-5">
                <div>
                  <p className="t-md">{c.device}</p>
                  <p className="tabular t-xs prose-muted">
                    {c.temperature_c}°C · {c.duration_minutes} хв · {fmt(c.performed_at)}
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
    </div>
  )
}
