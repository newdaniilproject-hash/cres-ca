'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { IconClose, IconMinus, IconPlus } from '@/components/icons'
import {
  CustomerPicker, emptyContact, normPhone, type Contact,
} from '../customers/customer-picker'

// ── Заказ, заведённый вручную ───────────────────────────────────────────────
//
// ЗАЧЕМ. Прежний комментарий на этом экране гласил: «заказ в этом продукте
// не заводится из кабинета вовсе — он приходит с витрины». Для салона это
// означало, что продажа по телефону и продажа у стойки не фиксируются
// нигде: ни в заказах, ни в остатках, ни в деньгах.
//
// ── ТОТ ЖЕ `create_order`, ЧТО И У ВИТРИНЫ ──────────────────────────────────
//
// Ни своей вставки в `orders`, ни своей — в `order_items` здесь нет. Функция
// сама берёт цену и название ИЗ БАЗЫ (переданной цене она не верит), сама
// заводит или находит карточку клиента по телефону, сама резервирует остаток
// по позициям с учётом склада и сама пишет первое событие в историю заказа.
// Любой обход этого списка означал бы заказ без резерва или с ценой из
// браузера.
//
// `p_source: 'manual'` передаётся явно, хотя функция и сама подменяет
// 'storefront' на 'manual' для сотрудника: полагаться на подмену значило бы
// прятать смысл вызова в чужом теле. Атрибуция не передаётся — сотруднику
// она игнорируется по определению (0105): ручной заказ и есть «привёл
// продавец сам».
//
// ── ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ ─────────────────────────────────────────────────
//
// Доставки и оплаты. `create_order` принимает `p_delivery`, но выбора способа
// доставки в продукте нет вовсе (CLAUDE.md → «Доставка»: таблица `shipments`
// есть, расчёта нет), а денег покупателя платформа не проводит (ADR 0005).
// Форма, спрашивающая отделение Нової Пошти, которое дальше никуда не идёт,
// — это обещание, которого продукт не выполняет. Отметка об оплате ставится
// переходом статуса на карточке заказа, как и у заказа с витрины.

type Hit = {
  variantId: string
  title: string
  variant: string
  price: number
}
type Line = Hit & { qty: number }

// Состояние «шторка открыта» живёт СНАРУЖИ, в экране заказов, и это не
// формальность: кнопок две — в широком хедере и в узкой полосе, — а форма
// обязана быть одна. Два состояния разъезжаются, и человек видит открытой
// одну шторку, а заполняет вторую.
export function NewOrderSheet({
  tenantId, open, onClose,
}: {
  tenantId: string
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const toast = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [contact, setContact] = useState<Contact>(emptyContact)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Поиск с задержкой и от двух знаков — как в общем поиске шапки: без
  // задержки каждая буква уходит запросом в базу в Ирландии.
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) { setHits(null); return }
    const id = setTimeout(() => {
      void (async () => {
        // Один запрос на пару «позиция + вариант»: покупают вариант,
        // а ищут по названию позиции, и разбивать это на два шага значит
        // добавить нажатие на каждой строке заказа.
        const { data, error } = await supabase.from('offering_variants')
          .select('id, name, price, offerings!inner(id, title, price, status)')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .ilike('offerings.title', `%${term}%`)
          .neq('offerings.status', 'archived')
          .limit(8)
        if (error) { setErr(dbErrorText(t, error)); setHits([]); return }
        setErr('')
        setHits((data ?? []).map((v) => {
          // PostgREST отдаёт вложенную позицию объектом; тип клиента
          // не сгенерирован, поэтому приводим руками и в одном месте.
          const o = v.offerings as unknown as { title: string; price: number | null }
          return {
            variantId: v.id as string,
            title: o?.title ?? '',
            variant: v.name as string,
            // Тот же порядок, что в `create_order`:
            // `coalesce(variant.price, offering.price, 0)`.
            price: Number(v.price ?? o?.price ?? 0),
          }
        }))
      })()
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, tenantId])

  function add(h: Hit) {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.variantId === h.variantId)
      if (at < 0) return [...prev, { ...h, qty: 1 }]
      const next = [...prev]
      next[at] = { ...next[at], qty: next[at].qty + 1 }
      return next
    })
    setQ('')
    setHits(null)
  }

  function setQty(variantId: string, delta: number) {
    setLines((prev) => prev
      .map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0))
  }

  function drop(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }

  function close() {
    setQ(''); setHits(null); setLines([]); setContact(emptyContact)
    setComment(''); setErr('')
    onClose()
  }

  // Итог считается здесь ТОЛЬКО ради подписи под списком. В базу он не
  // уходит: сумму заказа складывает сама база из цен, взятых ею же.
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)
  const ready = lines.length > 0 && contact.name.trim().length > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setErr('')

    const { data, error } = await supabase.rpc('create_order', {
      p_tenant_id: tenantId,
      p_items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.qty })),
      p_contact_name: contact.name.trim(),
      p_contact_phone: normPhone(contact.phone) || null,
      p_comment: comment.trim() || null,
      p_source: 'manual',
    })
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }

    const row = data as { id: string; number: number } | null
    toast.success(t('orders.new.done', { n: String(row?.number ?? '') }))
    close()
    // Обновление списка, а не переход на карточку: заказ у стойки заводят
    // подряд, и уводить с экрана после каждого значит заставлять вернуться.
    router.refresh()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        title={t('orders.new.title')}
        footer={(
          <button type="submit" form="new-order" className="btn-primary w-full"
                  disabled={busy || !ready}>
            {busy ? t('common.saving') : t('orders.new.submit')}
          </button>
        )}
      >
        <form id="new-order" onSubmit={submit} className="flex flex-col gap-6 pb-2">
          <section>
            <label className="field-label" htmlFor="no-search">
              {t('orders.new.search.label')}
            </label>
            <input id="no-search" className="input" value={q}
                   onChange={(e) => setQ(e.target.value)}
                   placeholder={t('orders.new.search.placeholder')} />
            {hits !== null && hits.length === 0 && (
              <p className="field-hint">{t('orders.new.search.empty')}</p>
            )}
            {hits !== null && hits.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {hits.map((h) => (
                  <button key={h.variantId} type="button" className="list-card text-left"
                          style={{ minHeight: 'var(--tap-min)' }}
                          onClick={() => add(h)}>
                    <span className="min-w-0 flex-1">
                      {/* Название позиции — данные заведения, не переводится. */}
                      <span className="t-md block truncate">{h.title}</span>
                      <span className="t-xs block truncate prose-muted">{h.variant}</span>
                    </span>
                    <span className="tabular t-sm shrink-0">{t.money(h.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="field-label">{t('orders.new.items.title')}</p>
            {lines.length === 0 ? (
              <p className="field-hint">{t('orders.new.items.empty')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {lines.map((l) => (
                  <div key={l.variantId} className="list-card items-center">
                    <span className="min-w-0 flex-1">
                      <span className="t-md block truncate">{l.title}</span>
                      <span className="tabular t-xs block truncate prose-muted">
                        {l.variant} · {t.money(l.price)}
                      </span>
                    </span>
                    {/* Зона нажатия у «−» и «+» — 44px: количество правят
                        пальцем у стойки, а не мышью. */}
                    <span className="flex shrink-0 items-center gap-1">
                      <button type="button" className="btn-icon"
                              aria-label={t('orders.new.qty.less')}
                              onClick={() => setQty(l.variantId, -1)}>
                        <IconMinus size={16} />
                      </button>
                      <span className="tabular t-md" style={{ minWidth: 24, textAlign: 'center' }}>
                        {l.qty}
                      </span>
                      <button type="button" className="btn-icon"
                              aria-label={t('orders.new.qty.more')}
                              onClick={() => setQty(l.variantId, 1)}>
                        <IconPlus size={16} />
                      </button>
                      <button type="button" className="btn-icon"
                              aria-label={t('orders.new.item.remove')}
                              onClick={() => drop(l.variantId)}>
                        <IconClose size={16} />
                      </button>
                    </span>
                  </div>
                ))}
                <p className="tabular t-md text-right">
                  {t('orders.new.total', { sum: t.money(total) })}
                </p>
              </div>
            )}
          </section>

          <CustomerPicker tenantId={tenantId} value={contact} onChange={setContact}
                          disabled={busy} />

          <div>
            <label className="field-label" htmlFor="no-comment">
              {t('orders.new.comment.label')}
            </label>
            <textarea id="no-comment" className="textarea" rows={2} value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={t('orders.new.comment.placeholder')} />
          </div>

          <p className="field-hint">{t('orders.new.hint')}</p>
          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>
    </>
  )
}
