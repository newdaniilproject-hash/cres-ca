// Сборка CSV и скачивание файла в браузере.
//
// Два решения записаны здесь, потому что оба уже стоили ошибок в этом
// проекте (см. выгрузку клиентов, `app/app/customers/customers-client.tsx`):
//
//   • разделитель — ТОЧКА С ЗАПЯТОЙ. Excel в украинской и русской локали
//     считает разделителем списка `;`, и файл с запятыми открывается одной
//     колонкой на строку. Продавец видит кашу и решает, что выгрузка сломана;
//   • в начало файла — BOM. Без него Excel читает UTF-8 как windows-1251,
//     и все украинские имена превращаются в вопросительные знаки.
//
// Библиотеки для этого не нужны: экранирование в CSV — четыре правила,
// а лишняя зависимость в сборке обёртки стоит дороже.

/** Значение ячейки: кавычки удваиваются, спецсимволы обрамляются. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Массив однородных объектов → CSV. Колонки собираются по ВСЕМ строкам,
 * а не по первой: у заказа без доставки часть полей пуста, и колонки,
 * появившиеся во второй строке, иначе потерялись бы молча.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  const head = cols.map(cell).join(';')
  const body = rows.map((r) => cols.map((c) => cell(r[c])).join(';'))
  return [head, ...body].join('\r\n')
}

/** Скачать текст файлом. BOM добавляется только к CSV — JSON он ломает. */
export function download(name: string, text: string, type: 'csv' | 'json') {
  const blob = new Blob(
    type === 'csv' ? ['﻿', text] : [text],
    { type: type === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
