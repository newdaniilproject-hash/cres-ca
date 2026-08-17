// Что вообще можно положить в хранилище: размер, объявленный тип и —
// главное — СОДЕРЖИМОЕ файла. Один модуль на все три места загрузки
// (фото каталога, документы засоба, документы склада) и на серверную
// проверку `/api/uploads/verify`.
//
// ── Кто здесь что проверяет, и почему форма не в счёт ──────────────────────
//
// Файлы в этом проекте идут из браузера ПРЯМО в Supabase Storage, минуя
// наш сервер: так дешевле трафик и так работает офлайн-очередь. Значит
// «сервер» для загрузки — это storage-api Supabase и политики бакетов
// (миграция 0019), а не роут Next. Из этого следует раскладка:
//
//   размер          — бакет, `file_size_limit`. Считаются РЕАЛЬНЫЕ байты
//                     на приёме, обойти нельзя. Проверка ниже дублирует
//                     лимит только ради человеческого текста в форме
//                     и ради того, чтобы поймать расхождение с бакетом.
//   объявленный тип — бакет, `allowed_mime_types`. Сверяется заголовок
//                     Content-Type запроса, то есть то, что НАЗВАЛ клиент.
//                     Это защита от случайности, а не от умысла: запрос
//                     можно послать мимо формы и объявить что угодно.
//   содержимое      — НИКЕМ. Эту дыру и закрывает `sniffMime`: первые
//                     байты файла читаются на сервере (роут
//                     `/api/uploads/verify`) и сверяются с объявленным
//                     типом. Не совпало — файл удаляется, строка в базе
//                     не создаётся.
//
// Проверка по РАСШИРЕНИЮ здесь не делается нигде и делаться не должна:
// расширение придумывает тот же, кто присылает файл.
//
// ── Почему наш список уже, чем список бакета ───────────────────────────────
//
// Бакет `media` (0019) пропускает ещё и `image/svg+xml`. SVG — это документ
// со скриптами, и он раздаётся с публичного CDN без подписи. Здесь он не
// принимается: ни один экран его не грузит, а стоит он ровно столько же,
// сколько хранимая XSS на домене хранилища. Пока `image/svg+xml` стоит
// в `allowed_mime_types` самого бакета, запрос мимо формы всё ещё положит
// туда SVG-«сироту» без строки в базе — убрать его из бакета отдельной
// миграцией должен тот, кто владеет `supabase/**`.

/** Ровно `file_size_limit` бакета `media` из 0019. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024

/** Ровно `file_size_limit` бакета `documents` из 0019. */
export const DOC_MAX_BYTES = 20 * 1024 * 1024

/**
 * Типы, которые принимает форма фото. Значение — расширение для имени
 * объекта в хранилище; оно нужно только людям, читающим список файлов.
 */
export const MEDIA_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

/** Типы, которые принимают оба экрана документов. */
export const DOC_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export type BucketId = 'media' | 'documents'

export const BUCKET_RULES: Record<BucketId, { maxBytes: number; allowed: Record<string, string> }> = {
  media: { maxBytes: MEDIA_MAX_BYTES, allowed: MEDIA_EXT_BY_MIME },
  documents: { maxBytes: DOC_MAX_BYTES, allowed: DOC_EXT_BY_MIME },
}

export function isBucketId(v: unknown): v is BucketId {
  return v === 'media' || v === 'documents'
}

/**
 * Путь объекта: `<tenant_id>/...`.
 *
 * Первый сегмент — арендатор (правило 1, выраженное в имени объекта);
 * по нему же политики хранилища разбирают владельца через `storage_tenant`.
 * Здесь путь проверяется не ради доступа — доступ даёт RLS, — а чтобы
 * не гонять запрос за заведомо чужой формой имени и не пускать `..`.
 */
const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._/-]{1,240}$/

export function isStoragePath(p: unknown): p is string {
  return typeof p === 'string' && PATH_RE.test(p) && !p.includes('..') && !p.includes('//')
}

// ── Опознание по содержимому ────────────────────────────────────────────────
//
// Сигнатур ровно столько, сколько типов мы принимаем. Неизвестное
// содержимое — это отказ, а не «наверное, картинка»: список закрытый,
// и расширять его надо вместе со списком бакета.

const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len))

const starts = (b: Uint8Array, sig: number[]) =>
  b.length >= sig.length && sig.every((v, i) => b[i] === v)

/**
 * Первый файл внутри zip. Нужен, чтобы `docx` отличался от любого другого
 * архива: без этого «содержимое проверено» означало бы всего лишь «это zip»,
 * а zip — это и `.jar`, и `.apk`, и что угодно ещё.
 */
function zipFirstEntry(b: Uint8Array): string | null {
  if (!starts(b, [0x50, 0x4b, 0x03, 0x04])) return null
  const nameLen = b[26] | (b[27] << 8)
  if (nameLen <= 0 || 30 + nameLen > b.length) return null
  return ascii(b, 30, nameLen)
}

const DOCX_FIRST = ['[Content_Types].xml', '_rels/', 'word/', 'docProps/', 'mimetype']

/**
 * Тип по первым байтам. `null` — не опознано, то есть отказ.
 *
 * Достаточно 4 КиБ: все сигнатуры лежат в первых 64 байтах, длиннее нужен
 * только `docx` — там читается имя первого файла архива.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null

  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'

  // AVIF/HEIF: коробка `ftyp` со своим брендом. Проверяем и major brand,
  // и совместимые: телефоны кладут `avis` для последовательностей.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(24, bytes.length - 8))
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif'
  }

  // OLE2 — контейнер старого Word (.doc), он же у .xls и .ppt.
  // Различить их по первым байтам нельзя, и это названо в COMPATIBLE.
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword'

  const entry = zipFirstEntry(bytes)
  if (entry !== null) {
    return DOCX_FIRST.some((p) => entry === p || entry.startsWith(p))
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/zip'
  }

  return null
}

/**
 * Что считается совпадением объявленного типа с содержимым.
 *
 * Карта явная, а не сравнение строк: `.doc` неотличим от `.xls` по
 * сигнатуре OLE2, а `.docx` — от любого архива по сигнатуре zip, и оба
 * случая должны быть видны в коде, а не спрятаны в «равно».
 */
const COMPATIBLE: Record<string, readonly string[]> = {
  'application/pdf': ['application/pdf'],
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/webp': ['image/webp'],
  'image/avif': ['image/avif'],
  'image/gif': ['image/gif'],
  'application/msword': ['application/msword'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
}

export type UploadVerdict =
  | { ok: true; mime: string }
  | { ok: false; reason: 'size' | 'mime' | 'content' }

/**
 * Единственная точка, где принимается решение о файле.
 *
 * `declared` — тип, который назвал загрузчик (он же лежит в хранилище
 * заголовком Content-Type). `head` — первые байты объекта, прочитанные
 * с сервера, а не из формы.
 */
export function verifyUpload(
  bucket: BucketId,
  declared: string,
  size: number,
  head: Uint8Array,
): UploadVerdict {
  const rule = BUCKET_RULES[bucket]

  if (!Number.isFinite(size) || size <= 0 || size > rule.maxBytes) {
    return { ok: false, reason: 'size' }
  }

  // Content-Type приезжает и с параметрами: `image/jpeg; charset=binary`.
  const mime = declared.split(';')[0].trim().toLowerCase()
  if (!(mime in rule.allowed)) return { ok: false, reason: 'mime' }

  const sniffed = sniffMime(head)
  if (sniffed === null) return { ok: false, reason: 'content' }
  if (!COMPATIBLE[mime]?.includes(sniffed)) return { ok: false, reason: 'content' }

  return { ok: true, mime }
}
