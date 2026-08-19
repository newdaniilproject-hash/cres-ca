'use client'

import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { IconCheck } from '@/components/icons'

export type LowItem = {
  kind: string
  id: string
  title: string
  unit: string
  stock: number
  threshold: number
  toOrder: number
  supplier: string | null
}

// Ключ группы «поставщик не указан». Пустая строка, а не подпись:
// подпись переводится, а ключ — нет, иначе смена языка перетасовала бы
// группировку и порядок блоков.
const NO_SUPPLIER = ''

// Список заказывают одному поставщику целиком, а не по одной позиции —
// поэтому группировка по поставщику здесь не украшение, а способ работы:
// один блок = одно сообщение в вайбер.
export function ReorderClient({ items, error }: { items: LowItem[]; error: string }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')

  const groups = useMemo(() => {
    const bySupplier = new Map<string, LowItem[]>()
    for (const it of items) {
      const key = it.supplier?.trim() || NO_SUPPLIER
      const list = bySupplier.get(key)
      if (list) list.push(it)
      else bySupplier.set(key, [it])
    }
    return [...bySupplier.entries()]
      .map(([supplier, list]) => ({
        supplier,
        list: [...list].sort((a, b) => a.title.localeCompare(b.title, 'uk')),
      }))
      // «Без постачальника» последним: это не адресат заказа, а хвост,
      // который сначала надо кому-то приписать.
      .sort((a, b) => Number(a.supplier === NO_SUPPLIER) - Number(b.supplier === NO_SUPPLIER)
        || a.supplier.localeCompare(b.supplier, 'uk'))
  }, [items])

  // Текст пишется так, чтобы его можно было отправить как есть: получатель
  // не видит нашей таблицы и не знает слова «поріг».
  function textFor(supplier: string, list: LowItem[]): string {
    const head = supplier === NO_SUPPLIER
      ? t('inventory.reorder.copy.head')
      : t('inventory.reorder.copy.headSupplier', { supplier })
    const lines = list.map((it) => (it.toOrder > 0
      ? t('inventory.reorder.copy.item', {
        title: it.title, qty: t.number(it.toOrder), unit: it.unit,
      }).trim()
      : t('inventory.reorder.copy.itemEdge', {
        title: it.title, stock: t.number(it.stock), unit: it.unit,
      }).trim()))
    return [head, ...lines].join('\n')
  }

  async function copy(key: string, text: string) {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Буфер обмена доступен только в защищённом контексте и только по
      // жесту пользователя. Если браузер отказал — не молчим, а говорим,
      // что список придётся выделить руками.
      setCopyError(t('inventory.reorder.copyError'))
    }
  }

  const allText = groups.map((g) => textFor(g.supplier, g.list)).join('\n\n')

  // Счётчики читаются слева направо как убывание надежды: сколько всего
  // в списке → сколько уже НА НУЛЕ (не «мало», а нечем работать) → скольким
  // некому написать. Последнее — отдельная работа: сначала приписать
  // поставщика в довіднику, потом заказывать.
  const stats = useMemo(() => ({
    total: items.length,
    zero: items.filter((it) => it.stock <= 0).length,
    noSupplier: items.filter((it) => !it.supplier?.trim()).length,
  }), [items])

  return (
    <div className="flex flex-col gap-5">
      {/* Отказ загрузки приезжает с сервера уже переведённым (`dbErrorText`
          в page.tsx): сырой текст Postgres печатает значения полей (М25). */}
      {error && (
        <p className="field-error rise">{t('inventory.reorder.loadError')}: {error}</p>
      )}
      {copyError && <p className="field-error rise">{copyError}</p>}

      {items.length === 0 ? (
        // Пустой список здесь — ХОРОШАЯ новость, поэтому галочка, а не
        // коробка: ничего не опустилось до минимума.
        <section className="card rise-1">
          <div className="empty">
            <span className="empty-icon"><IconCheck size={24} /></span>
            <p className="empty-title">{t('inventory.reorder.empty.title')}</p>
            <p className="empty-desc">{t('inventory.reorder.empty.desc')}</p>
          </div>
        </section>
      ) : (
        <>
          {/* Счётчики — как на складе: крупное число, мелкая подпись.
              Это не фильтры (списку из пары групп фильтр не нужен),
              поэтому не кнопки — нажимать тут нечего. */}
          <section className="rise grid grid-cols-3 gap-2">
            <div className="metric" data-tone="blue">
              <span className="metric-value">{t.number(stats.total)}</span>
              <span className="metric-label">{t('inventory.reorder.stats.total')}</span>
            </div>
            <div className="metric" data-tone="rose">
              <span className="metric-value">{t.number(stats.zero)}</span>
              <span className="metric-label">{t('inventory.reorder.stats.zero')}</span>
            </div>
            <div className="metric" data-tone="amber">
              <span className="metric-value">{t.number(stats.noSupplier)}</span>
              <span className="metric-label">{t('inventory.reorder.stats.noSupplier')}</span>
            </div>
          </section>

          {/* «Скопіювати все» — всегда и над списками, а не в шапке:
              кнопка относится к спискам, а не к экрану. При единственной
              группе групповая кнопка не рисуется — она копировала бы
              то же самое, а два входа в одно действие — дубляж. */}
          <button type="button" className="btn-secondary rise-1 w-full"
                  onClick={() => void copy('all', allText)}>
            {copied === 'all' ? t('common.copied') : t('inventory.reorder.copyAll')}
          </button>
        </>
      )}

      {items.length > 0 && groups.map((g, i) => (
        <section key={g.supplier || 'no-supplier'}
                 className={`card !p-0 ${i === 0 ? 'rise-1' : 'rise-2'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              {/* Имя поставщика — данные арендатора, не переводится. */}
              <p className="t-lg truncate">
                {g.supplier === NO_SUPPLIER ? t('inventory.reorder.noSupplier') : g.supplier}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {t('inventory.reorder.group.count', { n: t.number(g.list.length) })}
              </p>
            </div>
            {groups.length > 1 && (
              <button type="button" className="btn-secondary t-md"
                      onClick={() => void copy(g.supplier, textFor(g.supplier, g.list))}>
                {copied === g.supplier ? t('common.copied') : t('inventory.reorder.copyList')}
              </button>
            )}
          </div>

          <div className="px-5 pb-3">
            {g.list.map((it) => (
              <div key={`${it.kind}:${it.id}`} className="row">
                <div className="min-w-0">
                  <p className="t-md truncate">{it.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {it.kind === 'material'
                      ? t('inventory.kind.material')
                      : t('inventory.kind.goods')}
                    {' · '}{t('inventory.reorder.row.stock', {
                      stock: t.number(it.stock),
                      unit: it.unit,
                      threshold: t.number(it.threshold),
                    })}
                  </p>
                </div>
                <span className={`tabular ${it.stock <= 0 ? 'badge-danger' : 'badge-warn'}`}>
                  {it.toOrder > 0
                    ? `+${t.number(it.toOrder)} ${it.unit}`
                    : t('inventory.reorder.row.edge')}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {items.length > 0 && (
        <p className="field-hint">{t('inventory.reorder.hint.copy')}</p>
      )}

      <p className="field-hint">{t('inventory.reorder.hint.threshold')}</p>
    </div>
  )
}
