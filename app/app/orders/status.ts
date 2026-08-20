import type { T } from '@/lib/i18n/translate'

// ── Статусы заказа: один источник на весь продукт ───────────────────────────
//
// Файл БЕЗ `'use client'` намеренно, и это не мелочь оформления.
// Раньше список статусов, подпись и цвет значка жили в `orders-client.tsx`,
// то есть в клиентском модуле, — и серверной странице списка пришлось
// завести СВОЮ копию перечисления (`orders/page.tsx`), потому что экспорт
// клиентского модуля на сервере не функция, а ссылка на неё (CLAUDE.md,
// «Серверное и клиентское — граница, которая роняет бой»). Две копии
// одного перечисления расходятся молча: миграция добавит одиннадцатый
// статус, и список отфильтрует его в `all`, ничего не сказав.
//
// Теперь модуль общий: его читают и клиентские экраны, и серверные —
// список заказов, карточка и карточка «Останні замовлення» на «Сьогодні».

// Значения enum order_status из 0006_customers_orders.sql, в том же порядке.
// Порядок несёт смысл: по нему сортируются кнопки переходов в карточке
// заказа, чтобы «вперёд по процессу» шло слева направо.
const STATUSES = [
  'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
  'shipped', 'delivered', 'completed', 'cancelled', 'returned',
] as const
type OrderStatus = (typeof STATUSES)[number]

export const ORDER_STATUSES: string[] = [...STATUSES]

// Подпись к статусу. Само значение (`awaiting_payment`) не переводится:
// это значение перечисления базы, по нему идут запрос и матрица переходов.
// Переводится ПОДПИСЬ. Неизвестный статус выводится как есть — новый
// появится миграцией раньше, чем в словаре.
export const orderLabel = (t: T, status: string): string =>
  ((STATUSES as readonly string[]).includes(status)
    ? t(`orders.status.${status as OrderStatus}`)
    : status)

// Цвет значка — по смыслу для продавца, а не по месту в цепочке:
// акцент — «требует моего действия», жёлтый — «ждём покупателя»,
// зелёный — «деньги/товар дошли», красный — «сделка не состоялась».
export function orderBadge(status: string): string {
  switch (status) {
    case 'new':
    case 'confirmed':
    case 'packing':
    case 'shipped':
      return 'badge-accent'
    case 'awaiting_payment':
    case 'returned':
      return 'badge-warn'
    case 'paid':
    case 'delivered':
    case 'completed':
      return 'badge-success'
    case 'cancelled':
      return 'badge-danger'
    default:
      return 'badge'
  }
}
