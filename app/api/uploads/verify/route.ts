import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMemberships } from '@/lib/tenant'
import { logForeignTenant } from '@/lib/security-log'
import { isBucketId, isStoragePath, verifyUpload } from '@/lib/upload/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 20

// Проверка загруженного файла ПО СОДЕРЖИМОМУ. Шаг 6, пункт первый.
//
// ── Зачем отдельный роут, если файл и так летит мимо нас ───────────────────
//
// Браузер кладёт файл прямо в Supabase Storage: наш сервер в этом пути не
// участвует, и это правильно — гонять двадцать мегабайт сертификата через
// функцию Vercel значит платить за трафик дважды и упереться в лимит тела
// запроса. Поэтому «проверка на сервере» здесь устроена иначе: файл уже
// лежит, а мы читаем ПЕРВЫЕ ЧЕТЫРЕ КИЛОБАЙТА уже сохранённого объекта
// и сверяем их с типом, который загрузчик объявил.
//
// Что это ловит и чего не ловят бакеты (0019): `allowed_mime_types`
// сверяет заголовок Content-Type, то есть слово клиента. Запрос можно
// послать мимо формы и назвать исполняемый файл `application/pdf` —
// бакет пропустит, инспектор скачает. Здесь такой файл не проходит:
// сигнатура не совпадёт с объявленным типом, объект будет удалён,
// а строки в `material_documents` или `offering_media` не появится.
//
// ── Почему это НЕ сервисный ключ ──────────────────────────────────────────
//
// Роут работает от имени вошедшего (правило 3: сервисный ключ живёт только
// в фоновых задачах). Значит и подписанная ссылка на чтение, и удаление
// объекта проходят через те же политики хранилища, что и сама загрузка:
// чужой файл этим роутом ни прочитать, ни удалить нельзя, и второй копии
// логики прав здесь нет.
//
// ── Порядок вызова, и он важен ────────────────────────────────────────────
//
//   upload → verify → insert строки в базу
//
// Строка создаётся ПОСЛЕ проверки. Иначе на неудачной проверке пришлось бы
// убирать и файл, и запись, а между двумя удалениями всегда есть момент,
// когда реестр обещает инспектору документ, которого нет.
//
// Дыра, которую этот роут закрыть не может, и её надо назвать: тот, кто
// шлёт запросы мимо формы, может просто не позвать проверку. Файл-сирота
// без строки в базе в интерфейсе не появится нигде, но в публичном бакете
// `media` он останется доступен тому, кто знает полный путь. Окончательно
// это закрывается только сужением `allowed_mime_types` самого бакета —
// миграция, и она за владельцем `supabase/**`.

const HEAD_BYTES = 4096

export async function POST(req: Request) {
  let body: { bucket?: unknown; path?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const { bucket, path } = body
  if (!isBucketId(bucket) || !isStoragePath(path)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Первый сегмент пути — это ЯВНО НАЗВАННЫЙ арендатор (правило 1,
  // выраженное в имени объекта). Значит здесь ровно тот случай, который
  // база поймать не может: чужой путь в `documents` кончится отказом
  // политики, а в публичном `media` подписи нет вовсе — и обращение
  // к чужому закладу прошло бы бесследно.
  //
  // Отказ 403 ставится ДО похода в хранилище: до этой строки роут ходил
  // за чужим объектом и только потом получал 404, то есть отвечал
  // «файла нет» там, где верно «это не ваш заклад».
  const owner = path.split('/')[0]
  const mine = (await getMemberships()).some((m) => m.tenantId === owner)
  if (!mine) {
    await logForeignTenant(supabase, owner, {
      what: 'перевірка файлу чужого закладу',
      where: `POST /api/uploads/verify (${bucket})`,
    })
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Как добираемся до байтов — по-разному, и это следует из устройства
  // бакетов (0019), а не из удобства.
  //
  //   media     публичный: у объекта есть постоянный адрес, подписывать
  //             нечего. Читаем его напрямую — доступ к этим файлам и так
  //             у всех, никакой проверки этим шагом не обходится.
  //   documents приватный: только подписанная ссылка, и её выдача сама
  //             проходит через политику SELECT, то есть проверка
  //             арендатора уже сделана базой. Повторять её здесь нечем.
  //
  // Удаление негодного файла в обоих случаях идёт правами вошедшего,
  // так что чужой объект этим роутом не тронуть даже в публичном бакете.
  let source: string
  if (bucket === 'media') {
    source = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
  } else {
    const { data: signed, error: signError } = await supabase.storage
      .from(bucket).createSignedUrl(path, 60)
    if (signError || !signed?.signedUrl) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    source = signed.signedUrl
  }

  let declared = ''
  let size = 0
  let head: Uint8Array

  try {
    const res = await fetch(source, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`storage ${res.status}`)

    declared = res.headers.get('content-type') ?? ''

    // 206 отдаёт полный размер в Content-Range, 200 (файл короче куска) —
    // в Content-Length. Берём то, что пришло: размер считает хранилище,
    // а не форма, поэтому подделать его нельзя.
    const range = res.headers.get('content-range')
    const total = range?.split('/')[1]
    size = total && total !== '*'
      ? Number(total)
      : Number(res.headers.get('content-length') ?? 0)

    head = new Uint8Array(await res.arrayBuffer())
    if (!Number.isFinite(size) || size <= 0) size = head.length
  } catch {
    return NextResponse.json({ error: 'unreadable' }, { status: 502 })
  }

  const verdict = verifyUpload(bucket, declared, size, head)

  if (!verdict.ok) {
    // Файл не проходит — убираем сразу. Удаление идёт правами вошедшего:
    // если их нет, останется сирота без строки в базе, и это честнее,
    // чем удалять сервисным ключом мимо политик.
    await supabase.storage.from(bucket).remove([path])
    return NextResponse.json(
      { error: verdict.reason },
      { status: verdict.reason === 'size' ? 413 : 415 },
    )
  }

  return NextResponse.json({ ok: true, mime: verdict.mime, size })
}
