'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'
import { parseRange, lastDay, isNow } from '../range'
import { dbErrorText } from '@/lib/errors/db'

type Staff = {
  id: string; name: string; title: string | null; bio: string | null
  timezone: string; isActive: boolean; linked: boolean
  blockedAt: string | null; blockedReason: string | null
}
type Hour = { id: string; weekday: number; from: string; to: string }
type Off = { id: string; kind: string; period: string; note: string | null }
type Service = { id: string; title: string }

// Дни недели в порядке рабочей недели, а не в порядке значений колонки.
// В базе `weekday` — это `extract(dow)`, где 0 — ВОСКРЕСЕНЬЕ (0010).
// Показывать в этом порядке нельзя: неделя, начинающаяся с воскресенья,
// в Украине читается как ошибка. Порядок отображения и значение в базе
// разведены здесь и больше нигде.
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const
type Weekday = (typeof WEEK)[number]

const KINDS = ['vacation', 'sick', 'break', 'other'] as const
type OffKind = (typeof KINDS)[number]
const isKind = (v: string): v is OffKind => (KINDS as readonly string[]).includes(v)

// Часовые пояса списком, а не свободным полем: `available_slots`
// разворачивает рабочие часы именно в нём (`at time zone s.timezone`),
// и опечатка в названии зоны означала бы, что слоты не считаются вовсе.
// Список короткий и покрывает продавца в Украине и уехавшего мастера;
// незнакомое значение из базы добавляется к списку, чтобы правка
// карточки его не стирала.
const ZONES = [
  'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Prague',
  'Europe/Lisbon', 'Europe/London', 'Europe/Chisinau', 'Asia/Tbilisi',
]

export function StaffCard({
  tenantId, canEditCard, canSchedule, staff, hours, off, services, mine,
}: {
  tenantId: string
  canEditCard: boolean
  canSchedule: boolean
  staff: Staff
  hours: Hour[]
  off: Off[]
  services: Service[]
  mine: string[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(false)
  const [addOff, setAddOff] = useState(false)
  const [dayForm, setDayForm] = useState<Weekday | null>(null)

  const blocked = staff.blockedAt !== null
  const zones = ZONES.includes(staff.timezone) ? ZONES : [staff.timezone, ...ZONES]

  async function run(fn: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true); setErr('')
    const { error } = await fn()
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return false }
    router.refresh()
    return true
  }

  // ── Принимает записи ──────────────────────────────────────────────
  // Отдельная колонка, а не «блокировка»: доступ в кабинет она не
  // трогает. Мастер в отпуске продолжает смотреть свой склад.
  const toggleActive = () =>
    run(async () => await supabase.from('staff')
      .update({ is_active: !staff.isActive })
      .eq('tenant_id', tenantId).eq('id', staff.id))

  const addHour = async (weekday: Weekday, from: string, to: string) => {
    const ok = await run(async () => await supabase.from('working_hours')
      .insert({ tenant_id: tenantId, staff_id: staff.id, weekday, starts_at: from, ends_at: to }))
    if (ok) setDayForm(null)
  }

  const dropHour = (id: string) =>
    run(async () => await supabase.from('working_hours')
      .delete().eq('tenant_id', tenantId).eq('id', id))

  const dropOff = (id: string) =>
    run(async () => await supabase.from('time_off')
      .delete().eq('tenant_id', tenantId).eq('id', id))

  const toggleService = (id: string, on: boolean) =>
    run(async () => on
      ? await supabase.from('staff_services')
          .insert({ tenant_id: tenantId, staff_id: staff.id, offering_id: id })
      : await supabase.from('staff_services')
          .delete().eq('tenant_id', tenantId).eq('staff_id', staff.id).eq('offering_id', id))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Ни своего `h1`, ни своей стрелки «назад»: и то, и другое рисует
            оболочка (`HEADINGS` + `backOf`). Имя мастера показываем строкой
            выше должности — заголовок экрана называет РАЗДЕЛ, а не человека. */}
        <div className="min-w-0">
          <p className="display t-lg truncate">{staff.name}</p>
          <p className="t-sm prose-muted">{staff.title || t('staff.card.noTitle')}</p>
        </div>
        {canEditCard && (
          <button className="btn-secondary" onClick={() => setEdit(true)}>
            {t('staff.card.edit')}
          </button>
        )}
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {/* ── Доступ погашен вместе с карточкой ─────────────────────── */}
      {blocked && (
        <section className="card rise">
          <p className="badge-danger mb-2 inline-block">{t('staff.state.blocked')}</p>
          <p className="t-sm">{t('staff.blocked.hint')}</p>
          {staff.blockedReason && (
            <p className="t-sm mt-1 prose-muted">{staff.blockedReason}</p>
          )}
          {/* Кнопки «розблокувати» здесь нет намеренно: блокировку ставят
              и снимают только `block_member`/`unblock_member` — они пишут
              в неизменяемый журнал прав и рвут сеансы. Второй путь сюда
              означал бы неполный журнал, и обнаружилось бы это в день
              разбирательства. */}
          <Link href="/app/team" className="btn-secondary mt-3 inline-flex">
            {t('staff.blocked.toTeam')}
          </Link>
        </section>
      )}

      {/* ── Принимает ли записи ───────────────────────────────────── */}
      <section className="card rise">
        <label className="t-md flex items-center gap-3">
          <input type="checkbox" checked={staff.isActive && !blocked}
                 disabled={!canEditCard || blocked || busy}
                 onChange={() => void toggleActive()} />
          <span>
            {t('staff.active.label')}
            <span className="field-hint block">
              {blocked ? t('staff.active.blockedHint')
                : staff.isActive ? t('staff.active.onHint')
                : t('staff.active.offHint')}
            </span>
          </span>
        </label>
        {!staff.linked && (
          <p className="field-hint mt-3">{t('staff.card.unlinkedHint')}</p>
        )}
      </section>

      {/* ── Рабочая неделя ────────────────────────────────────────── */}
      <section className="rise-2">
        <h2 className="t-sm mb-2 prose-muted">{t('staff.hours.title')}</h2>
        <div className="card !p-0">
          {WEEK.map((d) => {
            const list = hours.filter((h) => h.weekday === d)
            return (
              <div key={d} className="row flex-wrap px-5">
                <span className="t-md w-28 shrink-0">{t(`staff.weekday.${d}`)}</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {list.length === 0 && (
                    <span className="t-sm prose-muted">{t('staff.hours.dayOff')}</span>
                  )}
                  {list.map((h) => (
                    <span key={h.id} className="chip tabular">
                      {h.from}—{h.to}
                      {canSchedule && (
                        <button className="btn-icon ml-1" disabled={busy}
                                aria-label={t('staff.hours.remove')}
                                onClick={() => void dropHour(h.id)}>×</button>
                      )}
                    </span>
                  ))}
                  {canSchedule && dayForm !== d && (
                    <button className="btn-ghost t-sm" onClick={() => setDayForm(d)}>
                      {t('staff.hours.add')}
                    </button>
                  )}
                </div>
                {dayForm === d && (
                  <HourForm busy={busy}
                            onCancel={() => setDayForm(null)}
                            onSave={(from, to) => void addHour(d, from, to)} />
                )}
              </div>
            )
          })}
        </div>
        <p className="field-hint">{t('staff.hours.hint')}</p>
      </section>

      {/* ── Отпуска и перерывы ────────────────────────────────────── */}
      <section className="rise-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="t-sm prose-muted">{t('staff.off.title')}</h2>
          {canSchedule && (
            <button className="btn-secondary t-sm" onClick={() => setAddOff(true)}>
              {t('staff.off.add')}
            </button>
          )}
        </div>
        {off.length === 0 ? (
          <div className="card">
            <p className="t-sm prose-muted">{t('staff.off.empty')}</p>
          </div>
        ) : (
          <div className="card !p-0">
            {off.map((o) => {
              const r = parseRange(o.period)
              return (
                <div key={o.id} className="row px-5">
                  <div className="min-w-0">
                    <p className="t-md">
                      {t.date(r.from)} — {t.date(lastDay(r.to))}
                      {isNow(r) && <span className="badge-warn ml-2">{t('staff.off.now')}</span>}
                    </p>
                    <p className="t-xs truncate prose-muted">
                      {isKind(o.kind) ? t(`staff.off.kind.${o.kind}`) : o.kind}
                      {o.note && ` · ${o.note}`}
                    </p>
                  </div>
                  {canSchedule && (
                    <button className="btn-ghost t-sm shrink-0" disabled={busy}
                            onClick={() => void dropOff(o.id)}>
                      {t('staff.off.remove')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Услуги мастера ────────────────────────────────────────── */}
      <section className="rise-4">
        <h2 className="t-sm mb-2 prose-muted">{t('staff.services.title')}</h2>
        <div className="card">
          {services.length === 0 ? (
            <p className="t-sm prose-muted">{t('staff.services.none')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {services.map((s) => (
                <label key={s.id} className="t-md flex items-center gap-2">
                  <input type="checkbox" className="shrink-0"
                         checked={mine.includes(s.id)}
                         disabled={!canEditCard || busy}
                         onChange={(e) => void toggleService(s.id, e.target.checked)} />
                  {s.title}
                </label>
              ))}
            </div>
          )}
          {/* Самое важное предложение на экране: пустой список значит
              «всі послуги», и это поведение базы, а не недоделка. */}
          <p className="field-hint mt-3">
            {mine.length === 0 ? t('staff.services.allHint') : t('staff.services.someHint')}
          </p>
        </div>
      </section>

      {/* ── Правка карточки ───────────────────────────────────────── */}
      <Sheet open={edit} onClose={() => setEdit(false)} title={t('staff.edit.title')}>
        <CardForm staff={staff} zones={zones} busy={busy}
                  onSave={async (f) => {
                    const ok = await run(async () => await supabase.from('staff')
                      .update({
                        name: f.name.trim(), title: f.title.trim() || null,
                        bio: f.bio.trim() || null, timezone: f.timezone,
                      })
                      .eq('tenant_id', tenantId).eq('id', staff.id))
                    if (ok) setEdit(false)
                  }} />
      </Sheet>

      {/* ── Новый отпуск ──────────────────────────────────────────── */}
      <Sheet open={addOff} onClose={() => setAddOff(false)} title={t('staff.off.sheet')}>
        <OffForm busy={busy} timezone={staff.timezone}
                 onSave={async (f) => {
                   const ok = await run(async () => await supabase.rpc('add_time_off', {
                     p_tenant_id: tenantId, p_staff_id: staff.id,
                     p_kind: f.kind, p_from: f.from, p_to: f.to,
                     p_note: f.note.trim() || null,
                   }))
                   if (ok) setAddOff(false)
                 }} />
      </Sheet>
    </div>
  )
}

// Промежуток дня. Отдельной формой, потому что их у одного дня бывает
// несколько (утро и вечер вокруг обеда), и открывается она в той строке,
// куда добавляют, — а не общим окном, где ещё надо выбрать день.
function HourForm({
  busy, onSave, onCancel,
}: {
  busy: boolean
  onSave: (from: string, to: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('18:00')
  return (
    <form className="mt-2 flex w-full flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); onSave(from, to) }}>
      <div>
        <label className="field-label">{t('staff.hours.from')}</label>
        <input type="time" required className="input" value={from}
               onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('staff.hours.to')}</label>
        <input type="time" required className="input" value={to}
               onChange={(e) => setTo(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={busy || to <= from}>
        {t('common.save')}
      </button>
      <button type="button" className="btn-ghost" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </form>
  )
}

function CardForm({
  staff, zones, busy, onSave,
}: {
  staff: Staff
  zones: string[]
  busy: boolean
  onSave: (f: { name: string; title: string; bio: string; timezone: string }) => void
}) {
  const t = useT()
  const [name, setName] = useState(staff.name)
  const [title, setTitle] = useState(staff.title ?? '')
  const [bio, setBio] = useState(staff.bio ?? '')
  const [timezone, setTimezone] = useState(staff.timezone)
  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave({ name, title, bio, timezone }) }}>
      <div>
        <label className="field-label">{t('staff.form.name.label')}</label>
        <input required className="input" value={name}
               onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('staff.form.title.label')}</label>
        <input className="input" value={title}
               placeholder={t('staff.form.title.placeholder')}
               onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('staff.form.bio.label')}</label>
        <textarea className="textarea" rows={3} value={bio}
                  placeholder={t('staff.form.bio.placeholder')}
                  onChange={(e) => setBio(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('staff.form.zone.label')}</label>
        <select className="select" value={timezone}
                onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <p className="field-hint">{t('staff.form.zone.hint')}</p>
      </div>
      <button className="btn-primary" disabled={busy || !name.trim()}>
        {t('common.save')}
      </button>
    </form>
  )
}

// Отпуск задаётся ДНЯМИ, а моменты времени считает база (`add_time_off`,
// 0101) в часовом поясе мастера. Здесь поэтому нет ни одного пересчёта
// времени: браузер администратора может стоять в другом поясе, и его
// полночь — не полночь мастера.
function OffForm({
  busy, timezone, onSave,
}: {
  busy: boolean
  timezone: string
  onSave: (f: { kind: OffKind; from: string; to: string; note: string }) => void
}) {
  const t = useT()
  const [kind, setKind] = useState<OffKind>('vacation')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  return (
    <form className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); onSave({ kind, from, to, note }) }}>
      <div className="sm:col-span-2">
        <label className="field-label">{t('staff.off.kind.label')}</label>
        <select className="select" value={kind}
                onChange={(e) => setKind(e.target.value as OffKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`staff.off.kind.${k}`)}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label">{t('staff.off.from')}</label>
        <input type="date" required className="input" value={from}
               max={to || undefined}
               onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('staff.off.to')}</label>
        <input type="date" required className="input" value={to}
               min={from || undefined}
               onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className="field-label">{t('staff.off.note')}</label>
        <input className="input" value={note}
               placeholder={t('staff.off.notePlaceholder')}
               onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="btn-primary sm:col-span-2" disabled={busy || !from || !to}>
        {t('staff.off.submit')}
      </button>
      <p className="field-hint sm:col-span-2">
        {t('staff.off.hint', { zone: timezone })}
      </p>
    </form>
  )
}
