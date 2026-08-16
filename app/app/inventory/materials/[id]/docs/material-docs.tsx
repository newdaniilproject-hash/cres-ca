'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import {
  DOC_EXT_BY_MIME, DOC_KINDS, DOC_KIND_LABEL, DOC_MAX_BYTES,
  fmtSize, type DocKind,
} from '@/lib/documents'
import { fmtDate } from '@/lib/expiry'

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

// Фильтры ровно как на макете: «Всі», потом виды, у которых есть файлы.
// Пустой вид в полосе фильтров — обещание, за которым ничего нет.
const FILTERS: { key: 'all' | DocKind; label: string }[] = [
  { key: 'all', label: 'Всі' },
  { key: 'msds', label: 'MSDS' },
  { key: 'quality_cert', label: 'Сертифікати' },
  { key: 'ses_conclusion', label: 'Висновок СЕС' },
  { key: 'notification', label: 'Нотифікація' },
  { key: 'other', label: 'Інше' },
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
      toast.error('Формат не підтримується', 'PDF, JPG, PNG, WEBP, DOC або DOCX')
      return
    }
    if (file.size > DOC_MAX_BYTES) {
      toast.error('Файл більший за 20 МБ', 'Стисніть або розділіть його')
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
      toast.error('Файл не завантажено', uploadError.message)
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
      toast.error('Запис не збережено', error.message)
      return
    }

    setBusy(null)
    setTitle(''); setFile(null); setFileKey((k) => k + 1); setAdd(false)
    toast.success('Документ завантажено')
    router.refresh()
  }

  // Бакет приватный: публичной ссылки у файла нет в принципе.
  // Пять минут — столько живёт доступ, дальше ссылка мертва даже
  // если её переслали.
  async function signedUrl(doc: Doc, filename?: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from('documents')
      .createSignedUrl(doc.path, 300, filename ? { download: filename } : undefined)
    if (error) { toast.error('Не вдалося відкрити файл', error.message); return null }
    return data?.signedUrl ?? null
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
    if (!window.confirm(`Видалити «${doc.title}»? Файл зникне назавжди.`)) return
    setBusy(doc.id)
    // Сначала запись, потом файл. Обратный порядок опаснее: строка
    // реестра, которая обещает инспектору документ, а файла уже нет, —
    // хуже, чем файл, на который никто не ссылается.
    const { error } = await supabase.from('material_documents').delete().eq('id', doc.id)
    if (error) { setBusy(null); toast.error('Не вдалося видалити', error.message); return }
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.path])
    setBusy(null)
    if (storageError) toast.warn('Запис видалено', `Файл лишився у сховищі: ${storageError.message}`)
    else toast.success('Документ видалено')
    router.refresh()
  }

  async function saveMoz(f: { code: string; url: string; date: string }) {
    const url = f.url.trim()
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error('Посилання має починатися з https://')
      return
    }
    setBusy('moz')
    const { error } = await supabase.from('materials').update({
      notification_code: f.code.trim() || null,
      notification_url: url || null,
      notification_date: f.date || null,
    }).eq('id', material.id)
    setBusy(null)
    if (error) { toast.error('Не збережено', error.message); return }
    setMoz(false)
    toast.success('Нотифікацію збережено')
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
        {FILTERS.filter((f) => f.key === 'all' || (counts[f.key] ?? 0) > 0).map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                  className={filter === f.key ? 'chip-active' : 'chip'}>
            {f.label} {counts[f.key] ?? 0}
          </button>
        ))}
        {canWrite && (
          <button type="button" className="btn-primary ml-auto t-sm"
                  onClick={() => setAdd(true)}>+ Документ</button>
        )}
      </div>

      {/* ── Список файлов ────────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            {docs.length === 0
              ? 'Документів не завантажено. Перевірка вимагає паспорт безпеки, сертифікат якості та висновок СЕС на канекалон.'
              : 'У цьому фільтрі документів немає.'}
            {canWrite && docs.length === 0 && (
              <button type="button" className="btn-primary" onClick={() => setAdd(true)}>
                Завантажити перший
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
                  DOC_KIND_LABEL[d.kind],
                  fmtSize(d.size),
                  fmtDate(d.createdAt),
                ].filter(Boolean).join(' · ')}
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1">
              <button className="btn-icon" aria-label="Завантажити"
                      disabled={busy === d.id} onClick={() => void download(d)}>⤓</button>
              {canWrite && (
                <button className="btn-icon" aria-label="Видалити"
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
            <h3 className="t-sm" style={{ color: 'var(--color-faint)' }}>НОТИФІКАЦІЯ МОЗ</h3>
            {canEditMoz && (
              <button type="button" className="btn-ghost t-sm" onClick={() => setMoz(true)}>
                {material.notificationCode ? 'Змінити' : 'Вказати'}
              </button>
            )}
          </div>
          {material.notificationCode ? (
            <>
              <p className="tabular t-md mt-2">Код: {material.notificationCode}</p>
              <p className="tabular t-sm" style={{ color: 'var(--color-muted)' }}>
                Дата реєстрації: {fmtDate(material.notificationDate)}
              </p>
              {material.notificationUrl ? (
                <a href={material.notificationUrl} target="_blank" rel="noreferrer noopener"
                   className="btn-secondary mt-3 t-sm">Відкрити запис у реєстрі</a>
              ) : (
                <p className="field-hint mt-2">
                  Посилання не вказане — інспектор перевіряє нотифікацію за
                  записом у реєстрі, а не за кодом.
                </p>
              )}
            </>
          ) : (
            <p className="field-hint mt-2">
              Для косметичного засобу код внесення до Єдиної системи
              електронної нотифікації МОЗ — обовʼязковий пункт перевірки.
            </p>
          )}
        </section>
      )}

      {/* ── Загрузка ─────────────────────────────────────────── */}
      <Sheet open={add} onClose={() => setAdd(false)} title="Новий документ">
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">Тип документа</label>
            <select className="select" value={kind}
                    onChange={(e) => setKind(e.target.value as DocKind)}>
              {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Назва</label>
            <input className="input" placeholder="Сертифікат якості партії 62XS03"
                   value={title} onChange={(e) => setTitle(e.target.value)} />
            <p className="field-hint">Порожньо — візьмемо назву файлу.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Файл</label>
            <input key={fileKey} required type="file" className="input pt-2.5"
                   accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="field-hint">PDF, фото або документ Word, до 20 МБ.</p>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy === 'upload' || !file}>
              {busy === 'upload' ? 'Завантажуємо…' : 'Завантажити'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAdd(false)}>
              Скасувати
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Нотификация: правка ──────────────────────────────── */}
      <Sheet open={moz} onClose={() => setMoz(false)} title="Нотифікація МОЗ">
        <MozForm
          code={material.notificationCode ?? ''}
          url={material.notificationUrl ?? ''}
          date={material.notificationDate ?? ''}
          busy={busy === 'moz'}
          onSave={saveMoz}
          onCancel={() => setMoz(false)}
        />
      </Sheet>

      <p className="field-hint rise-3">
        Файли зберігаються у закритому сховищі: посилання діє пʼять хвилин
        і працює лише для тих, кому ви відкрили доступ до санітарного обліку.
      </p>
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
  const [c, setC] = useState(code)
  const [u, setU] = useState(url)
  const [d, setD] = useState(date)
  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave({ code: c, url: u, date: d }) }}>
      <div>
        <label className="field-label">Код нотифікації</label>
        <input autoFocus className="input" placeholder="UA.TR.116.003-25"
               value={c} onChange={(e) => setC(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Дата внесення до реєстру</label>
        <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Посилання на запис</label>
        <input type="url" inputMode="url" className="input" placeholder="https://…"
               value={u} onChange={(e) => setU(e.target.value)} />
        <p className="field-hint">
          ТЗ вимагає саме посилання: за кодом інспектор нічого не перевірить.
        </p>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  )
}
