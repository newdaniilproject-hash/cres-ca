'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Значения перечисления material_doc_kind из миграции 0014.
export type DocKind = 'msds' | 'quality_cert' | 'ses_conclusion' | 'notification' | 'other'

const KINDS: { value: DocKind; label: string }[] = [
  { value: 'msds', label: 'Паспорт безпеки (MSDS)' },
  { value: 'quality_cert', label: 'Сертифікат якості' },
  { value: 'ses_conclusion', label: 'Висновок СЕС' },
  { value: 'notification', label: 'Нотифікація МОЗ' },
  { value: 'other', label: 'Інше' },
]

const KIND_LABEL: Record<DocKind, string> = {
  msds: 'MSDS',
  quality_cert: 'Сертифікат якості',
  ses_conclusion: 'Висновок СЕС',
  notification: 'Нотифікація МОЗ',
  other: 'Інше',
}

type Material = {
  id: string; name: string; unit: string
  brand: string | null; isCosmetic: boolean
}
type Doc = {
  id: string; materialId: string; kind: DocKind
  title: string; path: string; createdAt: string
}

// Повторяет ограничения бакета documents из 0019. Проверяем на клиенте
// не вместо RLS, а чтобы вместо ответа хранилища «mime type not supported»
// продавец увидел человеческую фразу.
const MAX_BYTES = 20 * 1024 * 1024
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export function DocumentsClient({
  tenantId, userId, materials, documents, loadError,
}: {
  tenantId: string; userId: string
  materials: Material[]; documents: Doc[]; loadError: string
}) {
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
      setErr('Дозволені формати: PDF, JPG, PNG, WEBP, DOC, DOCX')
      return
    }
    if (file.size > MAX_BYTES) {
      setErr('Файл більший за 20 МБ — стисніть або розділіть його')
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

    const { error } = await supabase.from('material_documents').insert({
      tenant_id: tenantId, material_id: materialId,
      kind, title: title.trim(), path, uploaded_by: userId,
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
    if (!window.confirm(`Видалити «${doc.title}»? Файл зникне назавжди.`)) return
    setBusy(doc.id); setErr('')
    // Сначала запись, потом файл. Обратный порядок опаснее: строка
    // реестра, которая обещает инспектору документ, а файла уже нет, —
    // хуже, чем файл, на который никто не ссылается.
    const { error } = await supabase.from('material_documents').delete().eq('id', doc.id)
    if (error) { setBusy(null); setErr(error.message); return }
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.path])
    setBusy(null)
    if (storageError) setErr(`Запис видалено, файл лишився у сховищі: ${storageError.message}`)
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString('uk-UA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
        <Link href="/app/journals" className="btn-ghost">Санітарні журнали</Link>
        <Link href="/app/techcards" className="btn-ghost">Техкарти обробки</Link>
      </div>

      {loadError && <p className="field-error rise">{loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {missing.length > 0 && (
        <div className="card-flat rise-1 flex flex-wrap items-center gap-3">
          <span className="badge-warn">без документів: {missing.length}</span>
          <p className="text-sm prose-muted">
            На косметичні засоби перевірка вимагає паспорт безпеки, сертифікат
            якості та висновок СЕС. Завантажте їх зараз — під час перевірки
            шукати вже пізно.
          </p>
        </div>
      )}

      <form onSubmit={upload} className="card rise-1 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">Матеріал</label>
          <select required className="select" value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">Оберіть матеріал…</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.brand ? ` · ${m.brand}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Тип документа</label>
          <select className="select" value={kind}
                  onChange={(e) => setKind(e.target.value as DocKind)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Назва</label>
          <input required className="input" placeholder="Сертифікат якості партії 2024/07"
                 value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-hint">Так документ буде видно у списку та у файлі при завантаженні.</p>
        </div>
        <div>
          <label className="field-label">Файл</label>
          <input key={fileKey} required type="file" className="input pt-2.5"
                 accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="field-hint">PDF, фото або документ Word, до 20 МБ.</p>
        </div>
        <button className="btn-primary sm:col-span-2 sm:justify-self-start"
                disabled={busy === 'upload' || !file || !materialId || !title.trim()}>
          {busy === 'upload' ? 'Завантажуємо…' : 'Завантажити документ'}
        </button>
      </form>

      {materials.length === 0 ? (
        <div className="card rise-2">
          <div className="empty">
            <p>Матеріалів ще немає.</p>
            <p className="prose-muted">Спершу заведіть їх на складі — документи чіпляються до матеріалу.</p>
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
                    <h2 className="display text-lg">{m.name}</h2>
                    <p className="text-xs prose-muted">
                      {m.brand ? `${m.brand} · ` : ''}одиниця: {m.unit}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    {m.isCosmetic && <span className="badge-accent">косметика</span>}
                    {m.isCosmetic && docs.length === 0 ? (
                      <span className="badge-warn">
                        потрібні документи для перевірки
                      </span>
                    ) : (
                      <span className="badge">документів: {docs.length}</span>
                    )}
                  </span>
                </div>

                {docs.length === 0 ? (
                  <p className="text-sm prose-muted">Документів не завантажено.</p>
                ) : (
                  <div className="flex flex-col">
                    {docs.map((d) => (
                      <div key={d.id} className="row">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{d.title}</p>
                          <p className="text-xs prose-muted">
                            {KIND_LABEL[d.kind]} · {fmt(d.createdAt)}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                          <button className="btn-ghost" disabled={busy === d.id}
                                  onClick={() => void view(d)}>Переглянути</button>
                          <button className="btn-ghost" disabled={busy === d.id}
                                  onClick={() => void download(d)}>Завантажити</button>
                          <button className="btn-ghost" disabled={busy === d.id}
                                  onClick={() => void remove(d)}>✕</button>
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

      <p className="field-hint rise-3">
        Файли зберігаються у закритому сховищі: посилання на документ діє
        пʼять хвилин і працює лише для тих, кому ви відкрили доступ до
        санітарного обліку. Назовні сертифікати не потрапляють.
      </p>
    </div>
  )
}
