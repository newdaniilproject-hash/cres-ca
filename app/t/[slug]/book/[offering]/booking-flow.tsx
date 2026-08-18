'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { guardOrder } from '@/lib/ratelimit/guard'
import { AttributionCapture } from '@/components/attribution-capture'
import { readAttribution } from '@/lib/attribution'
import { dbErrorText } from '@/lib/errors/db'

// Язык здесь тот же, что у остальной витрины, и приходит тем же путём:
// публичные страницы не обёрнуты `LangProvider`, поэтому `useT()` отдаёт
// `DEFAULT_LANG`. Почему витрина закреплена на украинском — в шапке
// `components/shell.tsx`; когда появится сегмент адреса, провайдер встанет
// над витриной и этот экран поедет за ним, ничего здесь не меняя.
//
// Своих `names` для дней недели и своего `toISOString().slice(0,10)` тут
// больше нет. Первое было списком украинских сокращений, который в русском
// и английском остался бы украинским навсегда; второе — ошибка, названная
// в `lib/i18n/format.ts`: срез идёт по UTC, и при отрицательном смещении
// человек выбирал 5-е, а слоты запрашивались на 4-е.

type Variant = { id: string; name: string; price: number | null; minutes: number }
type Slot = { staff_id: string; staff_name: string; starts_at: string }
type Booked = { number: number; deposit_due: number; contact_phone: string | null }

const DAYS = 10

export function BookingFlow({
  tenantId, variants, depositPercent, cancelWindow,
}: {
  tenantId: string
  variants: Variant[]
  depositPercent: number
  cancelWindow: number
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [variant, setVariant] = useState<Variant | null>(variants.length === 1 ? variants[0] : null)
  const [day, setDay] = useState<Date | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [booked, setBooked] = useState<Booked | null>(null)

  const days = useMemo(() => {
    const out: Date[] = []
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(); d.setDate(d.getDate() + 1 + i); out.push(d)
    }
    return out
  }, [])

  // `t.inputDay` — ГГГГ-ММ-ДД по местным частям даты. Не локализуется
  // намеренно: это формат значения для базы, а не текст на экране.
  const iso = t.inputDay

  const loadSlots = useCallback(async (v: Variant, d: Date) => {
    setSlots(null); setSlot(null)
    const { data } = await supabase.rpc('available_slots', {
      p_tenant_id: tenantId, p_variant_id: v.id,
      p_from: iso(d), p_to: iso(d),
    })
    setSlots((data ?? []) as Slot[])
  }, [supabase, tenantId, iso])

  useEffect(() => {
    if (variant && day) void loadSlots(variant, day)
  }, [variant, day, loadSlots])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!variant || !slot) return
    setState('sending')

    // Ограничение частоты: 10 записей за час с адреса.
    //
    // Спрашиваем свой сервер до `create_booking`, потому что сам вызов
    // уходит из браузера прямо в Supabase и мимо нас не проходит.
    //
    // ⚠️ Это ограничение НАШЕЙ ФОРМЫ. Тот, кто позовёт `create_booking`
    // напрямую, сюда не заглянет — а запись он создаст настоящую, потому
    // что функция открыта анониму (правило 7). Единственное место, где
    // предел на запись выполняется всегда, — внутри самой `create_booking`;
    // это миграция, и её пишет агент, отвечающий за SQL (см. отчёт по шагу 6).
    const gate = await guardOrder()
    if (!gate.ok) { setState('error'); setError(dbErrorText(t, gate)); return }

    // Атрибуция (0105) — то же, что запомнил `AttributionCapture` на этой
    // или на родительской странице заведения. Нет запомненного перехода —
    // три поля просто null, и `create_booking` это не смущает.
    const attr = readAttribution(tenantId)

    const { data, error } = await supabase.rpc('create_booking', {
      p_tenant_id: tenantId,
      p_variant_id: variant.id,
      p_staff_id: slot.staff_id,
      p_starts_at: slot.starts_at,
      p_contact_name: name,
      p_contact_phone: phone || null,
      p_attribution_source: attr?.source ?? null,
      p_attribution_label: attr?.label ?? null,
      p_attribution_at: attr?.at ?? null,
    })
    if (error) {
      setState('error'); setError(dbErrorText(t, error))
      if (variant && day) void loadSlots(variant, day) // время могли занять
      return
    }
    setBooked(data as Booked); setState('done')
  }

  if (state === 'done' && booked) {
    const when = slot ? new Date(slot.starts_at) : null
    return (
      <div className="card rise mt-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center t-2xl"
             style={{ borderRadius: '50%', background: 'var(--color-success-soft)', color: 'var(--color-success)' }}>
          ✓
        </div>
        {/* Номер записи подставляется строкой, а не `t.number`: это номер
            документа, разделитель разрядов сделал бы из №1024 «№1 024». */}
        <h2 className="display t-xl tabular">
          {t('public.book.done.title', { n: String(booked.number) })}
        </h2>
        {/* Название варианта и имя мастера — данные заведения, не переводятся. */}
        <p className="t-md mt-2 prose-muted">
          {variant?.name}
          {when ? ` · ${t.date(when, { day: 'numeric', month: 'long' })}, `
            + `${t.dateTime(when, { hour: '2-digit', minute: '2-digit' })}` : ''}
          {slot ? ` · ${slot.staff_name}` : ''}
        </p>
        {booked.deposit_due > 0 && (
          <p className="badge-warn tabular mx-auto mt-4">
            {t('public.book.done.deposit', { sum: t.money(Number(booked.deposit_due)) })}
          </p>
        )}
        <p className="t-xs mt-4 prose-muted">
          {t('public.book.done.remind')}{' '}
          {t.plural('public.book.done.cancelHours', cancelWindow)}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-8 pb-8">
      {/* Подстраховка для прямой ссылки на конкретную услугу — минуя
          страницу заведения, где обычно и стоит `?from=`. */}
      <AttributionCapture tenantId={tenantId} />
      {/* Шаг 1: вариант */}
      <section className="rise-1">
        <p className="field-label">{t('public.book.variant.label')}</p>
        <div className="flex flex-col gap-2">
          {variants.map((v) => (
            <button key={v.id} type="button"
              onClick={() => { setVariant(v); setDay(null) }}
              className="card-link flex items-center justify-between !p-4 text-left"
              style={variant?.id === v.id
                ? { borderColor: 'var(--color-accent)', boxShadow: '0 0 0 3px var(--color-accent-soft)' }
                : undefined}>
              <span className="t-md">{v.name}</span>
              <span className="tabular t-md flex items-center gap-3 prose-muted">
                <span>{t('public.book.duration', { n: v.minutes })}</span>
                {v.price != null && <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                  {t.money(v.price)}
                </span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Шаг 2: день */}
      {variant && (
        <section className="rise">
          <p className="field-label">{t('public.book.day.label')}</p>
          <div className="scroll-x flex gap-2 pb-1">
            {days.map((d) => {
              const active = day && iso(day) === iso(d)
              return (
                <button key={iso(d)} type="button" onClick={() => setDay(d)}
                  className="t-md flex w-14 shrink-0 flex-col items-center gap-0.5 border py-2.5 transition-all"
                  style={{
                    borderRadius: 'var(--radius-control)',
                    borderColor: active ? 'var(--color-accent)' : 'var(--color-border-strong)',
                    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                    color: active ? 'var(--color-accent-text)' : 'var(--color-text)',
                  }}>
                  {/* Сокращение дня недели и число месяца даёт Intl, а не
                      свой список: в русском и английском они другие. */}
                  <span className="t-xs opacity-70">{t.date(d, { weekday: 'short' })}</span>
                  <span className="tabular font-semibold">{t.date(d, { day: 'numeric' })}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Шаг 3: время */}
      {variant && day && (
        <section className="rise">
          <p className="field-label">{t('public.book.time.label')}</p>
          {slots === null ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-11" />)}
            </div>
          ) : slots.length === 0 ? (
            <div className="empty card-flat !py-8">{t('public.book.time.empty')}</div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {slots.map((s) => {
                // Переменная называется `at`, а не `t`: `t` — переводчик,
                // и прежнее имя затеняло бы его внутри этого блока.
                const at = new Date(s.starts_at)
                const active = slot?.starts_at === s.starts_at && slot?.staff_id === s.staff_id
                return (
                  <button key={`${s.staff_id}-${s.starts_at}`} type="button"
                    onClick={() => setSlot(s)}
                    title={s.staff_name}
                    className="tabular t-md h-11 border transition-all"
                    style={{
                      borderRadius: 'var(--radius-control)',
                      borderColor: active ? 'var(--color-accent)' : 'var(--color-border-strong)',
                      background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: active ? 'var(--color-accent-text)' : 'var(--color-text)',
                    }}>
                    {t.dateTime(at, { hour: '2-digit', minute: '2-digit' })}
                  </button>
                )
              })}
            </div>
          )}
          {slot && (
            <p className="field-hint">
              {t('public.book.staff.hint', { name: slot.staff_name })}
            </p>
          )}
        </section>
      )}

      {/* Шаг 4: контакты */}
      {slot && (
        <section className="rise flex flex-col gap-4">
          <div>
            <label className="field-label" htmlFor="bname">
              {t('public.book.name.label')}
            </label>
            <input id="bname" required className="input" value={name}
                   onChange={(e) => setName(e.target.value)}
                   placeholder={t('public.book.name.placeholder')} />
          </div>
          <div>
            <label className="field-label" htmlFor="bphone">
              {t('public.book.phone.label')}
            </label>
            {/* Маска телефона — формат поля, а не текст: в словарь
                не уезжает по той же причине, что и `t.inputDay`. */}
            <input id="bphone" type="tel" className="input" value={phone}
                   onChange={(e) => setPhone(e.target.value)} placeholder="+380 __ ___ __ __" />
            <p className="field-hint">{t('public.book.phone.hint')}</p>
          </div>

          {variant && depositPercent > 0 && variant.price != null && (
            <p className="badge-warn tabular self-start">
              {t('public.book.deposit.note', {
                sum: t.money(Math.round(variant.price * depositPercent / 100)),
              })}
            </p>
          )}

          {/* Отказ базы показывается как есть: он уже написан по-украински
              и для человека, а перевод здесь завёл бы второй источник
              правды об ошибках (`lib/i18n/dict.ts`). */}
          {state === 'error' && <p className="field-error">{error}</p>}

          <button className="btn-primary" disabled={state === 'sending' || !name.trim()}>
            {state === 'sending' ? t('public.book.submit.sending') : t('public.book.submit')}
          </button>
        </section>
      )}
    </form>
  )
}
