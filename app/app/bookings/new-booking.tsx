'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { IconPlus } from '@/components/icons'
import {
  CustomerPicker, emptyContact, normPhone, type Contact,
} from '../customers/customer-picker'

// ── Запись из кабинета ──────────────────────────────────────────────────────
//
// ЗАЧЕМ. Салон работает по телефону: клиент звонит, мастер записывает. До
// этого файла записи в продукте создавались ТОЛЬКО покупателем с витрины —
// то есть самый частый способ записи в этом сегменте не существовал вовсе.
//
// ── ЭТО ТОТ ЖЕ ПУТЬ, ЧТО И У ВИТРИНЫ, А НЕ ВТОРОЙ ───────────────────────────
//
// Слоты считает `available_slots`, запись создаёт `create_booking` — ровно
// те же функции и с теми же параметрами, что `app/t/[slug]/book/[offering]`.
// Своей проверки занятости здесь нет и быть не может: двойную запись ловит
// ограничение исключения на `bookings`, а не код (CLAUDE.md, «Как это
// работает»). Отказ «это время уже занято» — нормальный исход гонки, и он
// показывается человеком, а слоты перечитываются.
//
// Чем отличается от витрины, и почему:
//   • день начинается СЕГОДНЯ, а не завтра. Витрина бережёт мастера от
//     записи «через десять минут», кабинет — наоборот: клиент звонит
//     и едет сейчас. Прошедшее время всё равно отсекает сама функция
//     («нельзя записаться в прошлое») и `available_slots` (`slot_start > now()`);
//   • атрибуция не передаётся. `create_booking` для сотрудника её
//     игнорирует по определению (0105): ручная запись — это и есть
//     «привёл продавец сам»;
//   • услуги показываются и неопубликованные. Сотруднику функция это
//     разрешает явно (`v_offering.status <> 'active' and not v_staffer`),
//     и прятать от него собственную услугу значило бы заставить сначала
//     публиковать её на витрине.
//
// ── ПРАВА ───────────────────────────────────────────────────────────────────
//
// Кнопка рисуется по `orders.write` — тому же праву, которое `create_booking`
// проверяет внутри (`tenant_can(p_tenant_id, 'orders.write')`). Это только
// раскладка: граница доступа — сама функция, и без права она откажет,
// сколько бы кнопок ни нарисовал экран.
//
// Список услуг при этом читается политикой `offerings_read` (0004), то есть
// требует `catalog.read`. Расхождения на практике нет — все три роли
// с `orders.write` (admin, manager, operator) имеют и `catalog.read`
// (0001), — но если такую роль когда-нибудь заведут точечным дозволом,
// человек увидит пустой список услуг при живой кнопке. Лечится это
// правами, а не обходом политики definer-функцией: второй путь к каталогу
// был бы вторым источником правды о том, что заведению видно.

type Variant = {
  id: string
  name: string
  price: number | null
  minutes: number
  offering: string
}
type Staffer = { id: string; name: string }
type Slot = { staff_id: string; staff_name: string; starts_at: string }

/** Сколько дней вперёд показывать. Горизонт всё равно режет сама услуга
 *  (`booking_horizon_days` внутри `available_slots`), здесь — только полоса. */
const DAYS = 14

export function NewBookingButton({
  tenantId, className,
}: {
  tenantId: string
  className?: string
}) {
  const t = useT()
  const toast = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [open, setOpen] = useState(false)
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [staff, setStaff] = useState<Staffer[]>([])
  const [variant, setVariant] = useState<Variant | null>(null)
  const [staffId, setStaffId] = useState<string>('')
  const [day, setDay] = useState<Date | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [contact, setContact] = useState<Contact>(emptyContact)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // `t.inputDay` — ГГГГ-ММ-ДД по МЕСТНЫМ частям даты. Не `toISOString()`:
  // срез идёт по UTC, и при отрицательном смещении человек выбирает 5-е,
  // а слоты запрашиваются на 4-е (та же ловушка названа в booking-flow).
  const iso = t.inputDay

  const days = useMemo(() => {
    const out: Date[] = []
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); out.push(d)
    }
    return out
  }, [])

  // Справочники грузятся при ОТКРЫТИИ шторки, а не вместе со страницей:
  // список записей открывают десятки раз за смену, а новую запись заводят
  // из него единицы раз — платить за это временем каждого открытия экрана
  // нельзя (CLAUDE.md, правило 6).
  useEffect(() => {
    if (!open || variants !== null) return
    void (async () => {
      const [offs, mates] = await Promise.all([
        supabase.from('offerings')
          .select('id, title, price, status')
          .eq('tenant_id', tenantId)
          .eq('kind', 'service')
          .neq('status', 'archived'),
        supabase.from('staff')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('position'),
      ])
      if (offs.error) { setErr(dbErrorText(t, offs.error)); setVariants([]); return }
      const titles = new Map<string, { title: string; price: number | null }>()
      for (const o of offs.data ?? []) {
        titles.set(o.id as string, {
          title: o.title as string,
          price: o.price === null ? null : Number(o.price),
        })
      }
      if (titles.size === 0) { setVariants([]); setStaff((mates.data ?? []) as Staffer[]); return }

      const { data, error } = await supabase.from('offering_variants')
        .select('id, name, price, duration_minutes, offering_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('offering_id', [...titles.keys()])
        .not('duration_minutes', 'is', null)
        .order('position')
      if (error) { setErr(dbErrorText(t, error)); setVariants([]); return }

      setStaff((mates.data ?? []) as Staffer[])
      setVariants((data ?? []).map((v) => {
        const own = titles.get(v.offering_id as string)
        return {
          id: v.id as string,
          name: v.name as string,
          // Цена варианта, иначе цена позиции — тот же порядок, что
          // в `create_booking` (`coalesce(v_variant.price, v_offering.price, 0)`).
          price: v.price !== null ? Number(v.price) : own?.price ?? null,
          minutes: Number(v.duration_minutes),
          offering: own?.title ?? '',
        }
      }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId])

  const loadSlots = useCallback(async (v: Variant, d: Date, master: string) => {
    setSlots(null); setSlot(null)
    const { data, error } = await supabase.rpc('available_slots', {
      p_tenant_id: tenantId,
      p_variant_id: v.id,
      p_from: iso(d),
      p_to: iso(d),
      // Пусто — «любой свободный мастер»: ровно то, что функция понимает
      // под `p_staff_id is null`. Второй логики выбора мастера здесь нет.
      p_staff_id: master || null,
    })
    if (error) { setErr(dbErrorText(t, error)); setSlots([]); return }
    setSlots((data ?? []) as Slot[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tenantId, iso])

  useEffect(() => {
    if (open && variant && day) void loadSlots(variant, day, staffId)
  }, [open, variant, day, staffId, loadSlots])

  function close() {
    setOpen(false)
    setVariant(null); setStaffId(''); setDay(null); setSlots(null); setSlot(null)
    setContact(emptyContact); setComment(''); setErr('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!variant || !slot || !contact.name.trim() || busy) return
    setBusy(true); setErr('')

    const { data, error } = await supabase.rpc('create_booking', {
      p_tenant_id: tenantId,
      p_variant_id: variant.id,
      // Мастер берётся ИЗ СЛОТА, а не из выбора выше: при «любом свободном»
      // выбора нет вовсе, а слот всегда знает, чей он.
      p_staff_id: slot.staff_id,
      p_starts_at: slot.starts_at,
      p_contact_name: contact.name.trim(),
      p_contact_phone: normPhone(contact.phone) || null,
      p_comment: comment.trim() || null,
    })
    setBusy(false)
    if (error) {
      setErr(dbErrorText(t, error))
      // Время могли занять, пока заполняли контакт, — перечитываем слоты.
      if (variant && day) void loadSlots(variant, day, staffId)
      return
    }
    const row = data as { number: number } | null
    toast.success(t('bookings.new.done', { n: String(row?.number ?? '') }))
    close()
    router.refresh()
  }

  const ready = Boolean(variant && slot && contact.name.trim())

  return (
    <>
      <button type="button" className={className ?? 'btn-primary'}
              style={{ minHeight: 'var(--tap-min)' }}
              onClick={() => setOpen(true)}>
        <IconPlus size={18} />
        {t('bookings.new.cta')}
      </button>

      <Sheet
        open={open}
        onClose={close}
        title={t('bookings.new.title')}
        footer={(
          <button type="submit" form="new-booking" className="btn-primary w-full"
                  disabled={busy || !ready}>
            {busy ? t('common.saving') : t('bookings.new.submit')}
          </button>
        )}
      >
        <form id="new-booking" onSubmit={submit} className="flex flex-col gap-6 pb-2">
          {/* Шаг 1: услуга. Список плоский «позиция · вариант»: у салона
              вариантов на услугу один-два, и двухуровневое меню здесь
              стоило бы лишнего нажатия на каждой записи. */}
          <section>
            <p className="field-label">{t('bookings.new.service.label')}</p>
            {variants === null ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-12" />)}
              </div>
            ) : variants.length === 0 ? (
              <p className="field-hint">{t('bookings.new.service.empty')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {variants.map((v) => (
                  <button key={v.id} type="button"
                          className="list-card text-left"
                          style={{
                            minHeight: 'var(--tap-min)',
                            borderColor: variant?.id === v.id ? 'var(--color-accent)' : undefined,
                            background: variant?.id === v.id
                              ? 'var(--color-accent-soft)' : undefined,
                          }}
                          onClick={() => { setVariant(v); setDay(null); setSlot(null) }}>
                    <span className="min-w-0 flex-1">
                      {/* Название услуги — данные заведения, не переводится. */}
                      <span className="t-md block truncate">{v.offering}</span>
                      <span className="t-xs block truncate prose-muted">{v.name}</span>
                    </span>
                    <span className="tabular t-sm flex shrink-0 items-center gap-2 prose-muted">
                      <span>{t('bookings.new.duration', { n: v.minutes })}</span>
                      {v.price !== null && (
                        <span style={{ color: 'var(--color-text)' }}>{t.money(v.price)}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Шаг 2: мастер. Отдельным полем, а не выбором из слотов: клиент
              по телефону чаще всего просит «до Олі», и подбирать её потом
              глазами среди слотов — это и есть та работа, которую экран
              обязан снять. */}
          {variant && (
            <section>
              <label className="field-label" htmlFor="nb-staff">
                {t('bookings.new.staff.label')}
              </label>
              {staff.length === 0 ? (
                <p className="field-hint">{t('bookings.new.staff.empty')}</p>
              ) : (
                <select id="nb-staff" className="select" value={staffId}
                        onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">{t('bookings.new.staff.any')}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </section>
          )}

          {/* Шаг 3: день */}
          {variant && (
            <section>
              <p className="field-label">{t('bookings.new.day.label')}</p>
              <div className="scroll-x flex gap-2 pb-1">
                {days.map((d) => {
                  const active = day !== null && iso(day) === iso(d)
                  return (
                    <button key={iso(d)} type="button" onClick={() => setDay(d)}
                            className="t-md flex w-14 shrink-0 flex-col items-center gap-0.5 border py-2.5 transition-all"
                            style={{
                              borderRadius: 'var(--radius-control)',
                              borderColor: active
                                ? 'var(--color-accent)' : 'var(--color-border-strong)',
                              background: active
                                ? 'var(--color-accent)' : 'var(--color-surface)',
                              color: active ? 'var(--color-accent-text)' : 'var(--color-text)',
                            }}>
                      {/* Сокращение дня недели и число даёт Intl, а не свой
                          список: в русском и английском они другие. */}
                      <span className="t-xs opacity-70">{t.date(d, { weekday: 'short' })}</span>
                      <span className="tabular font-semibold">{t.date(d, { day: 'numeric' })}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Шаг 4: время */}
          {variant && day && (
            <section>
              <p className="field-label">{t('bookings.new.time.label')}</p>
              {slots === null ? (
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-11" />)}
                </div>
              ) : slots.length === 0 ? (
                <p className="field-hint">{t('bookings.new.time.empty')}</p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {slots.map((s) => {
                    // Переменная называется `at`, а не `t`: `t` — переводчик.
                    const at = new Date(s.starts_at)
                    const active = slot?.starts_at === s.starts_at
                      && slot?.staff_id === s.staff_id
                    return (
                      <button key={`${s.staff_id}-${s.starts_at}`} type="button"
                              title={s.staff_name}
                              onClick={() => setSlot(s)}
                              className="tabular t-md h-11 border transition-all"
                              style={{
                                borderRadius: 'var(--radius-control)',
                                borderColor: active
                                  ? 'var(--color-accent)' : 'var(--color-border-strong)',
                                background: active
                                  ? 'var(--color-accent)' : 'var(--color-surface)',
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

          {/* Шаг 5: клиент */}
          {slot && (
            <CustomerPicker tenantId={tenantId} value={contact} onChange={setContact}
                            disabled={busy} />
          )}

          {slot && (
            <div>
              <label className="field-label" htmlFor="nb-comment">
                {t('bookings.new.comment.label')}
              </label>
              <textarea id="nb-comment" className="textarea" rows={2} value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={t('bookings.new.comment.placeholder')} />
            </div>
          )}

          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>
    </>
  )
}
