'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

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

const NO_SUPPLIER = 'Без постачальника'

// Список заказывают одному поставщику целиком, а не по одной позиции —
// поэтому группировка по поставщику здесь не украшение, а способ работы:
// один блок = одно сообщение в вайбер.
export function ReorderClient({ items, error }: { items: LowItem[]; error: string }) {
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
    const head = supplier === NO_SUPPLIER ? 'Замовлення' : `Замовлення · ${supplier}`
    const lines = list.map((it) => (it.toOrder > 0
      ? `— ${it.title}: ${it.toOrder} ${it.unit}`.trim()
      : `— ${it.title}: залишок на межі (${it.stock} ${it.unit})`.trim()))
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
      setCopyError('Браузер не дав доступ до буфера — виділіть список і скопіюйте вручну.')
    }
  }

  const allText = groups.map((g) => textFor(g.supplier, g.list)).join('\n\n')

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
        {groups.length > 1 && (
          <button type="button" className="btn-secondary ml-auto h-10 t-md"
                  onClick={() => void copy('all', allText)}>
            {copied === 'all' ? 'Скопійовано' : 'Скопіювати все'}
          </button>
        )}
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити список: {error}</p>}
      {copyError && <p className="field-error rise">{copyError}</p>}

      {items.length === 0 ? (
        <section className="card rise-1">
          <div className="empty">
            Все на місці — нічого не опустилося до мінімуму.
            <span className="prose-muted">
              Позиція зʼявиться тут сама, щойно залишок дійде до порога,
              який ви їй задали.
            </span>
          </div>
        </section>
      ) : groups.map((g, i) => (
        <section key={g.supplier} className={`card !p-0 ${i === 0 ? 'rise-1' : 'rise-2'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <p className="t-lg truncate">{g.supplier}</p>
              <p className="tabular t-xs mt-0.5 prose-muted">позицій: {g.list.length}</p>
            </div>
            <button type="button" className="btn-secondary h-10 t-md"
                    onClick={() => void copy(g.supplier, textFor(g.supplier, g.list))}>
              {copied === g.supplier ? 'Скопійовано' : 'Скопіювати список'}
            </button>
          </div>

          <div className="px-5">
            {g.list.map((it) => (
              <div key={`${it.kind}:${it.id}`} className="row">
                <div className="min-w-0">
                  <p className="t-md truncate">{it.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {it.kind === 'material' ? 'витратний засіб' : 'товар'}
                    {' · '}залишок {it.stock} {it.unit} з мінімуму {it.threshold}
                  </p>
                </div>
                <span className={`tabular ${it.stock <= 0 ? 'badge-danger' : 'badge-warn'}`}>
                  {it.toOrder > 0 ? `+${it.toOrder} ${it.unit}` : 'на межі'}
                </span>
              </div>
            ))}
          </div>

          <div className="px-5 pb-5" />
        </section>
      ))}

      {items.length > 0 && (
        <p className="field-hint">
          Скопійований текст — готове повідомлення постачальнику: назва
          і скільки взяти. Замовлення це не створює: прихід зʼявиться на складі
          тоді, коли ви проведете приймання привезеного.
        </p>
      )}

      <p className="field-hint">
        Позиція потрапляє сюди, лише якщо їй заданий мінімальний залишок
        більший за нуль. Порожній список при порожніх полицях означає,
        що мінімуми ще не проставлені.
      </p>
    </div>
  )
}
