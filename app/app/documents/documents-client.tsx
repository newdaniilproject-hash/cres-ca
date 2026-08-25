'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

import { DOC_KINDS as KINDS, documentSignedUrl, fmtSize, type DocKind } from '@/lib/documents'
import { Sheet } from '@/components/sheet'
import { IconAlert, IconBeaker, IconDoc, IconLayers, IconPlus } from '@/components/icons'
import {
  DOC_EXT_BY_MIME as EXT_BY_MIME,
  DOC_MAX_BYTES as MAX_BYTES,
} from '@/lib/upload/guard'
import { verifyUploaded } from '@/lib/upload/client'
import { dbErrorText } from '@/lib/errors/db'

export type { DocKind }

// Вид документа — значение перечисления `material_doc_kind` (0014).
// Само значение (`msds`) не переводится никогда: по нему сверяется база.
// Переводится ПОДПИСЬ, и живёт она в словаре — полная для выпадающего
// списка (`documents.kind.msds`) и короткая для строки (`…​.short`).
//
// Из `lib/documents.ts` берётся только ПОРЯДОК и набор значений. Два
// украинских списка подписей, что лежали там раньше (`DOC_KINDS[].label`
// и `DOC_KIND_LABEL`), удалены 16.08.2026 вместе с переводом второго
// экрана документов: подписи обязаны иметь один источник, и это словарь.
const kindLabel = (t: T, k: DocKind): string => t(`documents.kind.${k}`)
const kindShort = (t: T, k: DocKind): string => t(`documents.kind.${k}.short`)

// Дата загрузки — «12 січ. 2024». Набор опций, а не своя `fmt`:
// форматирует `t.date`, то есть локаль, а не экран.
const DAY: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', year: 'numeric',
}

// Дата и время загрузки — «12 січ., 14:05». Колонка «Оновлено» в таблице
// десктопа: на широком экране есть где показать час, а у документов, которые
// заливают пачкой в один день, час — единственное, что их различает.
const AT: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}

type Material = {
  id: string; name: string; unit: string
  brand: string | null; isCosmetic: boolean
  /** Код нотифікації МОЗ — це СЛОВА постачальника (ТЗ 3.1). */
  notificationCode: string | null
  /** Коли підтверджено ДОКУМЕНТОМ (0106). null — лише слова. */
  notificationConfirmedAt: string | null
}
type Doc = {
  id: string; materialId: string; kind: DocKind
  title: string; path: string; createdAt: string
  /** Размер и тип файла (0059). Могут быть пустыми у старых загрузок. */
  size: number | null; mime: string | null
  /**
   * Имя загрузившего. Null значит «имя не достаётся» — человека вывели
   * из состава команды (оговорка 0083), а не «документ загрузил никто»:
   * колонка `uploaded_by` объявлена `not null` ещё в 0014.
   */
  uploader: string | null
}

// Плашка расширения в строке документа (README: «плашка PDF 38px,
// 10px/800, danger на dangerSoft»). Расширение берётся из типа файла,
// а не из имени: имя даёт человек, и «договір.pdf.docx» встречается.
function extOf(mime: string | null): string {
  if (!mime) return 'FILE'
  if (mime.includes('pdf')) return 'PDF'
  if (mime.includes('word')) return 'DOC'
  if (mime.startsWith('image/')) return mime.slice(6, 10).toUpperCase()
  return 'FILE'
}

export function DocumentsClient({
  tenantId, userId, canWrite, materials, documents, loadError,
}: {
  tenantId: string; userId: string
  /** `compliance.write` — загрузка и удаление документов. */
  canWrite: boolean
  materials: Material[]; documents: Doc[]; loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [materialId, setMaterialId] = useState('')
  const [kind, setKind] = useState<DocKind>('msds')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Сброс неуправляемого input[type=file] после успешной загрузки.
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // Форма загрузки — шторкой, а не блоком на странице (README: «кнопка
  // "Завантажити документ"»). Пять полей занимали первый экран телефона,
  // а документы, ради которых сюда заходят, начинались за сгибом.
  // Загружают раз в месяц, смотрят — на каждой проверке.
  const [uploading, setUploading] = useState(false)

  const byMaterial = useMemo(() => {
    const map = new Map<string, Doc[]>()
    for (const d of documents) {
      const list = map.get(d.materialId)
      if (list) list.push(d)
      else map.set(d.materialId, [d])
    }
    return map
  }, [documents])

  // Косметика без единого документа — то, из-за чего приходит предписание.
  const missing = materials.filter((m) => m.isCosmetic && !byMaterial.has(m.id))

  // Название засоба по его id — для колонки «Засіб» в таблице десктопа.
  // Таблица плоская (документы всех засобів одним списком по дате), поэтому
  // название приходится доставать, а не наследовать от секции, как на телефоне.
  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  )

  // ── CRESKO Web: метрики экрана ───────────────────────────────────────────
  // Пять плиток README — но только те, что считаются из НАШИХ данных.
  // Плитки «термін документа спливає» здесь нет и быть не может: срока
  // действия у `material_documents` не существует ни колонкой, ни смыслом
  // (MSDS и висновок СЕС бессрочны), а плитка, считающая ноль из ничего,
  // — это обещание следить за тем, за чем система не следит.
  const metrics = [
    {
      key: 'total', label: t('documents.web.metric.total'), n: documents.length,
      tone: 'blue' as const, icon: IconDoc, note: '',
    },
    {
      key: 'msds', label: t('documents.web.metric.msds'),
      n: documents.filter((d) => d.kind === 'msds').length,
      tone: 'violet' as const, icon: IconBeaker, note: '',
    },
    {
      key: 'materials', label: t('documents.web.metric.materials'), n: materials.length,
      tone: 'emerald' as const, icon: IconLayers, note: '',
    },
    {
      key: 'cosmetic', label: t('documents.web.metric.cosmetic'),
      n: materials.filter((m) => m.isCosmetic).length,
      tone: 'amber' as const, icon: IconLayers, note: '',
    },
    {
      key: 'missing', label: t('documents.web.metric.missing'), n: missing.length,
      tone: 'rose' as const, icon: IconAlert,
      // Примечание только у той плитки, где оно говорит, что делать.
      note: missing.length > 0 ? t('documents.badge.needDocs') : '',
    },
  ]

  // Колонки таблицы CRESKO Web. Единственное место, где размер задаётся
  // строкой, — так велит `.wtable`: сетку задаёт экран, а не класс.
  // Последняя колонка фиксированной ширины: в ней «Завантажити» (btn-ghost,
  // около 108px) и крестик (btn-icon, 44px по --tap-min). Доля вместо
  // пикселей сжимала бы кнопки на узком ноутбуке, и подпись переносилась бы.
  const WGRID = '2.4fr 1.1fr 1.3fr 1fr 1.1fr 168px'

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !materialId) return
    const ext = EXT_BY_MIME[file.type]
    if (!ext) {
      setErr(t('documents.error.mime'))
      return
    }
    if (file.size > MAX_BYTES) {
      setErr(t('documents.error.tooBig'))
      return
    }

    // Первый сегмент пути — tenant_id: политики хранилища разбирают
    // владельца именно из имени объекта (storage_tenant в 0019),
    // своей колонки у storage.objects нет. Любой другой префикс —
    // отказ в загрузке. Имя файла случайное: оригинальное может
    // содержать кириллицу и пробелы, которых ключ объекта не терпит.
    const path = `${tenantId}/materials/${materialId}/${crypto.randomUUID()}.${ext}`

    setBusy('upload'); setErr('')
    const { error: uploadError } = await supabase.storage
      .from('documents').upload(path, file, { contentType: file.type })
    if (uploadError) { setBusy(null); setErr(dbErrorText(t, uploadError)); return }

    // Проверка на сервере, и она ЗДЕСЬ, до строки в реестре. Всё, что
    // выше, — слово браузера: и `file.type`, и `file.size` приходят
    // из формы, а форму можно обойти. Роут читает первые байты уже
    // сохранённого объекта, сверяет их с объявленным типом и, если
    // не сошлось, сам удаляет файл. Разбор — app/api/uploads/verify.
    const rejected = await verifyUploaded('documents', path)
    if (rejected) {
      setBusy(null); setErr(t(`upload.reject.${rejected}`)); return
    }

    const { error } = await supabase.from('material_documents').insert({
      tenant_id: tenantId, material_id: materialId,
      kind, title: title.trim(), path, uploaded_by: userId,
      // Размер и тип пишет загрузчик (0059): иначе список документов
      // ходил бы в хранилище за каждой строкой ради подписи «1,2 МБ».
      size_bytes: file.size, mime: file.type,
    })
    if (error) {
      // Файл без учётной записи невидим и неудаляем через интерфейс —
      // убираем сразу, чтобы не копить мусор в приватном бакете.
      await supabase.storage.from('documents').remove([path])
      setBusy(null); setErr(dbErrorText(t, error)); return
    }

    setBusy(null)
    setTitle(''); setFile(null); setFileKey((k) => k + 1)
    setUploading(false)
    router.refresh()
  }

  // Ссылка живёт пять минут и выдаётся через `document_access` (0090):
  // она же проверяет право и она же пишет строку в журнал доступа.
  // Разбор — в `lib/documents.ts`; здесь копии этой логики быть не должно,
  // потому что экранов с документами два.
  async function signedUrl(doc: Doc, filename?: string): Promise<string | null> {
    const { url, error } = await documentSignedUrl(supabase, tenantId, doc, filename)
    if (error) { setErr(error); return null }
    return url
  }

  async function view(doc: Doc) {
    setErr('')
    // Вкладку открываем ДО await: окно, появившееся после асинхронного
    // ответа, браузер считает непрошеным и блокирует.
    const tab = window.open('', '_blank')
    setBusy(doc.id)
    const url = await signedUrl(doc)
    setBusy(null)
    if (!url) { tab?.close(); return }
    if (tab) tab.location.href = url
    else window.location.href = url
  }

  async function download(doc: Doc) {
    setErr('')
    setBusy(doc.id)
    const ext = doc.path.split('.').pop() ?? 'pdf'
    // Имя для сохранения задаёт хранилище заголовком Content-Disposition:
    // атрибут download у ссылки на чужой домен браузер игнорирует.
    // Слэши из названия убираем — иначе имя файла обрежется по последнему.
    const safeTitle = doc.title.replace(/[\\/]+/g, '-')
    const url = await signedUrl(doc, `${safeTitle}.${ext}`)
    setBusy(null)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function remove(doc: Doc) {
    // Назва документа — данные арендатора, она приезжает подстановкой.
    if (!window.confirm(t('documents.remove.confirm', { title: doc.title }))) return
    setBusy(doc.id); setErr('')
    // Сначала запись, потом файл. Обратный порядок опаснее: строка
    // реестра, которая обещает инспектору документ, а файла уже нет, —
    // хуже, чем файл, на который никто не ссылается.
    const { error } = await supabase.from('material_documents').delete().eq('id', doc.id)
    if (error) { setBusy(null); setErr(dbErrorText(t, error)); return }
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.path])
    setBusy(null)
    // Текст отказа хранилища подставляется КАК ЕСТЬ: это его сообщение,
    // а не наше, и в словарь оно не едет (CLAUDE.md → «Локализация»).
    if (storageError) {
      setErr(t('documents.error.fileKept', { error: dbErrorText(t, storageError) }))
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Ряда ссылок «Склад · Журнали · Техкарти» здесь больше нет:
          все три раздела лежат под аватаром, и держать второй вход
          в них на этом экране значит дублировать навигацию. Ссылка
          на склад к тому же рисовалась не всем (у инспектора нет
          `stock.read`), и ряд у него был из двух кнопок неизвестно
          куда. Единственное действие экрана — загрузить документ,
          и оно теперь одно и на виду. */}
      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, которым его называет панель
          и вкладка браузера; справа — то же единственное действие,
          что и на телефоне. Кнопка одна на обе раскладки по смыслу,
          но не по разметке: на телефоне она во всю ширину под шапкой,
          на вебе — в правом углу хедера. */}
      <div className="hidden items-center justify-between gap-4 lg:flex">
        {/* §14: H1 со значком документа и подписью. Плашка 44px акцентом —
            тот же хедер, что у «Клієнтів», «Фінансів» и «Техкарт»: один
            приём на все экраны кабинета, а не свой у каждого. Значок
            повторяет плитку «Всього документів» ниже намеренно — это
            один и тот же предмет, и в макете хендоффа он тот же самый.
            Подпись — ключ, которым раздел описан в шторке профиля. */}
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconDoc size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1" data-size="27">{t('app.screen.documents.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.documents.desc')}
            </p>
          </div>
        </div>
        {canWrite && (
          // Кнопка со split-chevron из §14 здесь без шеврона: он
          // открывает список ВТОРЫХ действий («створити з шаблону»
          // и т.п.), а действие тут ровно одно. Шеврон, ничего
          // не открывающий, — сломанная навигация.
          <button type="button" className="btn-primary shrink-0"
                  onClick={() => { setErr(''); setUploading(true) }}>
            <IconPlus size={18} />
            {t('documents.upload.submit')}
          </button>
        )}
      </div>

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Плитки не нажимаются: фильтра по ним на этом экране нет,
          а плитка, которая выглядит кнопкой и ничего не делает, —
          сломанная навигация.

          Пять в ряд только с 1280px. На 1024 у кабинета остаётся
          728px после сайдбара — по 132px на плитку, и подпись
          «Косметика без документів» встаёт в три строки, ломая ряд
          об одну плитку. До xl их три. */}
      <section className="rise hidden gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-5">
        {metrics.map((s) => (
          // ⚠️ РАСКЛАДКА ПЛИТКИ ЗДЕСЬ ДРУГАЯ, ЧЕМ НА СКЛАДЕ, и это
          // не самодеятельность: §8 хендоффа ставит подпись слева,
          // а плашку справа, §14 — плашку И подпись ОДНОЙ СТРОКОЙ
          // сверху, число под ними. Класс `.wmetric` даёт поверхность,
          // рамку, радиус и отступы (одни на все экраны); направление
          // оси перекрывается здесь, потому что правило внутри
          // media-запроса не перебивается утилитой Tailwind (М43).
          <div key={s.key} className="wmetric"
               style={{
                 flexDirection: 'column', alignItems: 'stretch',
                 justifyContent: 'flex-start',
               }}>
            <span className="flex items-center gap-2.5">
              <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
              <span className="wmetric-label min-w-0">{s.label}</span>
            </span>
            <span className="wmetric-value tabular mt-2.5 block">{t.number(s.n)}</span>
            {s.note && <span className="wmetric-note mt-0.5 block">{s.note}</span>}
          </div>
        ))}
      </section>

      {/* ⚠️ ПОЛОСЫ «без документів: N» здесь БОЛЬШЕ НЕТ, и это не потеря.
          Она говорила ровно то, что уже сказано дважды: на lg — плиткой
          «Косметика без документів», на телефоне — жёлтой меткой у самого
          засоба, которому документов не хватает. Три места об одном
          и том же, причём полоса единственная из трёх НЕ показывала,
          О КАКОМ засобе речь: прочитав её, всё равно надо было идти
          глазами по списку. Тот же разбор, что и на складе: сколько раз
          на экране лежит одно и то же и есть ли выход у каждого числа. */}

      {materials.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>{t('documents.empty.title')}</p>
            <p className="prose-muted">{t('documents.empty.desc')}</p>
          </div>
        </div>
      ) : (
        <>
        {/* ── CRESKO Web: документы таблицей (только lg) ─────────
            Список плоский и отсортирован по дате загрузки — так его
            и отдаёт страница. Группировка по засобу, как на телефоне,
            здесь была бы двадцатью таблицами по две строки; вместо
            неё колонка «Засіб», по которой сортирует глаз.

            Засоби БЕЗ документов в таблицу не попадают — их видно
            плиткой «Косметика без документів» выше и полосой ниже:
            строка-пустышка в списке документов означала бы, что
            документ есть, просто он пустой. */}
        <section className="hidden lg:block">
          <div className="wtable">
            <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
              <span>{t('documents.web.table.document')}</span>
              <span>{t('documents.web.table.kind')}</span>
              <span>{t('documents.web.table.material')}</span>
              <span>{t('documents.web.table.author')}</span>
              <span>{t('documents.web.table.updated')}</span>
              <span>{t('documents.web.table.actions')}</span>
            </div>
            {documents.length === 0 ? (
              <div className="empty">{t('documents.docs.empty')}</div>
            ) : documents.map((d) => {
              const mt = materialById.get(d.materialId)
              return (
                <div key={d.id} className="wtable-row" style={{ gridTemplateColumns: WGRID }}>
                  {/* Ячейка названия — кнопка «переглянути», то есть
                      ровно то действие, которым строка открывается
                      на телефоне. Строка целиком кнопкой быть не может:
                      справа живут ещё две, а кнопка внутри кнопки
                      недопустима. Зона нажатия — `--tap-min`: тем же
                      экраном пользуются с планшета. */}
                  <button type="button" disabled={busy === d.id}
                          onClick={() => void view(d)}
                          className="flex min-w-0 items-center gap-3 text-left"
                          style={{ minHeight: 'var(--tap-min)' }}>
                    <span aria-hidden className="doc-ext"
                          data-tone={extOf(d.mime) === 'PDF' ? 'danger' : undefined}>
                      {extOf(d.mime)}
                    </span>
                    <span className="min-w-0">
                      {/* Назва документа — данные заклада. */}
                      <span className="block truncate font-semibold"
                            style={{ color: 'var(--color-text)' }}>{d.title}</span>
                      {d.size !== null && (
                        <span className="tabular block truncate"
                              style={{ color: 'var(--color-faint)' }}>
                          {fmtSize(t, d.size)}
                        </span>
                      )}
                    </span>
                  </button>
                  <span><span className="badge">{kindShort(t, d.kind)}</span></span>
                  <span className="min-w-0">
                    {mt
                      ? (
                        // Название ведёт в карточку засоба — тот же адрес,
                        // что и заголовок секции на телефоне.
                        <Link href={`/app/inventory/materials/${mt.id}`}
                              className="block truncate"
                              style={{ color: 'var(--color-accent-ink)' }}>
                          {mt.name}
                        </Link>
                      )
                      : t('common.noValue')}
                  </span>
                  <span className="truncate">
                    {d.uploader ?? (
                      <span title={t('documents.web.uploader.gone.title')}>
                        {t('documents.web.uploader.gone')}
                      </span>
                    )}
                  </span>
                  <span className="tabular">{t.dateTime(d.createdAt, AT)}</span>
                  <span className="flex items-center gap-1">
                    <button className="btn-ghost" disabled={busy === d.id}
                            onClick={() => void download(d)}>
                      {t('documents.doc.download')}
                    </button>
                    {canWrite && (
                      // Подпись для скринридера — из словаря: «✕» он не прочтёт.
                      <button className="btn-icon" aria-label={t('common.delete')}
                              disabled={busy === d.id}
                              onClick={() => void remove(d)}>✕</button>
                    )}
                  </span>
                </div>
              )
            })}
            {documents.length > 0 && (
              <div className="wtable-foot">
                <span className="tabular">
                  {t('documents.web.table.total', { n: t.number(documents.length) })}
                </span>
              </div>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:hidden">
          {materials.map((m) => {
            const docs = byMaterial.get(m.id) ?? []
            return (
              <section key={m.id} className="card rise-2 flex flex-col gap-3">
                {/* Мітки — РЯДКОМ ПІД назвою, а не праворуч від неї.
                    Праворуч їх ставили, поки мітка була одна; з двома
                    вони вставали рваними сходинками, бо вирівнювались
                    по правому краю різної довжини. Це той самий випадок,
                    що й з крапками-роздільниками: на 390px усе, що
                    переноситься, треба класти рядком. */}
                <div className="flex flex-col gap-2">
                  <div>
                    {/* Название ведёт в карточку засоба. Для инспектора это
                        единственный вход в реестр: раздел «Склад» ему закрыт
                        (0035), а карточка, её документы и контроль вскрытия —
                        открыты по `compliance.read`. */}
                    <Link href={`/app/inventory/materials/${m.id}`}
                          className="display t-lg block">
                      {m.name}
                    </Link>
                    {/* Бренд — данные засоба. Одиниці виміру здесь больше
                        нет: «шт» или «л» не говорит о документах ничего,
                        а строку под названием занимала на каждом засобе. */}
                    {m.brand && <p className="t-xs prose-muted">{m.brand}</p>}
                  </div>
                  {/* ⚠️ МЕТКА ОСТАЛАСЬ ОДНА, И ТОЛЬКО КОГДА ЕЙ ЕСТЬ ЧТО
                      СКАЗАТЬ. Было три сообщения об одном: бейдж
                      «косметика» (он объяснял, почему нужны документы),
                      бейдж «документів: N» (их и так видно списком ниже)
                      и жёлтое «потрібні документи». На 390px эта пара
                      переносилась под название и съедала строку у каждого
                      засоба. Остался жёлтый — единственный, который зовёт
                      что-то сделать. */}
                  <span className="flex flex-wrap gap-1.5">
                    {m.isCosmetic && docs.length === 0 && (
                      <span className="badge-warn">
                        {t('documents.badge.needDocs')}
                      </span>
                    )}
                    {/* ── СТАН НОТИФІКАЦІЇ МОЗ (ТЗ 2 і 3.1) ───────────
                        Це ГОЛОВНИЙ екран інспектора, і ТЗ 2 називає серед
                        того, що він відкриває, «нотифікації МОЗ». Досі
                        екран показував назву, бренд і документи — щоб
                        дізнатись стан, перевіряючий мав зайти в кожну
                        картку окремо. Знайдено рендером 25.08.2026.

                        Три стани, а не два, бо їх справді три:
                        підтверджено ДОКУМЕНТОМ (0106) — зелене; є лише
                        код, тобто СЛОВА постачальника, — жовте; немає
                        нічого — червоне. Різницю між кодом і документом
                        перевірка й дивиться першою; звести їх в одне
                        значить відповісти не на те питання.

                        Тільки косметиці: у гумок і шпильок нотифікації
                        не буває, і «немає коду» на них читалось би як
                        порушення там, де його немає. */}
                    {m.isCosmetic && (
                      m.notificationConfirmedAt
                        ? <span className="badge-success">{t('documents.moz.ok')}</span>
                        : m.notificationCode
                          ? <span className="badge-warn">{t('documents.moz.codeOnly')}</span>
                          : <span className="badge-danger">{t('documents.moz.none')}</span>
                    )}
                  </span>
                </div>

                {docs.length === 0 ? (
                  // У косметики про это уже сказала жёлтая метка выше —
                  // второй раз то же самое не пишем.
                  m.isCosmetic ? null : (
                    <p className="t-sm prose-muted">{t('documents.docs.empty')}</p>
                  )
                ) : (
                  <div className="flex flex-col">
                    {/* ⚠️ У СТРОКИ ОДНО ДЕЙСТВИЕ, А НЕ ТРИ.
                        Было: «Переглянути» · «Завантажити» · «✕» рядом
                        с плашкой и двумя строками текста. На 390px это
                        оставляло названию документа около ста пикселей,
                        и «Висновок СЕС · 793 КБ · 14 бер. 2026 р.» вставало
                        в ШЕСТЬ строк — то есть кнопки вытеснили то, ради
                        чего строка нужна.

                        Осталось открытие: на телефоне «переглянути»
                        и «завантажити» — одно и то же действие, ссылка
                        всё равно уходит в системный просмотрщик, откуда
                        файл и сохраняют. Кнопка «Завантажити» осталась
                        на широком экране, где для неё есть колонка и где
                        сохранение в папку — это правда отдельный шаг.

                        Строка НЕ одна большая кнопка: справа живёт
                        удаление, а кнопка внутри кнопки недопустима. */}
                    {docs.map((d) => (
                      <div key={d.id} className="row">
                        <button type="button" disabled={busy === d.id}
                                onClick={() => void view(d)}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                style={{ minHeight: 'var(--tap-min)' }}>
                          {/* README: плашка расширения слева — по ней строка
                              читается как файл, а не как ещё один пункт
                              списка. Тон `danger` у PDF из макета сохранён:
                              это его цвет во всех файловых менеджерах. */}
                          <span aria-hidden className="doc-ext"
                                data-tone={extOf(d.mime) === 'PDF' ? 'danger' : undefined}>
                            {extOf(d.mime)}
                          </span>
                          <span className="min-w-0 flex-1">
                            {/* Назва документа — данные заклада. */}
                            <span className="t-md clamp-2 block">{d.title}</span>
                            {/* README (`stockDocs`): «{розмір} · додано {дата}»
                                — и ровно это, без вида документа.
                                ⚠️ ВИД ЗДЕСЬ БЫЛ И СНЯТ 19.08.2026 КАК ДУБЛЬ:
                                название документа человек пишет сам, и форма
                                загрузки подсказывает ему ровно вид, поэтому
                                в строке выходило «Висновок СЕС / Висновок СЕС ·
                                932 КБ», «Паспорт безпеки (MSDS) / MSDS · 1,2 МБ».
                                Вид остался там, где он не повторяет название:
                                в форме загрузки и в колонке «Тип» таблицы
                                широкого экрана. */}
                            <span className="tabular t-xs prose-muted mt-0.5 block truncate">
                              {d.size !== null ? `${fmtSize(t, d.size)} — ` : ''}
                              {t('documents.doc.added', { date: t.date(d.createdAt, DAY) })}
                            </span>
                          </span>
                        </button>
                        {canWrite && (
                          // Подпись для скринридера — из словаря, как
                          // и всё остальное: «✕» он не прочтёт.
                          <button className="btn-icon shrink-0" aria-label={t('common.delete')}
                                  disabled={busy === d.id}
                                  onClick={() => void remove(d)}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}

          {/* Кнопка ПОСЛЕ списка, как в хендоффе, и обводкой, а не
              заливкой. Причина названа в шапке файла: документы
              загружают раз в месяц, а смотрят на каждой проверке —
              значит первый экран принадлежит документам. Сплошной
              кобальт во всю ширину над списком забирал этот экран
              себе и кричал громче того, ради чего сюда заходят. */}
          {canWrite && (
            <button type="button" className="btn-secondary"
                    style={{
                      borderColor: 'var(--color-accent)',
                      color: 'var(--color-accent-ink)',
                    }}
                    onClick={() => { setErr(''); setUploading(true) }}>
              {t('documents.upload.submit')}
            </button>
          )}
        </div>
        </>
      )}

      {/* ── Загрузка документа ────────────────────────────────
          Под `compliance.write`. Инспектор и наблюдатель читают
          документы, но не пополняют их: форма, которая гарантированно
          упрётся в RLS, обещает то, чего нет. */}
      <Sheet open={uploading} onClose={() => setUploading(false)}
             title={t('documents.upload.submit')}>
        {err && <p className="field-error mb-3">{err}</p>}
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('documents.upload.material.label')}</label>
          <select required className="select" value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">{t('documents.upload.material.placeholder')}</option>
            {/* Назва і бренд засобу — данные заклада, не переводятся. */}
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.brand ? ` — ${m.brand}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">{t('documents.upload.kind.label')}</label>
          <select className="select" value={kind}
                  onChange={(e) => setKind(e.target.value as DocKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{kindLabel(t, k)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">{t('documents.upload.title.label')}</label>
          <input required className="input" placeholder={t('documents.upload.title.placeholder')}
                 value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-hint">{t('documents.upload.title.hint')}</p>
        </div>
        {/* `min-w-0` — иначе имя выбранного файла (одно длинное слово)
            задаёт минимальную ширину колонки грида, и шторка уезжает
            вправо вместе со всеми полями: `truncate` на самой подписи
            при этом не срабатывает, потому что обрезать нечего —
            колонка растянулась под неё. */}
        <div className="min-w-0">
          <label className="field-label">{t('documents.upload.file.label')}</label>
          {/* ⚠️ ГОЛОЕ `input[type=file]` СЮДА НЕ ВОЗВРАЩАТЬ. Его рисует
              ОПЕРАЦИОННАЯ СИСТЕМА — своим шрифтом и своим языком:
              на телефоне владельца посреди украинского кабинета стояло
              русское «Выбрать файл, файл не выбран» (20.08.2026).
              Классом это не чинится ни в одном движке.

              Поле в `sr-only`, а не в `hidden`: так оно остаётся
              доступным с клавиатуры и для чтения с экрана, а нажимают
              на нашу кнопку — `label` открывает выбор файла и на
              телефоне тоже. `required` снято намеренно: невидимое
              обязательное поле Chrome не может подсветить («invalid
              form control is not focusable»), а без файла кнопка
              отправки и так заперта. */}
          <label className="btn-secondary w-fit max-w-full cursor-pointer">
            <span className="min-w-0 truncate">
              {file ? file.name : t('inventory.docs.add')}
            </span>
            <input key={fileKey} type="file" className="sr-only"
                   accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="field-hint">{t('documents.upload.file.hint')}</p>
        </div>
        <button className="btn-primary sm:col-span-2 sm:justify-self-start"
                disabled={busy === 'upload' || !file || !materialId || !title.trim()}>
          {busy === 'upload' ? t('documents.upload.submitBusy') : t('documents.upload.submit')}
        </button>
      </form>
      </Sheet>

      <p className="field-hint rise-3">{t('documents.footer')}</p>
    </div>
  )
}
