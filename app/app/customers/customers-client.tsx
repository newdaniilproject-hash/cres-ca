'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { IconUsers } from '@/components/icons'

// ── Клиенты: карточка и выгрузка ───────────────────────────────────────────
//
// Экран умышленно НЕ показывает телефон в списке и НЕ читает его сам.
// Причина не в оформлении, а в том, ради чего написана 0090.
//
// Контакт клиента — это то, что уносят. Одна и та же строка «Оксана,
// +380…» в списке из ста человек и в открытой карточке значит разное:
// список читается глазами и не оставляет следа, карточка открывается
// осознанно и оставляет строку в журнале доступа. Поэтому контакт живёт
// только в карточке, а карточку отдаёт `customer_card` — она проверяет
// право `customers.contacts`, маскирует телефон и почту тому, у кого его
// нет, и пишет, ЧТО именно было отдано: «картка з контактами» или
// «картка без контактів».
//
// Выгрузка — второе действие и самое опасное из четырёх: одним нажатием
// уходит вся база. `customers_export` кладёт в журнал число выгруженных
// строк, поэтому по журналу видно разницу между «посмотрел одного» и
// «унёс базу». Файл собирается ЗДЕСЬ, из того, что вернула функция:
// собрать его из уже загруженного списка было бы быстрее и означало бы
// выгрузку мимо журнала.
//
// ⚠️ ЧЕГО ЭТОТ ЭКРАН НЕ ЗАКРЫВАЕТ. На таблице `customers` политика чтения
// висит на `customers.read`, и колонки `phone` и `email` отдаются по ней
// напрямую через PostgREST — то есть тот, у кого есть только
// `customers.read`, всё ещё может прочитать контакты запросом мимо этого
// экрана. Экран перестал быть таким запросом, но дыра закрывается не
// экраном, а правами на таблицу. Разбор и предлагаемая починка —
// `notes/pii-leaks.md`, пункт 1.

export type CustomerRow = {
  id: string
  name: string
  orders_count: number
  total_spent: number | string
  last_order_at: string | null
  tags: string[] | null
}

type Card = {
  id: string
  name: string
  phone: string | null
  email: string | null
  note: string | null
  tags: string[] | null
  orders_count: number
  total_spent: number | string
  last_order_at: string | null
  created_at: string
}

export function CustomersClient({
  tenantId, customers,
}: {
  tenantId: string
  customers: CustomerRow[]
}) {
  const t = useT()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])

  const [card, setCard] = useState<Card | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Приход из общего поиска: `/app/customers?id=<uuid>` открывает карточку
  // сразу. Своей страницы у клиента нет (список плюс шторка), поэтому
  // ссылка ведёт на список и говорит, кого именно показать, — иначе
  // найденного человека пришлось бы искать второй раз уже глазами.
  //
  // Карточку по-прежнему отдаёт `customer_card`, а не выборка из списка:
  // право на контакты и строка в журнале доступа не обходятся ни ссылкой,
  // ни чем-либо ещё. Адрес чистится сразу — иначе «назад» открывало бы
  // карточку снова, а обновление страницы писало бы в журнал второй раз.
  const sp = useSearchParams()
  useEffect(() => {
    const id = sp.get('id')
    if (!id) return
    window.history.replaceState(null, '', '/app/customers')
    void openCard(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  async function openCard(id: string) {
    setBusy(id)
    const { data, error } = await supabase.rpc('customer_card', {
      p_tenant_id: tenantId, p_customer_id: id,
    })
    setBusy(null)
    if (error) { toast.error(t('customers.card.error'), error.message); return }
    const row = (data as Card[] | null)?.[0]
    if (!row) { toast.error(t('customers.card.error'), t('customers.card.gone')); return }
    setCard(row)
  }

  async function exportAll() {
    setBusy('export')
    const { data, error } = await supabase.rpc('customers_export', { p_tenant_id: tenantId })
    setBusy(null)
    if (error) { toast.error(t('customers.export.error'), error.message); return }

    const rows = (data as Record<string, unknown>[] | null) ?? []
    if (rows.length === 0) { toast.info(t('customers.export.empty')); return }

    // Заголовки — из словаря: файл открывают в Excel, и он такая же
    // поверхность интерфейса, как экран.
    const cols: [string, string][] = [
      ['name', t('customers.export.col.name')],
      ['phone', t('customers.export.col.phone')],
      ['email', t('customers.export.col.email')],
      ['orders_count', t('customers.export.col.orders')],
      ['total_spent', t('customers.export.col.spent')],
      ['last_order_at', t('customers.export.col.last')],
      ['created_at', t('customers.export.col.created')],
    ]
    // Точка с запятой, а не запятая: украинский Excel разбирает CSV по
    // разделителю списка из локали, и файл с запятыми открывается одной
    // колонкой. BOM — по той же причине: без него кириллица приезжает
    // кракозябрами.
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      cols.map(([, title]) => esc(title)).join(';'),
      ...rows.map((r) => cols.map(([key]) => esc(r[key])).join(';')),
    ].join('\r\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = t('customers.export.filename')
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(t('customers.export.done', { n: t.number(rows.length) }))
  }

  return (
    <>
      {/* README, розділ G: рядок клієнта — аватар, ім'я, бейдж категорії,
          останній візит, статистика. Телефона в этой строке НЕТ и быть
          не может: контакт отдаёт `customer_card` с проверкой права
          и записью в журнал доступа (0090), а строка списка обошла бы
          и то, и другое. Всё остальное из макета на месте.

          Аватар — буква имени на плашке, а не картинка: колонки под фото
          у клиента нет, и пустой серый кружок был бы честнее только на вид. */}
      <section className="rise flex items-center justify-between gap-3">
        <p className="eyebrow">{t('customers.list.title')}</p>
        {customers.length > 0 && (
          <button type="button" className="btn-ghost t-sm"
                  disabled={busy === 'export'}
                  onClick={() => void exportAll()}>
            {busy === 'export' ? t('common.saving') : t('customers.export.cta')}
          </button>
        )}
      </section>

      {customers.length === 0 ? (
        <section className="card rise-1">
          <div className="empty">
            <span className="empty-icon"><IconUsers size={24} /></span>
            <p className="empty-title">{t('customers.empty')}</p>
            <p className="empty-desc">{t('customers.list.desc')}</p>
          </div>
        </section>
      ) : (
        <div className="rise-1 flex flex-col gap-2">
          {customers.map((c) => (
            <button key={c.id} type="button" className="list-card"
                    disabled={busy === c.id}
                    onClick={() => void openCard(c.id)}>
              <span aria-hidden className="thumb-sm t-md" style={{ fontWeight: 650 }}>
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-md block truncate">{c.name}</span>
                <span className="tabular t-xs mt-0.5 block prose-muted">
                  {c.last_order_at
                    ? t('customers.lastVisit', { date: t.date(c.last_order_at) })
                    : t('customers.noVisits')}
                </span>
                {(c.tags ?? []).length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {(c.tags ?? []).slice(0, 2).map((tag) => (
                      <span key={tag} className="badge">{tag}</span>
                    ))}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {Number(c.total_spent) > 0 && (
                  <span className="tabular t-md">{t.money(Number(c.total_spent))}</span>
                )}
                <span className="badge-accent tabular">
                  {t('customers.ordersCount', { n: Number(c.orders_count) })}
                </span>
              </span>
              {/* Шеврон обязателен: карточка открывается ЗАПРОСОМ к базе
                  и оставляет строку в журнале доступа. Строка, которая
                  выглядит как текст, но что-то делает, — это случайные
                  открытия в журнале, по которому потом разбираются,
                  кто смотрел контакты. */}
              <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                {busy === c.id ? '…' : '›'}
              </span>
            </button>
          ))}
        </div>
      )}

      <Sheet open={card !== null} onClose={() => setCard(null)} title={card?.name}>
        {card && (
          <div className="flex flex-col gap-3">
            <Field label={t('customers.card.phone')} value={card.phone} t={t} />
            <Field label={t('customers.card.email')} value={card.email} t={t} />
            <Field label={t('customers.card.note')} value={card.note} t={t} />
            <Field
              label={t('customers.card.orders')}
              value={t('customers.ordersCount', { n: Number(card.orders_count) })}
              t={t}
            />
            <Field
              label={t('customers.card.spent')}
              value={t.money(Number(card.total_spent))}
              t={t}
            />
            <Field
              label={t('customers.card.since')}
              value={t.date(card.created_at)}
              t={t}
            />
            {(card.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(card.tags ?? []).map((tag) => (
                  <span key={tag} className="badge">{tag}</span>
                ))}
              </div>
            )}
            {/* Маскировка — не сбой и не «нет данных». Человек должен
                понимать, что звёздочки поставили ему намеренно, иначе
                он пойдёт искать телефон в обход. */}
            <p className="field-hint">{t('customers.card.hint')}</p>
          </div>
        )}
      </Sheet>
    </>
  )
}

function Field({
  label, value, t,
}: {
  label: string
  value: string | null
  t: ReturnType<typeof useT>
}) {
  return (
    <div>
      <p className="t-xs prose-muted">{label}</p>
      <p className="t-md">{value && value !== '' ? value : t('common.noValue')}</p>
    </div>
  )
}
