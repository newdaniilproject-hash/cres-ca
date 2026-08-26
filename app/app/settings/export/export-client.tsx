'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { toCsv, download } from '@/lib/export/csv'
import { dbErrorText } from '@/lib/errors/db'

// Разделы в порядке важности для продавца: сначала то, из-за чего он
// вообще спрашивает про выгрузку (клиенты, заказы, записи), потом учёт.
const SECTIONS = [
  'tenant', 'customers', 'orders', 'bookings', 'staff',
  'catalog', 'inventory', 'movements', 'journals', 'techcards', 'finance',
] as const
type Section = (typeof SECTIONS)[number]

// `journals` приходит ОБЪЕКТОМ из трёх журналов, остальные — массивом.
// В CSV объект не сворачивается: три разных журнала одной таблицей —
// это уже не данные, а каша. Поэтому у него только JSON.
const CSV_ABLE: readonly Section[] = SECTIONS.filter((s) => s !== 'journals')

export function ExportClient({
  tenantId, allowed, contacts,
}: {
  tenantId: string
  allowed: Record<Section, boolean>
  contacts: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const stamp = () => new Date().toISOString().slice(0, 10)

  async function pull(section: Section) {
    const { data, error } = await supabase.rpc('tenant_export', {
      p_tenant_id: tenantId, p_section: section,
    })
    if (error) throw new Error(error.message)
    return data
  }

  // Всё одним файлом. Формат — JSON, а не архив: zip в браузере требует
  // библиотеку, а несколько CSV подряд браузер блокирует как множественную
  // загрузку. JSON читается любым инструментом и не теряет вложенность
  // (позиции заказа, партии засоба, расписание мастера).
  async function all() {
    setBusy('all'); setErr('')
    try {
      const out: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        contacts_visible: contacts,
      }
      for (const s of SECTIONS) {
        if (!allowed[s]) continue
        out[s] = await pull(s)
      }
      download(`cresca-${stamp()}.json`, JSON.stringify(out, null, 2), 'json')
    } catch (e) {
      setErr(dbErrorText(t, e))
    }
    setBusy(null)
  }

  async function one(section: Section, as: 'csv' | 'json') {
    setBusy(section); setErr('')
    try {
      const data = await pull(section)
      if (as === 'json') {
        download(`cresca-${section}-${stamp()}.json`, JSON.stringify(data, null, 2), 'json')
      } else {
        const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [data]
        download(`cresca-${section}-${stamp()}.csv`, toCsv(rows), 'csv')
      }
    } catch (e) {
      setErr(dbErrorText(t, e))
    }
    setBusy(null)
  }

  const open = SECTIONS.filter((s) => allowed[s])

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок и стрелка «назад» — из оболочки, а не отсюда. */}
      <p className="t-sm prose-muted">{t('export.desc')}</p>

      {err && <p className="field-error rise">{err}</p>}

      <div className="card rise">
        <button className="btn-primary" disabled={busy !== null} onClick={() => void all()}>
          {busy === 'all' ? t('export.working') : t('export.all')}
        </button>
        <p className="field-hint mt-2">{t('export.allHint')}</p>
        {/* Маскировка контактов — не мелкий шрифт, а условие, при котором
            выгрузка вообще имеет смысл: файл со звёздочками вместо телефонов
            бесполезен для переноса, и узнать об этом нужно ДО скачивания. */}
        {!contacts && <p className="field-hint">{t('export.maskedHint')}</p>}
      </div>

      <div className="card !p-0 rise-2">
        {open.map((s) => (
          <div key={s} className="row px-5">
            <div className="min-w-0">
              <p className="t-md">{t(`export.section.${s}`)}</p>
              <p className="t-xs truncate prose-muted">{t(`export.sectionDesc.${s}`)}</p>
            </div>
            {/* Оба формата — ОДИНАКОВЫМИ кнопками, и это не вкусовая правка.
                JSON стоял `btn-ghost`: серый текст без рамки рядом
                с обведённой кнопкой CSV. Два равных действия («забрать
                этот раздел вот таким файлом») выглядели как «кнопка
                и что-то отключённое», а у «Санітарних журналів», где CSV
                не бывает вовсе, в строке оставалась дыра и одна серая
                надпись — читалось как сломанная строка, а не как
                «здесь только JSON». Найдено рендером 25.08.2026. */}
            <div className="flex shrink-0 items-center gap-2">
              {CSV_ABLE.includes(s) && (
                <button className="btn-secondary t-sm" disabled={busy !== null}
                        onClick={() => void one(s, 'csv')}>CSV</button>
              )}
              <button className="btn-secondary t-sm" disabled={busy !== null}
                      onClick={() => void one(s, 'json')}>JSON</button>
            </div>
          </div>
        ))}
      </div>

      <p className="field-hint">{t('export.logHint')}</p>
    </div>
  )
}
