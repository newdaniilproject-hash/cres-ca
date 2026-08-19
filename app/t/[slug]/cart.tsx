'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { IconBag, IconMinus, IconPlus } from '@/components/icons'
import { CheckoutSheet } from './checkout'

// ── КОШИК ВІТРИНИ ───────────────────────────────────────────────────────────
//
// ЗАЧЕМ. `create_order` живёт в базе с 0006, открыта анониму (одна из восьми
// точек, правило 7) и до этого файла не вызывалась НИ ОДНИМ файлом
// приложения: у услуг была «Записатися», у товаров — ничего. То есть товар
// на витрине посмотреть было можно, а купить нельзя.
//
// ПОЧЕМУ КЛИЕНТСКОЕ СОСТОЯНИЕ, А НЕ ТАБЛИЦА. Покупатель не авторизован и
// авторизовываться не будет: заказ гостя — это и есть основной сценарий
// (`create_order` доступна анониму именно поэтому). Корзина в базе означала
// бы девятую анонимную точку записи — отдельное решение, а не побочный
// эффект этой задачи. Пока заказ не оформлен, корзина не данные продавца,
// а черновик в браузере.
//
// ПОЧЕМУ ВИТРИНА ОТ ЭТОГО НЕ СТАЛА ДИНАМИЧЕСКОЙ. Ни одна строка здесь не
// ходит на сервер до нажатия «Оформити». Провайдер получает свежие варианты
// ПРОПОМ от серверной страницы; сам он только помнит, что и сколько выбрано.
//
// ⚠️ В БРАУЗЕРЕ ЛЕЖИТ ТОЛЬКО «ЧТО И СКОЛЬКО» — `{ v: variant_id, q: n }`.
// Ни цены, ни названия, ни остатка: они приезжают с сервера при каждой
// загрузке страницы и накладываются на сохранённое. Иначе корзина
// недельной давности показывала бы вчерашнюю цену и вчерашний остаток,
// а на «Оформити» человек получал бы отказ или другую сумму — цену
// `create_order` в любом случае берёт из базы, а не из присланного.
// Побочный выигрыш: позиция, которую продавец снял с продажи, просто
// исчезает из корзины, а не превращается в ошибку при оформлении.

const STORE_VERSION = 1
const MAX_LINES = 100 // столько же, сколько принимает `create_order`

/** Вариант товара, каким его знает СЕРВЕР на момент загрузки страницы. */
export type CartVariant = {
  id: string
  offeringId: string
  /** Название товара (`offerings.title`). */
  title: string
  /** Название варианта (`offering_variants.name`) — «M», «чорний», «250 мл». */
  name: string
  price: number
  currency: string
  /** Доступно к продаже; `null` — остаток не отслеживается (`track_stock = false`). */
  available: number | null
}

/** Строка корзины: сохранённое количество плюс свежие данные варианта. */
export type CartLine = CartVariant & { qty: number }

type Api = {
  lines: CartLine[]
  /** Данные из localStorage прочитаны. До этого корзину не рисуем вовсе. */
  ready: boolean
  add: (variantId: string) => void
  setQty: (variantId: string, qty: number) => void
  remove: (variantId: string) => void
  clear: () => void
}

const Ctx = createContext<Api | null>(null)

// Контекста нет — значит, страница не обёрнута провайдером. Тогда кнопки
// корзины не рисуются вовсе (см. `AddToCart`): кнопка, которая ничего
// не делает, читается как поломка, а её отсутствие — просто как отсутствие.
const useCart = () => useContext(Ctx)

type Stored = { v: string; q: number }

function readStored(key: string): Stored[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { version?: number; items?: Stored[] }
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.items)) return []
    return parsed.items
      .filter((i) => typeof i?.v === 'string' && Number.isFinite(i?.q) && i.q > 0)
      .slice(0, MAX_LINES)
  } catch {
    // Приватный режим, переполненная квота, чужая запись по тому же ключу —
    // корзина не тот случай, ради которого стоит показывать человеку ошибку.
    return []
  }
}

function writeStored(key: string, items: Stored[]) {
  try {
    if (items.length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify({ version: STORE_VERSION, items }))
  } catch {
    /* см. выше */
  }
}

/**
 * Провайдер корзины одного заведения. Ключ хранилища — по `slug` витрины:
 * покупатель ходит по нескольким магазинам подряд, и корзины у них разные,
 * как в жизни.
 */
export function CartProvider({
  slug, tenantId, variants, children,
}: {
  slug: string
  tenantId: string
  /** Все активные варианты ТОВАРОВ этой витрины — свежие, с сервера. */
  variants: CartVariant[]
  children: React.ReactNode
}) {
  const key = `cart:${slug}`
  const [items, setItems] = useState<Stored[]>([])
  const [ready, setReady] = useState(false)

  // Читаем ПОСЛЕ монтирования, а не в инициализаторе состояния: сервер
  // localStorage не видит, и первый кадр разошёлся бы с разметкой сервера
  // (ошибка гидратации, а не «мигание»).
  useEffect(() => {
    setItems(readStored(key))
    setReady(true)
  }, [key])

  // Пишем только после чтения: иначе пустой стартовый массив затёр бы
  // сохранённую корзину в первом же кадре.
  useEffect(() => {
    if (ready) writeStored(key, items)
  }, [ready, key, items])

  const index = useMemo(() => {
    const map = new Map<string, CartVariant>()
    for (const v of variants) map.set(v.id, v)
    return map
  }, [variants])

  // Сохранённое накладывается на свежее: вариант исчез — строка исчезла,
  // остаток упал ниже выбранного — количество прижимается к остатку.
  const lines = useMemo<CartLine[]>(() => {
    const out: CartLine[] = []
    for (const it of items) {
      const v = index.get(it.v)
      if (!v) continue
      const max = v.available
      if (max != null && max <= 0) continue
      out.push({ ...v, qty: max != null ? Math.min(it.q, max) : it.q })
    }
    return out
  }, [items, index])

  const setQty = useCallback((variantId: string, qty: number) => {
    setItems((list) => {
      if (qty <= 0) return list.filter((i) => i.v !== variantId)
      return list.some((i) => i.v === variantId)
        ? list.map((i) => (i.v === variantId ? { ...i, q: qty } : i))
        : [...list, { v: variantId, q: qty }].slice(0, MAX_LINES)
    })
  }, [])

  const add = useCallback((variantId: string) => setQty(variantId, 1), [setQty])
  const remove = useCallback((variantId: string) => setQty(variantId, 0), [setQty])
  const clear = useCallback(() => setItems([]), [])

  const api = useMemo<Api>(
    () => ({ lines, ready, add, setQty, remove, clear }),
    [lines, ready, add, setQty, remove, clear],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <CartBar tenantId={tenantId} />
    </Ctx.Provider>
  )
}

/**
 * Кнопка товара на витрине. У услуг остаётся «Записатися» — там свой поток
 * (день, время, мастер), и корзины у времени не бывает.
 *
 * Вариантов у товара может быть несколько (размер, цвет). Выбор варианта —
 * `select`, а не отдельный экран карточки товара: карточки товара на витрине
 * пока нет вовсе, и заводить её ради выпадающего списка — другая задача.
 */
export function AddToCart({ variants }: { variants: CartVariant[] }) {
  const t = useT()
  const cart = useCart()
  const [picked, setPicked] = useState<string>('')

  const sellable = useMemo(
    () => variants.filter((v) => v.available == null || v.available > 0),
    [variants],
  )
  const current = sellable.find((v) => v.id === picked) ?? sellable[0]
  const line = cart?.lines.find((l) => l.id === current?.id)

  if (!cart || variants.length === 0) return null

  // Все варианты распроданы: молчаливое отсутствие кнопки человек читает
  // как поломку витрины, поэтому причина названа словами.
  if (!current) {
    return (
      <p className="mt-3">
        <span className="badge">{t('public.cart.outOfStock')}</span>
      </p>
    )
  }

  const max = current.available
  const qty = line?.qty ?? 0
  const atMax = max != null && qty >= max

  return (
    <div className="mt-3 flex flex-col gap-2">
      {sellable.length > 1 && (
        <select
          className="select"
          aria-label={t('public.cart.variant.label')}
          value={current.id}
          onChange={(e) => setPicked(e.target.value)}
        >
          {sellable.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.price !== current.price ? ` · ${t.money(v.price, v.currency)}` : ''}
            </option>
          ))}
        </select>
      )}

      {qty === 0 ? (
        // Не `.btn-primary`: акцент — дефицитный ресурс (CLAUDE.md → «Внешний
        // вид»). На сетке из девяти карточек девять кобальтовых кнопок кричат
        // громче единственного настоящего действия — «Оформити» в полосе внизу.
        <button type="button" className="btn-secondary w-full" onClick={() => cart.add(current.id)}>
          {t('public.cart.add')}
        </button>
      ) : (
        <div
          className="flex items-center justify-between border"
          style={{
            borderRadius: 'var(--radius-control)',
            borderColor: 'var(--color-accent)',
            background: 'var(--color-accent-soft)',
          }}
        >
          <button
            type="button"
            className="btn-icon"
            aria-label={t('public.cart.qty.minus.aria')}
            onClick={() => cart.setQty(current.id, qty - 1)}
          >
            <IconMinus />
          </button>
          <span className="tabular t-md" style={{ color: 'var(--color-accent-ink)' }}>
            {t('public.cart.inCart', { n: qty })}
          </span>
          <button
            type="button"
            className="btn-icon"
            aria-label={t('public.cart.qty.plus.aria')}
            disabled={atMax}
            onClick={() => cart.setQty(current.id, qty + 1)}
          >
            <IconPlus />
          </button>
        </div>
      )}

      {/* Остаток называется только когда он близко: «залишилось 40 шт.»
          на каждой карточке — шум, «залишилось 2 шт.» — довод. */}
      {max != null && max <= 5 && (
        <p className="field-hint">{t.plural('public.cart.left', max)}</p>
      )}
    </div>
  )
}

/**
 * Полоса корзины внизу витрины. Появляется, только когда в корзине что-то
 * есть; пока пусто — витрина выглядит ровно как раньше.
 */
function CartBar({ tenantId }: { tenantId: string }) {
  const t = useT()
  const cart = useCart()
  const [open, setOpen] = useState(false)

  const lines = cart?.lines ?? []
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0)

  // `ready` обязателен: без него полоса мигала бы на первом кадре у всех,
  // у кого корзина пуста, и не появлялась бы у тех, у кого она есть.
  //
  // Пустая корзина при ОТКРЫТОЙ шторке — не «нечего показывать», а два
  // законных состояния: человек убрал последнюю позицию руками и заказ
  // только что оформлен (`clear()` уже случился, а номер ещё на экране).
  // Поэтому шторка живёт дольше полосы.
  if (!cart || !cart.ready) return null
  if (lines.length === 0 && !open) return null

  return (
    <>
      {lines.length > 0 && (
        <>
          {/* Распорка в обычном потоке: подвал сайта не должен уезжать под
              плавающую полосу — `position: fixed` содержимое не двигает. */}
          <div aria-hidden style={{ height: 'calc(76px + env(safe-area-inset-bottom))' }} />

          <div
            className="fixed inset-x-0 bottom-0 z-30"
            style={{
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-lift)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    width: 40, height: 40,
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--color-accent-soft)',
                    color: 'var(--color-accent-ink)',
                  }}
                >
                  <IconBag />
                </span>
                <span className="min-w-0">
                  <span className="t-sm block prose-muted">
                    {t.plural('public.cart.bar.items', lines.length)}
                  </span>
                  <span className="tabular t-lg block">
                    {t.money(total, lines[0].currency)}
                  </span>
                </span>
              </div>
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                {t('public.cart.bar.checkout')}
                <span className="tabular">· {t.number(count)}</span>
              </button>
            </div>
          </div>
        </>
      )}

      <CheckoutSheet
        open={open}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        lines={lines}
        setQty={cart.setQty}
        remove={cart.remove}
        clear={cart.clear}
      />
    </>
  )
}
