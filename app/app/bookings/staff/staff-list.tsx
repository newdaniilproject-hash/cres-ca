'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'

export type StaffRow = {
  id: string
  name: string
  title: string | null
  isActive: boolean
  blocked: boolean
  linked: boolean
  hasHours: boolean
  onLeave: boolean
}

// Список мастеров. Состояние каждого — это ТРИ разных признака, и они
// не сводятся в один, потому что снимаются в разных местах:
//
//   blocked   — карточка погашена вместе с доступом в кабинет. Правится
//               только через раздел «Команда» (block_member/unblock_member),
//               здесь показывается и объясняется, но не переключается:
//               своя кнопка означала бы второй путь мимо журнала прав.
//   !isActive — «не приймає записи»: отпуск, больничный. Это обычная
//               колонка карточки, и вот её как раз переключают здесь.
//   !hasHours — расписания нет вовсе. Формально мастер «работает», а
//               `available_slots` для него не вернёт ни одного слота:
//               окон нет — значит и записаться нельзя. Молчаливая пустота
//               дороже отказа, поэтому она названа прямо в списке.
export function StaffList({
  tenantId, canWrite, staff,
}: {
  tenantId: string
  canWrite: boolean
  staff: StaffRow[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [add, setAdd] = useState(false)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('staff')
      .insert({ tenant_id: tenantId, name: name.trim(), title: title.trim() || null })
      .select('id').single()
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }
    setAdd(false); setName(''); setTitle('')
    // Сразу в карточку: без расписания мастер всё равно невидим для
    // записи, и следующий шаг здесь ровно один.
    router.push(`/app/bookings/staff/${data.id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовка экрана здесь НЕТ намеренно: его рисует оболочка
          из `HEADINGS` (`components/app-shell.tsx`). Свой `h1` давал
          «Майстри» дважды подряд — найдено по снимку экрана 18.08.2026.
          Заголовок — часть НАВИГАЦИИ, а не страницы: он отвечает
          на вопрос «где я», и второй источник правды тут не нужен. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-sm prose-muted">{t('staff.list.desc')}</p>
        {canWrite && (
          <button className="btn-primary" onClick={() => setAdd(true)}>
            {t('staff.list.add')}
          </button>
        )}
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {staff.length === 0 ? (
        <div className="empty card rise">
          <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
            {t('staff.empty.title')}
          </p>
          <p>{t('staff.empty.desc')}</p>
        </div>
      ) : (
        <div className="card !p-0 rise">
          {staff.map((s) => (
            <Link key={s.id} href={`/app/bookings/staff/${s.id}`} className="row px-5">
              <div className="flex min-w-0 items-center gap-3">
                {/* Инициал вместо фотографии: аватары карточка пока
                    не заводит, а пустой кружок читается как «фото
                    не загрузилось». */}
                <span className="badge shrink-0" aria-hidden>
                  {s.name.trim().slice(0, 1).toUpperCase() || '—'}
                </span>
                <div className="min-w-0">
                  <p className="t-md truncate">{s.name}</p>
                  <p className="t-xs truncate prose-muted">
                    {s.title || t('staff.card.noTitle')}
                    {!s.linked && ` · ${t('staff.state.unlinked')}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {s.blocked && <span className="badge-danger">{t('staff.state.blocked')}</span>}
                {!s.blocked && s.onLeave && <span className="badge-warn">{t('staff.state.onLeave')}</span>}
                {!s.blocked && !s.onLeave && !s.isActive
                  && <span className="badge">{t('staff.state.notBooking')}</span>}
                {!s.blocked && s.isActive && !s.hasHours
                  && <span className="badge-warn">{t('staff.state.noHours')}</span>}
                {!s.blocked && s.isActive && s.hasHours && !s.onLeave
                  && <span className="badge-success">{t('staff.state.working')}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Sheet open={add} onClose={() => setAdd(false)} title={t('staff.add.title')}>
        <form className="grid gap-3" onSubmit={create}>
          <div>
            <label className="field-label">{t('staff.form.name.label')}</label>
            <input required autoFocus className="input" value={name}
                   placeholder={t('staff.form.name.placeholder')}
                   onChange={(e) => setName(e.target.value)} />
            <p className="field-hint">{t('staff.form.name.hint')}</p>
          </div>
          <div>
            <label className="field-label">{t('staff.form.title.label')}</label>
            <input className="input" value={title}
                   placeholder={t('staff.form.title.placeholder')}
                   onChange={(e) => setTitle(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {t('staff.add.submit')}
          </button>
          <p className="field-hint">{t('staff.add.hint')}</p>
        </form>
      </Sheet>
    </div>
  )
}
