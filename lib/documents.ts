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

// Ограничения на сам файл переехали в `lib/upload/guard.ts` (шаг 6):
// там же живут лимиты бакета `media`, опознание типа по содержимому
// и то, что зовёт серверная проверка. Держать здесь вторую копию списка
// форматов значило бы завести второй источник правды — при следующем
// добавлении формата один из списков молча отстал бы.


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

// ── Ссылка на приватный документ ───────────────────────────────────────────
//
// Бакет `documents` приватный: публичной ссылки у файла нет в принципе.
// Пять минут — столько живёт доступ, дальше ссылка мертва, даже если её
// переслали. Сертификаты и заключения СЭС наружу не отдаются.
//
// ⚠️ ПУТЬ БЕРЁТСЯ ИЗ `document_access` (0090), А НЕ ИЗ СТРОКИ РЕЕСТРА,
// и это не перестраховка. Скачивание документа — одно из четырёх действий,
// которые обязаны попадать в журнал доступа: инспектор, прокуратура и сам
// клиент спрашивают «кто выносил MSDS», и ответить на это можно только
// записью. Функция и проверяет право `compliance.read`, и пишет строку,
// и отдаёт путь — одним вызовом, в одной транзакции. Подписать ссылку
// по `doc.path` из уже загруженного списка технически можно, и ровно
// поэтому этот путь закрыт здесь, в общем месте: два экрана показывают
// документы (реестр и карточка засоба), и вторая копия кода неизбежно
// отстала бы. Правило проекта: «добавление поля требует правки одного
// файла» — здесь оно про журнал.
//
// Отказ функции — это отказ доступа, а не сбой подписи: `compliance.read`
// проверяет она, а не хранилище. Поэтому текст ошибки возвращается
// вызывающему как есть и показывается человеку.

/** Минимум, который нужен от строки реестра. Полный тип живёт на экранах. */
type DocRef = { id: string }

export async function documentSignedUrl(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>
    storage: {
      from: (bucket: string) => {
        createSignedUrl: (path: string, expiresIn: number, opts?: { download: string }) =>
          PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      }
    }
  },
  tenantId: string,
  doc: DocRef,
  filename?: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data: path, error: accessError } = await supabase.rpc('document_access', {
    p_tenant_id: tenantId, p_document_id: doc.id,
  })
  if (accessError) return { url: null, error: accessError.message }
  if (typeof path !== 'string' || path === '') {
    return { url: null, error: 'document_access: порожній шлях' }
  }

  const { data, error } = await supabase.storage.from('documents')
    .createSignedUrl(path, 300, filename ? { download: filename } : undefined)
  if (error) return { url: null, error: error.message }
  return { url: data?.signedUrl ?? null, error: null }
}
