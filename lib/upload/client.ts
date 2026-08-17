import type { BucketId } from './guard'

/**
 * Почему отказал сервер. `other` — всё, что не про сам файл: нет сети,
 * не тот вошедший, объект не найден. Разные тексты нужны потому, что
 * «файл завеликий» и «вміст не збігається з форматом» человек лечит
 * по-разному.
 */
export type VerifyReason = 'size' | 'mime' | 'content' | 'other'

/**
 * Серверная проверка только что загруженного файла.
 *
 * Зовётся МЕЖДУ загрузкой в хранилище и созданием строки в базе:
 * пока проверка не прошла, записи о файле не существует, а сам файл
 * роут уже удалил. Разбор устройства — в `app/api/uploads/verify/route.ts`.
 *
 * Возвращает `null`, если файл принят.
 */
export async function verifyUploaded(
  bucket: BucketId,
  path: string,
): Promise<VerifyReason | null> {
  let res: Response
  try {
    res = await fetch('/api/uploads/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bucket, path }),
    })
  } catch {
    return 'other'
  }

  if (res.ok) return null

  const reason = await res.json().then((b) => b?.error).catch(() => null)
  return reason === 'size' || reason === 'mime' || reason === 'content' ? reason : 'other'
}
