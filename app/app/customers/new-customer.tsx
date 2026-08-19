'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useConfirm } from '@/components/confirm'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { normPhone } from './customer-picker'

// ── Клиент заводится вручную ────────────────────────────────────────────────
//
// ПОЧЕМУ ЭТО ПОЯВИЛОСЬ. Прежняя запись здесь и в комментарии экрана гласила:
// «клиента в этом продукте не заводят руками — он появляется сам с первым
// заказом или записью». Это верно для витрины и НЕВЕРНО для салона: клиент
// звонит по телефону, и до этой формы у мастера не было ни одного способа
// записать его — ни клиента, ни записи, ни заказа из кабинета не создавалось
// вовсе. Карточка, заведённая заранее, — это не второй источник клиентов,
// а тот же самый: и запись, и заказ по-прежнему находят её по телефону.
//
// ── ДУБЛИ ───────────────────────────────────────────────────────────────────
//
// Уникального ограничения по паре (заведение, телефон) в базе НЕТ — есть
// только обычный индекс `customers_phone_idx` (0006). Значит поймать дубль
// отказом базы нельзя, а искать его по телефону нельзя тем более: колонка
// закрыта для чтения (0099), и фильтр по ней не пройдёт правами.
//
// Поэтому сторож здесь — ИМЯ: перед вставкой ищем однофамильцев и, если они
// есть, показываем их человеку и спрашиваем ещё раз. Это слабее ограничения
// базы и названо так прямо: настоящая защита от дубля — уникальный индекс
// по телефону плюс канонизация номера триггером, и это отдельная миграция,
// а не строка в этом файле.
//
// Отказ `23505` при этом всё равно разбирается (`dbErrorText` знает этот код):
// в день, когда такой индекс появится, форма скажет человеку «такий запис
// уже є», а не покажет ему текст Postgres с чужим телефоном внутри.

export function NewCustomerSheet({
  tenantId, open, onClose,
}: {
  tenantId: string
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  const router = useRouter()
  const confirm = useConfirm()
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function close() {
    setName(''); setPhone(''); setEmail(''); setNote('')
    setErr('')
    onClose()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const clean = name.trim()
    if (!clean || busy) return
    setErr('')

    // Сначала однофамильцы. Телефон в этот запрос не попадает и попасть
    // не может (0099) — ищем только по имени.
    setBusy(true)
    const { data: same, error: findErr } = await supabase.from('customers')
      .select('id, name, orders_count, last_order_at')
      .eq('tenant_id', tenantId)
      .ilike('name', clean)
      .limit(5)
    setBusy(false)
    if (findErr) { setErr(dbErrorText(t, findErr)); return }

    if ((same ?? []).length > 0) {
      const ok = await confirm({
        title: t('customers.add.dup.title'),
        body: (
          <div className="flex flex-col gap-2">
            <p className="t-md">
              {t('customers.add.dup.body', { n: (same ?? []).length })}
            </p>
            {(same ?? []).map((c) => (
              <div key={c.id as string} className="list-card">
                <span className="min-w-0 flex-1 text-left">
                  {/* Имя клиента — данные заведения, не переводится. */}
                  <span className="t-md block truncate">{c.name as string}</span>
                  <span className="tabular t-xs block prose-muted">
                    {c.last_order_at
                      ? t('customers.lastVisit', { date: t.date(c.last_order_at as string) })
                      : t('customers.noVisits')}
                  </span>
                </span>
                <span className="badge-accent tabular shrink-0">
                  {t('customers.ordersCount', { n: Number(c.orders_count) })}
                </span>
              </div>
            ))}
          </div>
        ),
        action: t('customers.add.dup.go'),
      })
      if (!ok) return
    }

    setBusy(true)
    // Вставка прямая: политика `customers_insert` (0006) стоит на праве
    // `customers.write`, и обходить её функцией с правами владельца было бы
    // ровно тем «быстрым путём мимо проверок», который запрещён правилом 2.
    // `.select()` не зовём намеренно: он потребовал бы чтения колонок,
    // часть которых закрыта (0099), и вставка падала бы на ответе.
    const { error } = await supabase.from('customers').insert({
      tenant_id: tenantId,
      name: clean,
      phone: normPhone(phone) || null,
      email: email.trim() || null,
      note: note.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }

    toast.success(t('customers.add.done', { name: clean }))
    close()
    router.refresh()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title={t('customers.add.title')}
        // Кнопка — в подвале шторки, а не в конце формы: с открытой
        // клавиатурой конец формы уезжает под неё. `form=` связывает
        // кнопку с формой, не перенося разметку.
        footer={(
          <button type="submit" form="new-customer" className="btn-primary w-full"
                  disabled={busy || !name.trim()}>
            {busy ? t('common.saving') : t('customers.add.submit')}
          </button>
        )}
      >
        <form id="new-customer" onSubmit={submit} className="flex flex-col gap-4 pb-2">
          <div>
            <label className="field-label" htmlFor="nc-name">
              {t('customers.add.name.label')}
            </label>
            <input id="nc-name" required className="input" value={name}
                   onChange={(e) => setName(e.target.value)}
                   placeholder={t('customers.add.name.placeholder')} />
          </div>
          <div>
            <label className="field-label" htmlFor="nc-phone">
              {t('customers.add.phone.label')}
            </label>
            {/* Маска номера — формат поля, а не строка интерфейса. */}
            <input id="nc-phone" type="tel" className="input" value={phone}
                   onChange={(e) => setPhone(e.target.value)}
                   placeholder="+380 __ ___ __ __" />
            <p className="field-hint">{t('customers.add.hint')}</p>
          </div>
          <div>
            <label className="field-label" htmlFor="nc-email">
              {t('customers.add.email.label')}
            </label>
            <input id="nc-email" type="email" className="input" value={email}
                   onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="nc-note">
              {t('customers.add.note.label')}
            </label>
            <textarea id="nc-note" className="textarea" rows={3} value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('customers.add.note.placeholder')} />
          </div>

          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>
      {/* Подтверждение дубля — своей шторкой поверх этой. */}
      {confirm.element}
    </>
  )
}
