'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { DOC_KINDS, documentSignedUrl, fmtSize, type DocKind } from '@/lib/documents'
import { DOC_EXT_BY_MIME, DOC_MAX_BYTES } from '@/lib/upload/guard'
import { verifyUploaded } from '@/lib/upload/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

type Doc = {
  id: string; kind: DocKind; title: string; path: string
  size: number | null; mime: string | null; createdAt: string
}
type Material = {
  id: string; name: string; brand: string | null; isCosmetic: boolean
  notificationCode: string | null
  notificationUrl: string | null
  notificationDate: string | null
}

// Вид документа — значение перечисления `material_doc_kind` (0014).
// Само значение (`msds`) не переводится: по нему сверяется база.
// Переводится ПОДПИСЬ — полная в выпадающем списке загрузки, короткая
// в фильтрах и строках.
//
// Ключи взяты ТЕ ЖЕ, что на экране всех документов (`documents.kind.*`,
// см. шапку `app/app/documents/documents-client.tsx`): это подписи одного
// перечисления, и второй их набор разъехался бы с первым на первой же
// правке. Из `lib/documents.ts` приходит только НАБОР значений и порядок —
// украинские списки подписей оттуда удалены 16.08.2026, когда их перестал
// читать последний экран.
const kindLabel = (t: T, k: DocKind): string => t(`documents.kind.${k}`)
const kindShort = (t: T, k: DocKind): string => t(`documents.kind.${k}.short`)

// Фильтры ровно как на макете: «Всі», потом виды, у которых есть файлы.
// Пустой вид в полосе фильтров — обещание, за которым ничего нет.
const FILTERS: ('all' | DocKind)[] = [
  'all', 'msds', 'quality_cert', 'ses_conclusion', 'notification', 'other',
]

export function MaterialDocs({
  tenantId, userId, canWrite, canEditMoz, material, docs, loadError,
}: {
  tenantId: string
  userId: string
  /** `compliance.write` — загрузка и удаление самих документов. */
  canWrite: boolean
  /**
   * `stock.write` — правка полей нотификации МОЗ. Они лежат в `materials`,
   * а её политика `materials_update` (0003) требует складского права,
   * не компланс-ового. Кнопка под чужим правом означала бы отказ RLS
   * после заполнения формы.
   */
  canEditMoz: boolean
  material: Material
  docs: Doc[]
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  const [filter, setFilter] = useState<'all' | DocKind>('all')
  const [add, setAdd] = useState(false)
  const [moz, setMoz] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [kind, setKind] = useState<DocKind>('msds')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length }
    for (const d of docs) c[d.kind] = (c[d.kind] ?? 0) + 1
    return c
  }, [docs])

  const shown = filter === 'all' ? docs : docs.filter((d) => d.kind === filter)

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    const ext = DOC_EXT_BY_MIME[file.type]
    if (!ext) {
      toast.error(t('inventory.docs.error.format.title'), t('inventory.docs.error.format.desc'))
      return
    }
    if (file.size > DOC_MAX_BYTES) {
      toast.error(t('inventory.docs.error.size.title'), t('inventory.docs.error.size.desc'))
      return
    }

    // Первый сегмент пути — tenant_id: политики хранилища разбирают
    // владельца именно из имени объекта (storage_tenant в 0019).
    // Имя файла случайное: оригинальное может содержать кириллицу
    // и пробелы, которых ключ объекта не терпит.
    const path = `${tenantId}/materials/${material.id}/${crypto.randomUUID()}.${ext}`

    setBusy('upload')
    const { error: uploadError } = await supabase.storage
      .from('documents').upload(path, file, { contentType: file.type })
    if (uploadError) {
      setBusy(null)
      toast.error(t('inventory.docs.error.upload'), uploadError.message)
      return
    }

    // Проверка на сервере, и она ЗДЕСЬ, до строки в реестре: см.
    // app/api/uploads/verify. Форма проверила слово браузера, роут —
    // сами байты уже сохранённого файла.
    const rejected = await verifyUploaded('documents', path)
    if (rejected) {
      setBusy(null)
      toast.error(t('inventory.docs.error.upload'), t(`upload.reject.${rejected}`))
      return
    }

    const { error } = await supabase.from('material_documents').insert({
      tenant_id: tenantId, material_id: material.id,
      kind, title: title.trim() || file.name, path, uploaded_by: userId,
      size_bytes: file.size, mime: file.type,
    })
    if (error) {
      // Файл без учётной записи невидим и неудаляем через интерфейс —
      // убираем сразу, чтобы не копить мусор в приватном бакете.
      await supabase.storage.from('documents').remove([path])
      setBusy(null)
      toast.error(t('inventory.docs.error.record'), error.message)
      return
    }

    setBusy(null)
    setTitle(''); setFile(null); setFileKey((k) => k + 1); setAdd(false)
    toast.success(t('inventory.docs.uploaded'))
    router.refresh()
  }

  // Ссылка живёт пять минут и выдаётся через `document_access` (0090):
  // она же проверяет право и она же пишет строку в журнал доступа.
  // Разбор — в `lib/documents.ts`; здесь копии этой логики быть не должно,
  // потому что экранов с документами два.
  async function signedUrl(doc: Doc, filename?: string): Promise<string | null> {
    const { url, error } = await documentSignedUrl(supabase, tenantId, doc, filename)
    if (error) { toast.error(t('inventory.docs.error.open'), error); return null }
    return url
  }

  async function view(doc: Doc) {
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
    setBusy(doc.id)
    const ext = doc.path.split('.').pop() ?? 'pdf'
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
    if (!window.confirm(t('inventory.docs.delete.confirm', { title: doc.title }))) return
    setBusy(doc.id)
    // Сначала запись, потом файл. Обратный порядок опаснее: строка
    // реестра, которая обещает инспектору документ, а файла уже нет, —
    // хуже, чем файл, на который никто не ссылается.
    const { error } = await supabase.from('material_documents').delete().eq('id', doc.id)
    if (error) { setBusy(null); toast.error(t('inventory.docs.error.delete'), error.message); return }
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.path])
    setBusy(null)
    if (storageError) {
      toast.warn(t('inventory.docs.deleted.partial'),
        `${t('inventory.docs.storageLeft')}: ${storageError.message}`)
    } else toast.success(t('inventory.docs.deleted'))
    router.refresh()
  }

  async function saveMoz(f: { code: string; url: string; date: string }) {
    const url = f.url.trim()
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error(t('inventory.docs.moz.urlError'))
      return
    }
    setBusy('moz')
    const { error } = await supabase.from('materials').update({
      notification_code: f.code.trim() || null,
      notification_url: url || null,
      notification_date: f.date || null,
    }).eq('id', material.id)
    setBusy(null)
    if (error) { toast.error(t('inventory.docs.moz.saveError'), error.message); return }
    setMoz(false)
    toast.success(t('inventory.docs.moz.saved'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-sm rise" style={{ color: 'var(--color-muted)' }}>
        {material.name}{material.brand ? ` · ${material.brand}` : ''}
      </p>

      {loadError && <p className="field-error rise">{loadError}</p>}

      {/* ── Фильтры по виду ──────────────────────────────────── */}
      <div className="rise-1 flex flex-wrap gap-2">
        {FILTERS.filter((f) => f === 'all' || (counts[f] ?? 0) > 0).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
                  className={filter === f ? 'chip-active' : 'chip'}>
            {f === 'all' ? t('inventory.docs.filter.all') : kindShort(t, f)}
            {' '}{t.number(counts[f] ?? 0)}
          </button>
        ))}
        {canWrite && (
          <button type="button" className="btn-primary ml-auto t-sm"
                  onClick={() => setAdd(true)}>{t('inventory.docs.add')}</button>
        )}
      </div>

      {/* ── Список файлов ────────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            {docs.length === 0
              ? t('inventory.docs.empty.none')
              : t('inventory.docs.empty.filter')}
            {canWrite && docs.length === 0 && (
              <button type="button" className="btn-primary" onClick={() => setAdd(true)}>
                {t('inventory.docs.uploadFirst')}
              </button>
            )}
          </div>
        ) : shown.map((d) => (
          <div key={d.id} className="row px-5">
            <button type="button" onClick={() => void view(d)}
                    disabled={busy === d.id}
                    className="min-w-0 flex-1 text-left"
                    style={{ minHeight: 'var(--tap-min)' }}>
              <span className="t-md block truncate">{d.title}</span>
              <span className="tabular t-xs block" style={{ color: 'var(--color-faint)' }}>
                {[
                  kindShort(t, d.kind),
                  fmtSize(t, d.size),
                  t.date(d.createdAt),
                ].filter(Boolean).join(' · ')}
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1">
              <button className="btn-icon" aria-label={t('inventory.docs.download.aria')}
                      disabled={busy === d.id} onClick={() => void download(d)}>⤓</button>
              {canWrite && (
                <button className="btn-icon" aria-label={t('common.delete')}
                        disabled={busy === d.id} onClick={() => void remove(d)}>✕</button>
              )}
            </span>
          </div>
        ))}
      </section>

      {/* ── Нотификация МОЗ ──────────────────────────────────── */}
      {material.isCosmetic && (
        <section className="card-flat rise-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="t-sm" style={{ color: 'var(--color-faint)' }}>
              {t('inventory.docs.moz.title')}
            </h3>
            {canEditMoz && (
              <button type="button" className="btn-ghost t-sm" onClick={() => setMoz(true)}>
                {material.notificationCode
                  ? t('inventory.docs.moz.change')
                  : t('inventory.docs.moz.set')}
              </button>
            )}
          </div>
          {material.notificationCode ? (
            <>
              <p className="tabular t-md mt-2">
                {t('inventory.docs.moz.code', { code: material.notificationCode })}
              </p>
              <p className="tabular t-sm" style={{ color: 'var(--color-muted)' }}>
                {t('inventory.docs.moz.date', { date: t.date(material.notificationDate) })}
              </p>
              {material.notificationUrl ? (
                <a href={material.notificationUrl} target="_blank" rel="noreferrer noopener"
                   className="btn-secondary mt-3 t-sm">{t('inventory.docs.moz.open')}</a>
              ) : (
                <p className="field-hint mt-2">{t('inventory.docs.moz.noUrl')}</p>
              )}
            </>
          ) : (
            <p className="field-hint mt-2">{t('inventory.docs.moz.noCode')}</p>
          )}
        </section>
      )}

      {/* ── Загрузка ─────────────────────────────────────────── */}
      <Sheet open={add} onClose={() => setAdd(false)} title={t('inventory.docs.sheet.new')}>
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.docs.field.kind')}</label>
            <select className="select" value={kind}
                    onChange={(e) => setKind(e.target.value as DocKind)}>
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>{kindLabel(t, k)}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.docs.field.title.label')}</label>
            <input className="input" placeholder={t('inventory.docs.field.title.placeholder')}
                   value={title} onChange={(e) => setTitle(e.target.value)} />
            <p className="field-hint">{t('inventory.docs.field.title.hint')}</p>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.docs.field.file.label')}</label>
            <input key={fileKey} required type="file" className="input pt-2.5"
                   accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="field-hint">{t('inventory.docs.field.file.hint')}</p>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy === 'upload' || !file}>
              {busy === 'upload'
                ? t('inventory.docs.upload.busy')
                : t('inventory.docs.upload.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAdd(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Нотификация: правка ──────────────────────────────── */}
      <Sheet open={moz} onClose={() => setMoz(false)} title={t('inventory.docs.moz.title')}>
        <MozForm
          code={material.notificationCode ?? ''}
          url={material.notificationUrl ?? ''}
          date={material.notificationDate ?? ''}
          busy={busy === 'moz'}
          onSave={saveMoz}
          onCancel={() => setMoz(false)}
        />
      </Sheet>

      <p className="field-hint rise-3">{t('inventory.docs.hint')}</p>
    </div>
  )
}

function MozForm({
  code, url, date, busy, onSave, onCancel,
}: {
  code: string; url: string; date: string; busy: boolean
  onSave: (f: { code: string; url: string; date: string }) => void
  onCancel: () => void
}) {
  const t = useT()
  const [c, setC] = useState(code)
  const [u, setU] = useState(url)
  const [d, setD] = useState(date)
  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave({ code: c, url: u, date: d }) }}>
      <div>
        <label className="field-label">{t('inventory.docs.moz.form.code')}</label>
        <input autoFocus className="input" placeholder={t('inventory.docs.moz.form.code.placeholder')}
               value={c} onChange={(e) => setC(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.docs.moz.form.date')}</label>
        <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.docs.moz.form.url')}</label>
        <input type="url" inputMode="url" className="input" placeholder="https://…"
               value={u} onChange={(e) => setU(e.target.value)} />
        <p className="field-hint">{t('inventory.docs.moz.form.hint')}</p>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
