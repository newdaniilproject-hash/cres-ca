import type { T } from '@/lib/i18n/translate'

// Документы засоба: один словарь на все экраны.
//
// Раньше эти списки жили внутри экрана /app/documents. Как только
// документы понадобились ещё и в карточке засоба, копия неизбежно
// разъехалась бы: добавили вид документа в одном месте — во втором
// он показывается как «Інше». Поэтому словарь один.

/** Значения перечисления material_doc_kind из миграции 0014. */
export type DocKind = 'msds' | 'quality_cert' | 'ses_conclusion' | 'notification' | 'other'

/**
 * Виды документов в том порядке, в каком они стоят в выпадающем списке.
 *
 * Здесь только ЗНАЧЕНИЯ и их порядок. Подписей тут больше нет: полная
 * живёт в словаре как `documents.kind.<вид>`, короткая — как
 * `documents.kind.<вид>.short`. Раньше рядом лежали два украинских
 * списка (`DOC_KINDS[].label` и `DOC_KIND_LABEL`), и после перевода
 * экранов их не читал уже никто — а оставленные, они были бы вторым
 * источником подписи, который разъедется с первым (правило 8:
 * выключено — значит удалено).
 *
 * Само значение (`msds`) не переводится никогда: по нему сверяется база.
 */
export const DOC_KINDS: DocKind[] = [
  'msds', 'quality_cert', 'ses_conclusion', 'notification', 'other',
]

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

/**
 * «1,2 МБ». Размер у старых записей не заполнен — тогда пусто, а не ноль.
 *
 * Единица идёт из словаря, а не строкой в коде: «Б/КБ/МБ» — это подпись,
 * и при русском или английском интерфейсе рядом с переведённым названием
 * документа стояла украинская. Переводчик приходит параметром по той же
 * причине, что и в `lib/auth-errors.ts`: язык знает только вызывающий.
 */
export function fmtSize(t: T, bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return t('common.size.b', { n: bytes })
  if (bytes < 1024 * 1024) return t('common.size.kb', { n: Math.round(bytes / 1024) })
  // Десятичный разделитель ставит локаль, а не replace('.', ','):
  // в английском это точка, и ручная замена сделала бы «1,2 MB».
  return t('common.size.mb', { n: t.number(bytes / 1024 / 1024, { maximumFractionDigits: 1 }) })
}
