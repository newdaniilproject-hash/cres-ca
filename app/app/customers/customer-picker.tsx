'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'

// ── Кто клиент: выбрать из базы или назвать нового ──────────────────────────
//
// Один блок на два экрана — запись из кабинета и ручное заказ, — и живёт он
// в модуле КЛИЕНТОВ, а не в каждом из них: ищет он клиентов, читает карточку
// клиента и решает, попадёт ли документ в уже существующую карточку. Копия
// этого блока в записях и вторая в заказах разъехались бы на первой правке.
//
// ── ПОЧЕМУ КЛЮЧ — ТЕЛЕФОН, А НЕ ВЫБРАННЫЙ id ────────────────────────────────
//
// `create_booking` и `create_order` не принимают `customer_id` вовсе: они
// сами ищут карточку по паре (заведение, телефон) и заводят новую, если
// не нашли (0006, 0105). Значит выбранный в списке человек склеивается со
// своей карточкой ТОЛЬКО через телефон — имя ни на что не влияет. Отсюда
// и подсказка под полем: другой телефон — другая карточка.
//
// Передавать id «в обход» нельзя: это означало бы третий путь заведения
// заказа помимо витрины и этих двух функций, то есть второй источник правды
// о том, чья это покупка.
//
// ── ПОЧЕМУ ТЕЛЕФОН ВЫБРАННОГО ЧИТАЕТСЯ ЧЕРЕЗ `customer_card` ────────────────
//
// Прямое чтение `customers.phone` закрыто (0099): колонка не выдаётся
// `authenticated` вовсе, и ни выбрать её, ни отфильтровать по ней нельзя.
// Единственный путь к контакту — `customer_card`, и он же пишет строку
// в журнал доступа. Это не обход журнала, а ровно то, ради чего он заведён:
// сотрудник действительно посмотрел контакт клиента.
//
// Без права `customers.contacts` функция возвращает телефон В МАСКЕ
// («*******67»). Подставить маску в поле — значит завести карточку
// с телефоном из звёздочек, поэтому маска распознаётся и НЕ подставляется,
// а человеку прямо сказано, почему поле осталось пустым.

export type Contact = {
  /** Имя, которое уедет в `p_contact_name`. */
  name: string
  /** Телефон, которым документ склеивается с карточкой. Пусто — новая карточка. */
  phone: string
  /** Кого выбрали в базе. Нужен только для подписи — в базу он не уходит. */
  pickedId: string | null
}

export const emptyContact: Contact = { name: '', phone: '', pickedId: null }

/**
 * Телефон приводится к виду, в котором его ввёл человек, минус лишние
 * пробелы. Больше НИЧЕГО: витрина (`app/t/[slug]/book/…`) отправляет строку
 * ровно так же, как её набрал покупатель, а `create_booking` ищет карточку
 * ТОЧНЫМ совпадением. Канонизация «+380…» только здесь означала бы, что
 * кабинет перестаёт попадать в карточки, заведённые с витрины, — то есть
 * ровно те дубли, ради которых всё это и делается. Настоящее место для
 * канонической формы — триггер на самой таблице, и это отдельная миграция.
 */
export function normPhone(v: string): string {
  return v.trim().replace(/\s+/g, ' ')
}

type Found = {
  id: string
  name: string
  orders_count: number
  last_order_at: string | null
}

export function CustomerPicker({
  tenantId, value, onChange, disabled,
}: {
  tenantId: string
  value: Contact
  onChange: (c: Contact) => void
  disabled?: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [masked, setMasked] = useState(false)
  const [err, setErr] = useState('')

  // Поиск с задержкой: без неё каждая буква — запрос к базе в Ирландию.
  // Порог в два знака — тот же, что у общего поиска в шапке.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setFound(null); return }
    const id = setTimeout(() => {
      setBusy(true)
      void (async () => {
        // Телефон и почта здесь НЕ запрашиваются — то же решение, что
        // и в списке клиентов: контакт отдаёт `customer_card` с правом
        // и записью в журнал (0090, 0099).
        const { data, error } = await supabase.from('customers')
          .select('id, name, orders_count, last_order_at')
          .eq('tenant_id', tenantId)
          .ilike('name', `%${term}%`)
          .limit(6)
        setBusy(false)
        if (error) { setErr(dbErrorText(t, error)); setFound([]); return }
        setErr('')
        setFound((data ?? []) as Found[])
      })()
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tenantId])

  async function pick(c: Found) {
    setMasked(false)
    setErr('')
    setBusy(true)
    // Карточка — тем же путём, что и на экране клиентов. Второго пути
    // к контакту в продукте нет и заводить его нельзя.
    const { data, error } = await supabase.rpc('customer_card', {
      p_tenant_id: tenantId, p_customer_id: c.id,
    })
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }
    const row = (data as { phone: string | null }[] | null)?.[0]
    const phone = row?.phone ?? ''
    // Маска — это звёздочки вместо цифр. В поле её пускать нельзя:
    // из «*******67» вышла бы новая карточка с телефоном из звёздочек.
    const hidden = phone.includes('*')
    setMasked(hidden)
    onChange({ name: c.name, phone: hidden ? '' : phone, pickedId: c.id })
    setQ('')
    setFound(null)
  }

  function reset() {
    setMasked(false)
    setQ('')
    setFound(null)
    onChange(emptyContact)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">{t('customers.pick.title')}</p>

      {value.pickedId ? (
        <div className="list-card items-center">
          <span aria-hidden className="thumb-sm t-md" style={{ fontWeight: 650 }}>
            {value.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-md block truncate">
              {t('customers.pick.picked', { name: value.name })}
            </span>
          </span>
          <button type="button" className="btn-ghost t-sm shrink-0"
                  style={{ minHeight: 'var(--tap-min)' }}
                  disabled={disabled} onClick={reset}>
            {t('customers.pick.clear')}
          </button>
        </div>
      ) : (
        <div>
          <label className="field-label" htmlFor="cp-search">
            {t('customers.pick.search.label')}
          </label>
          <input id="cp-search" className="input" value={q} disabled={disabled}
                 onChange={(e) => setQ(e.target.value)}
                 placeholder={t('customers.pick.search.placeholder')} />
          {busy && <p className="field-hint">{t('common.saving')}</p>}
          {found !== null && found.length === 0 && !busy && (
            <p className="field-hint">{t('customers.pick.search.empty')}</p>
          )}
          {found !== null && found.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {found.map((c) => (
                // Зона нажатия — `--tap-min`: тем же экраном пользуются
                // с телефона, стоя у кресла.
                <button key={c.id} type="button" className="list-card"
                        style={{ minHeight: 'var(--tap-min)' }}
                        disabled={disabled || busy}
                        onClick={() => void pick(c)}>
                  <span aria-hidden className="thumb-sm t-md" style={{ fontWeight: 650 }}>
                    {c.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    {/* Имя клиента — данные заведения, не переводится. */}
                    <span className="t-md block truncate">{c.name}</span>
                    <span className="tabular t-xs block prose-muted">
                      {c.last_order_at
                        ? t('customers.lastVisit', { date: t.date(c.last_order_at) })
                        : t('customers.noVisits')}
                    </span>
                  </span>
                  <span className="badge-accent tabular shrink-0">
                    {t('customers.ordersCount', { n: Number(c.orders_count) })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="cp-name">
          {t('customers.pick.name.label')}
        </label>
        <input id="cp-name" required className="input" value={value.name} disabled={disabled}
               onChange={(e) => onChange({ ...value, name: e.target.value, pickedId: null })}
               placeholder={t('customers.pick.name.placeholder')} />
      </div>

      <div>
        <label className="field-label" htmlFor="cp-phone">
          {t('customers.pick.phone.label')}
        </label>
        {/* Маска номера — формат поля, а не текст на экране: в словарь
            не уезжает по той же причине, что и `t.inputDay`. */}
        <input id="cp-phone" type="tel" className="input" value={value.phone} disabled={disabled}
               onChange={(e) => onChange({ ...value, phone: e.target.value })}
               placeholder="+380 __ ___ __ __" />
        <p className="field-hint">{t('customers.pick.phone.hint')}</p>
        {masked && <p className="field-hint">{t('customers.pick.masked')}</p>}
      </div>

      {err && <p className="field-error">{err}</p>}
    </div>
  )
}
