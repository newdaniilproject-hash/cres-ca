'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

import { DOC_KINDS as KINDS, type DocKind } from '@/lib/documents'
import {
  DOC_EXT_BY_MIME as EXT_BY_MIME,
  DOC_MAX_BYTES as MAX_BYTES,
} from '@/lib/upload/guard'
import { verifyUploaded } from '@/lib/upload/client'

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

type Material = {
  id: string; name: string; unit: string
  brand: string | null; isCosmetic: boolean
}
type Doc = {
  id: string; materialId: string; kind: DocKind
  title: string; path: string; createdAt: string
}

export function DocumentsClient({
  tenantId, userId, canWrite, canStock, materials, documents, loadError,
}: {
  tenantId: string; userId: string
  /** `compliance.write` — загрузка и удаление документов. */
  canWrite: boolean
  /** `stock.read` — есть ли у читателя раздел «Склад». */
  canStock: boolean
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
    if (uploadError) { setBusy(null); setErr(uploadError.message); return }

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
      setBusy(null); setErr(error.message); return
    }

    setBusy(null)
    setTitle(''); setFile(null); setFileKey((k) => k + 1)
    router.refresh()
  }

  // Бакет приватный: публичной ссылки у файла нет в принципе.
  // Пять минут — столько живёт доступ, дальше ссылка мертва даже
  // если её переслали. Сертификати та висновки СЕС назовні не віддаються.
  async function signedUrl(doc: Doc, filename?: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from('documents')
      .createSignedUrl(doc.path, 300, filename ? { download: filename } : undefined)
    if (error) { setErr(error.message); return null }
    return data?.signedUrl ?? null
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
    if (error) { setBusy(null); setErr(error.message); return }
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.path])
    setBusy(null)
    // Текст отказа хранилища подставляется КАК ЕСТЬ: это его сообщение,
    // а не наше, и в словарь оно не едет (CLAUDE.md → «Локализация»).
    if (storageError) {
      setErr(t('documents.error.fileKept', { error: storageError.message }))
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {/* «Склад» — только тем, у кого есть `stock.read`. У инспектора его
          нет (0035), и раздел молча вернул бы его на «Сьогодні». */}
      <div className="rise flex flex-wrap items-center gap-2">
        {canStock && (
          <Link href="/app/inventory" className="btn-ghost">{t('documents.nav.stock')}</Link>
        )}
        <Link href="/app/journals" className="btn-ghost">{t('documents.nav.journals')}</Link>
        <Link href="/app/techcards" className="btn-ghost">{t('documents.nav.techcards')}</Link>
      </div>

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {missing.length > 0 && (
        <div className="card-flat rise-1 flex flex-wrap items-center gap-3">
          <span className="badge-warn tabular">
            {t('documents.missing.badge', { n: t.number(missing.length) })}
          </span>
          <p className="t-md prose-muted">{t('documents.missing.desc')}</p>
        </div>
      )}

      {/* Форма загрузки — под `compliance.write`. Инспектор и наблюдатель
          читают документы, но не пополняют их: форма, которая гарантированно
          упрётся в RLS, обещает то, чего нет. */}
      {canWrite && (
      <form onSubmit={upload} className="card rise-1 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('documents.upload.material.label')}</label>
          <select required className="select" value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">{t('documents.upload.material.placeholder')}</option>
            {/* Назва і бренд засобу — данные заклада, не переводятся. */}
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.brand ? ` · ${m.brand}` : ''}
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
        <div>
          <label className="field-label">{t('documents.upload.file.label')}</label>
          <input key={fileKey} required type="file" className="input pt-2.5"
                 accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="field-hint">{t('documents.upload.file.hint')}</p>
        </div>
        <button className="btn-primary sm:col-span-2 sm:justify-self-start"
                disabled={busy === 'upload' || !file || !materialId || !title.trim()}>
          {busy === 'upload' ? t('documents.upload.submitBusy') : t('documents.upload.submit')}
        </button>
      </form>
      )}

      {materials.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>{t('documents.empty.title')}</p>
            <p className="prose-muted">{t('documents.empty.desc')}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {materials.map((m) => {
            const docs = byMaterial.get(m.id) ?? []
            return (
              <section key={m.id} className="card rise-2 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    {/* Название ведёт в карточку засоба. Для инспектора это
                        единственный вход в реестр: раздел «Склад» ему закрыт
                        (0035), а карточка, её документы и контроль вскрытия —
                        открыты по `compliance.read`. */}
                    <Link href={`/app/inventory/materials/${m.id}`}
                          className="display t-lg block">
                      {m.name}
                    </Link>
                    <p className="t-xs prose-muted">
                      {/* Бренд і одиниця виміру — данные засоба; переводится
                          только слово «одиниця». */}
                      {m.brand ? `${m.brand} · ` : ''}
                      {t('documents.material.unit', { unit: m.unit })}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    {m.isCosmetic && (
                      <span className="badge-accent">{t('documents.badge.cosmetic')}</span>
                    )}
                    {m.isCosmetic && docs.length === 0 ? (
                      <span className="badge-warn">{t('documents.badge.needDocs')}</span>
                    ) : (
                      <span className="badge tabular">
                        {t('documents.badge.count', { n: t.number(docs.length) })}
                      </span>
                    )}
                  </span>
                </div>

                {docs.length === 0 ? (
                  <div className="empty !py-6">{t('documents.docs.empty')}</div>
                ) : (
                  <div className="flex flex-col">
                    {docs.map((d) => (
                      <div key={d.id} className="row">
                        <div className="min-w-0">
                          {/* Назва документа — данные заклада. */}
                          <p className="t-md truncate">{d.title}</p>
                          <p className="tabular t-xs prose-muted">
                            {kindShort(t, d.kind)} · {t.date(d.createdAt, DAY)}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                          <button className="btn-ghost" disabled={busy === d.id}
                                  onClick={() => void view(d)}>{t('documents.doc.view')}</button>
                          <button className="btn-ghost" disabled={busy === d.id}
                                  onClick={() => void download(d)}>{t('documents.doc.download')}</button>
                          {canWrite && (
                            // Подпись для скринридера — из словаря, как
                            // и всё остальное: «✕» он не прочтёт.
                            <button className="btn-icon" aria-label={t('common.delete')}
                                    disabled={busy === d.id}
                                    onClick={() => void remove(d)}>✕</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <p className="field-hint rise-3">{t('documents.footer')}</p>
    </div>
  )
}
