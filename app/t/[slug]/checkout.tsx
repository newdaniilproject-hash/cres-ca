'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { guardOrder } from '@/lib/ratelimit/guard'
import { readAttribution } from '@/lib/attribution'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { IconClose, IconMinus, IconPlus } from '@/components/icons'
import type { CartLine } from './cart'

// ── ОФОРМЛЕННЯ ЗАМОВЛЕННЯ ───────────────────────────────────────────────────
//
// Форма гостя: никакой регистрации. `create_order` — одна из восьми точек,
// открытых анониму (правило 7), и заказ без аккаунта это не послабление,
// а основной сценарий: человек пришёл из шапки Instagram и уходить
// регистрироваться не станет.
//
// Приёмы взяты у существующего потока записи (`book/[offering]/booking-flow`),
// а не изобретены заново: предел частоты спрашивается у своего сервера ДО
// вызова базы, атрибуция читается тем же `readAttribution`, отказ базы
// показывается одним разбором `dbErrorText`. Второй способ делать то же
// самое — это второй источник правды, который разъедется с первым.

// Телефон — ровно девять цифр после «+380», а префикс не поле ввода,
// а подпись слева. Это ТОТ ЖЕ приём, что в `app/m/register/register-form.tsx`,
// вместе с его доводом: человек не должен стирать префикс, а мы не должны
// разбирать, что он там написал — «+380», «380», «0» или «0 (50)».
function formatPhone(digits: string) {
  const d = digits.slice(0, 9)
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ')
}

type Delivery = 'pickup' | 'np'

export function CheckoutSheet({
  open, onClose, tenantId, lines, setQty, remove, clear,
}: {
  open: boolean
  onClose: () => void
  tenantId: string
  lines: CartLine[]
  setQty: (variantId: string, qty: number) => void
  remove: (variantId: string) => void
  clear: () => void
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')       // только цифры, без +380
  const [email, setEmail] = useState('')
  const [delivery, setDelivery] = useState<Delivery>('np')
  const [city, setCity] = useState('')
  const [branch, setBranch] = useState('')
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')
  const [done, setDone] = useState<number | null>(null)

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)
  const currency = lines[0]?.currency

  // Проверки перед отправкой. Каждая повторена в базе (`create_order`
  // требует имя и хотя бы одну строку) — здесь они стоят не вместо неё,
  // а чтобы человек узнал о пропущенном поле до обращения к серверу.
  const ready =
    lines.length > 0 &&
    name.trim().length > 0 &&
    phone.length === 9 &&
    (delivery === 'pickup' || (city.trim().length > 0 && branch.trim().length > 0))

  function close() {
    onClose()
    // Успех сбрасывается ТОЛЬКО при закрытии: пока номер на экране,
    // повторно открытая шторка обязана показывать его же, а не пустую форму.
    if (done != null) {
      setDone(null)
      setState('idle')
      setError('')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || state === 'sending') return
    setState('sending')
    setError('')

    // Предел частоты: 10 заказов в час с адреса (0087). Спрашиваем свой
    // сервер до `create_order`, потому что сам вызов уходит из браузера
    // прямо в Supabase и мимо нас не проходит. Ограничение НАШЕЙ ФОРМЫ;
    // настоящий предел стоит внутри самой функции базы.
    const gate = await guardOrder()
    if (!gate.ok) { setState('error'); setError(dbErrorText(t, gate)); return }

    // Атрибуция (0105): то, что запомнил `AttributionCapture` при переходе
    // по `?from=ig`. Нет перехода — три поля просто null, и оформление
    // это не смущает.
    const attr = readAttribution(tenantId)

    // Способ доставки уходит В БАЗУ ТЕКСТОМ, а не кодом, и это осознанно:
    // `orders.delivery_method` — свободная строка без справочника, а
    // единственный её читатель (карточка заказа в кабинете) печатает
    // значение как есть. Код вроде `nova_poshta` продавец увидел бы
    // ровно так, кодом; завести словарь кодов — это правка соседнего
    // модуля «Замовлення», то есть отдельно названное изменение.
    const parcel = delivery === 'np'
      ? {
          method: t('public.checkout.delivery.np'),
          city: city.trim(),
          branch: branch.trim(),
        }
      : { method: t('public.checkout.delivery.pickup') }

    const { data, error: dbError } = await supabase.rpc('create_order', {
      p_tenant_id: tenantId,
      // Цена и название сюда НЕ передаются — их берёт из базы сама функция.
      // Присланная клиентом цена была бы ценой, назначенной покупателем.
      p_items: lines.map((l) => ({ variant_id: l.id, quantity: l.qty })),
      p_contact_name: name.trim(),
      p_contact_phone: `+380${phone}`,
      p_contact_email: email.trim() || null,
      p_delivery: parcel,
      p_comment: comment.trim() || null,
      p_attribution_source: attr?.source ?? null,
      p_attribution_label: attr?.label ?? null,
      p_attribution_at: attr?.at ?? null,
    })

    if (dbError) { setState('error'); setError(dbErrorText(t, dbError)); return }

    const order = data as { number: number } | null
    setDone(order?.number ?? 0)
    setState('idle')
    clear()
  }

  if (done != null) {
    return (
      <Sheet open={open} onClose={close} title={t('public.checkout.done.title')}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center t-2xl"
            style={{
              borderRadius: '50%',
              background: 'var(--color-success-soft)',
              color: 'var(--color-success)',
            }}
          >
            ✓
          </div>
          {/* Номер подставляется строкой, а не `t.number`: это номер
              документа, разделитель разрядов сделал бы из №1024 «№1 024». */}
          <p className="display t-xl tabular">
            {t('public.checkout.done.number', { n: String(done) })}
          </p>
          <p className="t-md prose-muted">{t('public.checkout.done.desc')}</p>
          <p className="t-xs prose-muted">{t('public.checkout.done.keep')}</p>
          <button type="button" className="btn-secondary mt-2" onClick={close}>
            {t('public.checkout.done.close')}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('public.cart.title')}
      footer={
        <button
          type="submit"
          form="checkout-form"
          className="btn-primary w-full"
          disabled={!ready || state === 'sending'}
        >
          {state === 'sending'
            ? t('public.checkout.submit.sending')
            : t('public.checkout.submit')}
        </button>
      }
    >
      {lines.length === 0 ? (
        <div className="empty card-flat !py-8">{t('public.cart.empty')}</div>
      ) : (
        <form id="checkout-form" onSubmit={submit} className="flex flex-col gap-5">
          {/* Позиции: количество меняется и удаляется прямо здесь — уходить
              за этим обратно на витрину человек не должен. */}
          <div className="card !p-0">
            {lines.map((l) => {
              const atMax = l.available != null && l.qty >= l.available
              return (
                <div key={l.id} className="row px-4">
                  <div className="min-w-0">
                    <p className="t-md truncate">{l.title}</p>
                    <p className="t-sm prose-muted truncate">
                      {l.name} · {t.money(l.price, l.currency)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={t('public.cart.qty.minus.aria')}
                      onClick={() => setQty(l.id, l.qty - 1)}
                    >
                      <IconMinus />
                    </button>
                    <span className="tabular t-md" style={{ minWidth: 24, textAlign: 'center' }}>
                      {t.number(l.qty)}
                    </span>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={t('public.cart.qty.plus.aria')}
                      disabled={atMax}
                      onClick={() => setQty(l.id, l.qty + 1)}
                    >
                      <IconPlus />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={t('public.cart.remove.aria')}
                      onClick={() => remove(l.id)}
                    >
                      <IconClose />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between">
            <span className="t-md">{t('public.checkout.total')}</span>
            <span className="tabular t-xl">{t.money(total, currency)}</span>
          </div>

          <div>
            <label className="field-label" htmlFor="co-name">
              {t('public.book.name.label')}
            </label>
            <input
              id="co-name" required autoComplete="name" className="input"
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('public.book.name.placeholder')}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="co-phone">
              {t('public.book.phone.label')}
            </label>
            <div className="input flex items-center gap-2" style={{ paddingRight: 0 }}>
              <span className="tabular shrink-0" style={{ fontSize: 16, color: 'var(--color-muted)' }}>
                +380
              </span>
              <input
                id="co-phone" required type="tel" inputMode="numeric" autoComplete="tel-national"
                className="tabular min-w-0 flex-1"
                style={{
                  fontSize: 16, border: 0, background: 'transparent',
                  outline: 'none', color: 'var(--color-text)', letterSpacing: '0.02em',
                }}
                value={formatPhone(phone)}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder={t('m.register.phone.placeholder')}
              />
            </div>
            {phone.length > 0 && phone.length < 9
              ? <p className="field-hint">{t.plural('m.register.phone.more', 9 - phone.length)}</p>
              : <p className="field-hint">{t('public.checkout.phone.hint')}</p>}
          </div>

          <div>
            <label className="field-label" htmlFor="co-email">
              {t('public.checkout.email.label')}
            </label>
            <input
              id="co-email" type="email" autoComplete="email" className="input"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t('public.checkout.email.placeholder')}
            />
            <p className="field-hint">{t('public.checkout.email.hint')}</p>
          </div>

          {/* Способ доставки. Выбор ровно из двух, и оба честные: расчёта
              стоимости и вызовов API Нової Пошти в продукте нет (таблица
              `shipments` и хранилище ключей есть, вызовов нет), поэтому
              город и отделение — это то, что продавец перепишет в накладную
              руками, а не то, что мы посчитаем. Обещать выбор отделения
              списком нельзя, пока за списком некому сходить. */}
          <div>
            <p className="field-label">{t('public.checkout.delivery.label')}</p>
            <div className="flex gap-2">
              {(['np', 'pickup'] as const).map((d) => (
                <button
                  key={d} type="button"
                  className={delivery === d ? 'chip-active' : 'chip'}
                  aria-pressed={delivery === d}
                  onClick={() => setDelivery(d)}
                >
                  {d === 'np'
                    ? t('public.checkout.delivery.np')
                    : t('public.checkout.delivery.pickup')}
                </button>
              ))}
            </div>
          </div>

          {delivery === 'np' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="field-label" htmlFor="co-city">
                  {t('public.checkout.city.label')}
                </label>
                <input
                  id="co-city" required className="input" autoComplete="address-level2"
                  value={city} onChange={(e) => setCity(e.target.value)}
                  placeholder={t('public.checkout.city.placeholder')}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="co-branch">
                  {t('public.checkout.branch.label')}
                </label>
                <input
                  id="co-branch" required className="input"
                  value={branch} onChange={(e) => setBranch(e.target.value)}
                  placeholder={t('public.checkout.branch.placeholder')}
                />
              </div>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="co-comment">
              {t('public.checkout.comment.label')}
            </label>
            <textarea
              id="co-comment" className="textarea"
              value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={t('public.checkout.comment.placeholder')}
            />
          </div>

          {/* Деньги платформа не проводит (ADR 0005): оплату продавец
              принимает сам, и человек обязан узнать об этом до нажатия,
              а не после. */}
          <p className="t-xs prose-muted">{t('public.checkout.payment.note')}</p>

          {state === 'error' && <p className="field-error">{error}</p>}
        </form>
      )}
    </Sheet>
  )
}
