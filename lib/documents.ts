// Документы засоба: один словарь на все экраны.
//
// Раньше эти списки жили внутри экрана /app/documents. Как только
// документы понадобились ещё и в карточке засоба, копия неизбежно
// разъехалась бы: добавили вид документа в одном месте — во втором
// он показывается как «Інше». Поэтому словарь один.

/** Значения перечисления material_doc_kind из миграции 0014. */
export type DocKind = 'msds' | 'quality_cert' | 'ses_conclusion' | 'notification' | 'other'

/** Полные названия — для выпадающего списка при загрузке. */
export const DOC_KINDS: { value: DocKind; label: string }[] = [
  { value: 'msds', label: 'Паспорт безпеки (MSDS)' },
  { value: 'quality_cert', label: 'Сертифікат якості' },
  { value: 'ses_conclusion', label: 'Висновок СЕС' },
  { value: 'notification', label: 'Нотифікація МОЗ' },
  { value: 'other', label: 'Інше' },
]

/** Короткие — для строк списка и значков-фильтров. */
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  msds: 'MSDS',
  quality_cert: 'Сертифікат якості',
  ses_conclusion: 'Висновок СЕС',
  notification: 'Нотифікація МОЗ',
  other: 'Інше',
}

// Повторяет ограничения бакета documents из 0019. Проверяем на клиенте
// не вместо RLS, а чтобы вместо ответа хранилища «mime type not supported»
// продавец увидел человеческую фразу.
export const DOC_MAX_BYTES = 20 * 1024 * 1024

export const DOC_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/** «1.2 МБ». Размер у старых записей не заполнен — тогда пусто, а не ноль. */
export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}
