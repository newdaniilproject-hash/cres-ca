'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { MEDIA_EXT_BY_MIME, MEDIA_MAX_BYTES } from '@/lib/upload/guard'
import { verifyUploaded } from '@/lib/upload/client'
import { IconBox, IconChevronRight, IconClose, IconPlus } from '@/components/icons'
import { Sheet } from '@/components/sheet'
import { RefsForm } from './refs-form'

export type RefItem = { id: string; name: string }

// Единица измерения в базе — свободный текст (словарь продавца).
// В форме это всё-таки список: свободный ввод рождает «мл», «Мл» и «ml»
// как три разные единицы — ровно та ошибка, из-за которой в 0009
// поставщика превратили из текста в таблицу.
//
// В СЛОВАРЬ ЛОКАЛИЗАЦИИ ЭТОТ СПИСОК НЕ ЕДЕТ, и это не пропуск. Значение
// отсюда УХОДИТ В БАЗУ (`materials.unit`) и оттуда же возвращается в
// каждый список, карточку и наклейку — то есть это данные арендатора,
// а не строка интерфейса (CLAUDE.md → «Локализация»). Переведи их здесь —
// и один и тот же засіб получит «мл» у одного мастера и «ml» у другого,
// то есть ровно те три разные единицы, ради которых список и заведён.
export const UNITS = ['мл', 'г', 'шт', 'уп']

/** Карточка засоба такой, какой её отдаёт база. Для правки — обязательна,
    для заведения — не передаётся вовсе. */
export type MaterialInit = {
  id: string
  name: string
  unit: string
  sku: string | null
  category: string | null
  threshold: number
  cost: number | null
  supplierId: string | null
  locationId: string | null
  isCosmetic: boolean
  brand: string | null
  country: string | null
  inci: string | null
  notificationCode: string | null
  notificationUrl: string | null
  notificationDate: string | null
  /**
   * Подтверждение нотификации принято (0106). Форма его НЕ правит:
   * подтверждение — это конкретный документ, и принимается оно
   * на экране документов функцией `confirm_notification`, которая
   * сверяет вид документа и принадлежность засобу. Поле здесь
   * только затем, что тип общий с карточкой, которая его показывает.
   */
  notificationConfirmedAt?: string | null
  paoMonths: number | null
  /** Фото засоба в публичном бакете `media` (0111). */
  imagePath?: string | null
  /** Свободная заметка продавца (0111). */
  note?: string | null
  /** Произвольные поля продавца (0111). */
  attributes?: Record<string, string> | null
}

// Заведение и правка расходника — одна форма.
//
// Почему одна, а не две: до этого правки не было вовсе — «в реестре
// нельзя исправить ни одного поля». Вторая форма для тех же полей
// разъезжается с первой на второй же правке; проверено на справочниках.
// Базовое сверху, косметический паспорт — за галочкой, потому что
// обычной нитке или фольге поля техрегламента не нужны и только пугают.
export function MaterialForm({
  tenantId, suppliers, locations, material, onDone,
}: {
  tenantId: string
  suppliers: RefItem[]
  locations: RefItem[]
  /** Задан — форма правит эту карточку. Не задан — заводит новую. */
  material?: MaterialInit
  onDone: () => void
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [name, setName] = useState(material?.name ?? '')
  // ── Своё, а не обязательное по регламенту ────────────────────────────
  //
  // Паспорт по Техрегламенту №65 (бренд, артикул, INCI, страна, партия,
  // PAO, нотификация) одинаков у всех и обязателен. А это — склад
  // КОНКРЕТНОГО продавца: фото банки, чтобы узнать её на полке, заметка
  // своими словами и любые свои поля. Требование владельца 19.08.2026:
  // «это его склад, он может делать с ним всё, что хочет».
  const [imagePath, setImagePath] = useState(material?.imagePath ?? '')
  const [note, setNote] = useState(material?.note ?? '')
  const [attrs, setAttrs] = useState<[string, string][]>(
    Object.entries(material?.attributes ?? {}),
  )
  const [photoErr, setPhotoErr] = useState('')
  const [unit, setUnit] = useState(material?.unit ?? UNITS[0])
  const [sku, setSku] = useState(material?.sku ?? '')
  const [category, setCategory] = useState(material?.category ?? '')
  const [threshold, setThreshold] = useState(String(material?.threshold ?? 0))
  const [cost, setCost] = useState(material?.cost != null ? String(material.cost) : '')
  const [supplierId, setSupplierId] = useState(material?.supplierId ?? '')
  const [locationId, setLocationId] = useState(material?.locationId ?? '')

  // ── Редкое — под раскрытием ─────────────────────────────────────────
  //
  // Решение владельца 20.08.2026 по живому телефону: «форма создания
  // засоба какая-то перегруженная». Одиннадцать полей подряд — это
  // стена для мастера, который заводит банку у кресла. Сверху остаётся
  // то, без чего строки склада не существует (название, единица, порог),
  // остальное — за одним нажатием.
  //
  // Открыто СРАЗУ, если внутри уже что-то лежит: при правке засоба
  // закрытое раскрытие прячет заполненные поля, и человек читает это
  // как «данные пропали». Считается один раз, при монтировании, —
  // иначе блок захлопывался бы на каждом изменении.
  const [more, setMore] = useState(() => Boolean(
    material && (material.sku || material.category || material.supplierId
      || material.locationId || material.cost != null || material.imagePath
      || material.note || Object.keys(material.attributes ?? {}).length > 0),
  ))
  // Справочники поставщиков и мест — ТОЙ ЖЕ формой, что и на складе
  // (`refs-form.tsx`), шторкой поверх этой. Своей мини-формы здесь нет
  // намеренно: две формы одного справочника расходятся на первой правке.
  // До 20.08.2026 двери отсюда не было вовсе — оба селекта показывали
  // «— не вказано —» и завести значение было неоткуда.
  const [refs, setRefs] = useState(false)

  const [cosmetic, setCosmetic] = useState(material?.isCosmetic ?? false)
  const [brand, setBrand] = useState(material?.brand ?? '')
  const [country, setCountry] = useState(material?.country ?? '')
  const [inci, setInci] = useState(material?.inci ?? '')
  const [notification, setNotification] = useState(material?.notificationCode ?? '')
  const [notificationUrl, setNotificationUrl] = useState(material?.notificationUrl ?? '')
  const [notificationDate, setNotificationDate] = useState(material?.notificationDate ?? '')
  const [pao, setPao] = useState(material?.paoMonths != null ? String(material.paoMonths) : '')

  // ── Фото засоба ─────────────────────────────────────────────────────
  //
  // Публичный бакет `media`, как у фотографий товаров: подписывать каждую
  // миниатюру списка — приговор бюджету отрисовки. Первый сегмент пути —
  // `tenant_id`: и политика хранилища, и сторож в базе (0111) разбирают
  // владельца именно из него, другой путь отвергают оба.
  //
  // Тип файла проверяется ДВАЖДЫ и это не перестраховка: здесь — по
  // объявленному типу, ради понятного текста; на сервере — по первым
  // байтам уже сохранённого файла, потому что расширение придумывает
  // тот же, кто присылает файл.
  async function uploadPhoto(file: File) {
    setPhotoErr('')
    const raw = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const mime = file.type
      || (raw === 'png' ? 'image/png' : raw === 'webp' ? 'image/webp'
        : raw === 'avif' ? 'image/avif' : 'image/jpeg')
    if (!(mime in MEDIA_EXT_BY_MIME)) { setPhotoErr(t('upload.reject.mime')); return }
    if (file.size > MEDIA_MAX_BYTES) { setPhotoErr(t('upload.reject.size')); return }

    setBusy(true)
    const ext = MEDIA_EXT_BY_MIME[mime]
    const fname = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    const path = `${tenantId}/materials/${fname}`
    const up = await supabase.storage.from('media')
      .upload(path, file, { contentType: mime, upsert: false })
    if (up.error) { setBusy(false); setPhotoErr(dbErrorText(t, up.error)); return }

    const rejected = await verifyUploaded('media', path)
    if (rejected) { setBusy(false); setPhotoErr(t(`upload.reject.${rejected}`)); return }

    // Старое фото убираем сразу: одна картинка на засіб, и оставленный
    // файл стал бы невидимым мусором навсегда — его уже ничто не найдёт.
    if (imagePath) await supabase.storage.from('media').remove([imagePath])
    setImagePath(path)
    setBusy(false)
  }

  async function dropPhoto() {
    if (!imagePath) return
    setBusy(true)
    await supabase.storage.from('media').remove([imagePath])
    setImagePath('')
    setBusy(false)
  }

  const photoUrl = (p: string) => supabase.storage.from('media').getPublicUrl(p).data.publicUrl

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')

    const url = notificationUrl.trim()
    // База отобьёт неправильную ссылку ограничением, но текст Postgres
    // мастеру ничего не объясняет — проверяем здесь и говорим по-людски.
    if (cosmetic && url && !/^https?:\/\//i.test(url)) {
      setBusy(false)
      setErr(t('inventory.material.error.url'))
      return
    }

    const row = {
      name: name.trim(),
      unit,
      // Артикул — прямой пункт ТЗ (3.1). Приводим к верхнему регистру:
      // «kj-12» и «KJ-12» — один и тот же товар, а не два.
      sku: sku.trim().toUpperCase() || null,
      category: category.trim() || null,
      // current_stock не отправляем сознательно: это кэш от журнала
      // движений, прямой update блокирует триггер (CLAUDE.md, правило 5).
      min_stock_threshold: Number(threshold || 0),
      cost_per_unit: cost.trim() ? Number(cost) : null,
      supplier_id: supplierId || null,
      location_id: locationId || null,
      is_cosmetic: cosmetic,
      // Паспорт по техрегламенту нужен только косметике. Галочку сняли —
      // поля не сохраняем, иначе в базе остаются данные, которых не видно.
      brand: cosmetic ? brand.trim() || null : null,
      country_of_origin: cosmetic ? country.trim() || null : null,
      inci: cosmetic ? inci.trim() || null : null,
      notification_code: cosmetic ? notification.trim() || null : null,
      notification_url: cosmetic ? url || null : null,
      notification_date: cosmetic ? notificationDate || null : null,
      pao_months: cosmetic && Number(pao) > 0 ? Number(pao) : null,
      image_path: imagePath || null,
      note: note.trim() || null,
      // Пустые ключи выбрасываем здесь, а не показываем ошибку: строка,
      // у которой стёрли имя, — это способ удалить поле, а не опечатка.
      attributes: Object.fromEntries(
        attrs.map(([k, v]) => [k.trim(), v.trim()]).filter(([k]) => k !== ''),
      ),
    }

    const { error } = material
      ? await supabase.from('materials').update(row).eq('id', material.id)
      : await supabase.from('materials').insert({ tenant_id: tenantId, ...row })

    setBusy(false)
    // 23505 — нарушение уникальности (tenant_id, name). Текст Postgres
    // мастеру в салоне ничего не объясняет, поэтому переводим.
    if (error) {
      // Экранная подпись для дубля лучше общей; запасной путь — общий
      // разбор dbErrorText, а не сырой текст Postgres (М25).
      setErr(error.code === '23505'
        ? t('inventory.material.error.duplicate')
        : dbErrorText(t, error))
      return
    }
    router.refresh()
    onDone()
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">

      <div className="sm:col-span-2">
        <label className="field-label">{t('inventory.material.name.label')}</label>
        <input required autoFocus className="input" placeholder={t('inventory.material.name.placeholder')}
               value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="field-label">{t('inventory.material.unit.label')}</label>
        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div>
        <label className="field-label">{t('inventory.material.threshold.label')}</label>
        <input type="number" min="0" step="any" className="input"
               value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <p className="field-hint">{t('inventory.material.threshold.hint')}</p>
      </div>

      <label className="t-md flex items-center gap-2 sm:col-span-2"
             style={{ minHeight: 'var(--tap-min)' }}>
        <input type="checkbox" checked={cosmetic}
               onChange={(e) => setCosmetic(e.target.checked)} />
        {t('inventory.material.cosmetic.label')}
      </label>

      {cosmetic && (
        <div className="card-flat grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <p className="t-xs prose-muted sm:col-span-2">{t('inventory.material.passport.hint')}</p>
          <div>
            <label className="field-label">{t('inventory.material.brand.label')}</label>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{t('inventory.material.country.label')}</label>
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{t('inventory.material.moz.code.label')}</label>
            <input className="input" placeholder={t('inventory.material.moz.code.placeholder')}
                   value={notification} onChange={(e) => setNotification(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{t('inventory.material.moz.date.label')}</label>
            <input type="date" className="input"
                   value={notificationDate} onChange={(e) => setNotificationDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.material.moz.url.label')}</label>
            <input type="url" inputMode="url" className="input"
                   placeholder="https://…"
                   value={notificationUrl} onChange={(e) => setNotificationUrl(e.target.value)} />
            <p className="field-hint">{t('inventory.material.moz.url.hint')}</p>
          </div>
          <div>
            <label className="field-label">{t('inventory.material.pao.label')}</label>
            <input type="number" min="1" className="input" placeholder="12"
                   value={pao} onChange={(e) => setPao(e.target.value)} />
            <p className="field-hint">{t('inventory.material.pao.hint')}</p>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.material.inci.label')}</label>
            <textarea className="textarea" placeholder={t('inventory.material.inci.placeholder')}
                      value={inci} onChange={(e) => setInci(e.target.value)} />
          </div>
        </div>
      )}

      {/* ── «Додатково»: всё редкое — за одним нажатием ─────────────
          Решение владельца 20.08.2026: «форма создания засоба какая-то
          перегруженная». Сверху осталось то, без чего строка склада
          не имеет смысла (название, единица, порог) плюс галочка
          косметики — она РАЗВИЛКА, а не деталь: от неё зависит, будет
          ли у засоба компланс-часть, поэтому она видна всегда.

          Здесь — то, что заполняют не каждый раз: артикул, категория,
          поставщик, место, себестоимость, фото, заметка и свои поля. */}
      <div className="sm:col-span-2">
        <button type="button" className="btn-ghost !px-0" aria-expanded={more}
                onClick={() => setMore(!more)}>
          <span aria-hidden className="inline-flex"
                style={{
                  transform: more ? 'rotate(90deg)' : 'none',
                  transition: 'transform var(--dur-fast)',
                }}>
            <IconChevronRight size={18} />
          </span>
          {more ? t('inventory.collapse') : t('inventory.receipts.form.section.extra')}
        </button>
      </div>

      {more && (
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <div>
            <label className="field-label">{t('inventory.material.cost.label')}</label>
            <input type="number" min="0" step="0.01" className="input"
                   placeholder={t('inventory.material.optional.placeholder')}
                   value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.material.category.label')}</label>
            <input className="input" placeholder={t('inventory.material.category.placeholder')}
                   value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.material.sku.label')}</label>
            <input className="input" placeholder={t('inventory.material.sku.placeholder')}
                   value={sku} onChange={(e) => setSku(e.target.value)} />
            <p className="field-hint">{t('inventory.material.sku.hint')}</p>
          </div>

          {/* ⚠️ КНОПКА «+» РЯДОМ С СЕЛЕКТОМ — ЭТО ВЫХОД ИЗ ТУПИКА,
              а не украшение. До 20.08.2026 оба селекта у нового заклада
              показывали одно «— не вказано —», и завести значение было
              НЕОТКУДА: справочники живут на своём экране, а двери туда
              из формы не было. Открывается та же самая `RefsForm`,
              что и со склада, — своей мини-формы здесь нет намеренно:
              две формы одного справочника расходятся на первой правке,
              а расхождение в справочнике поставщиков — это «Розетка»,
              «розетка» и «Розетка ТОВ» тремя строками. */}
          <div>
            <label className="field-label">{t('inventory.material.supplier.label')}</label>
            <div className="flex items-center gap-2">
              <select className="select min-w-0 flex-1" value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('inventory.common.notSet')}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn-icon shrink-0"
                      aria-label={t('inventory.action.refs')}
                      onClick={() => setRefs(true)}>
                <IconPlus size={18} />
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">{t('inventory.material.location.label')}</label>
            <div className="flex items-center gap-2">
              <select className="select min-w-0 flex-1" value={locationId}
                      onChange={(e) => setLocationId(e.target.value)}>
                <option value="">{t('inventory.common.notSet')}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button type="button" className="btn-icon shrink-0"
                      aria-label={t('inventory.action.refs')}
                      onClick={() => setRefs(true)}>
                <IconPlus size={18} />
              </button>
            </div>
            {/* Селект меняет место МОЛЧА — след в журнале движений оставляет
                только «Перемістити» на карточке (relocate_stock, 0113).
                Подсказка стоит лишь при правке: у нового засоба карточки
                ещё нет, и отсылать к ней не к чему. */}
            {material && (
              <p className="field-hint">{t('inventory.material.location.hint')}</p>
            )}
          </div>

          {/* ── Своё: фото, заметка, произвольные поля ────────────────
              Это НЕ паспорт по регламенту — тот выше и обязателен для всех.
              Здесь склад конкретного продавца: узнать банку на полке,
              записать своими словами, завести поле, которого нет ни у кого
              другого. Требование владельца 19.08.2026: «это его склад,
              он может делать с ним всё, что хочет».

              Свои поля лежат ВНУТРИ этого заголовка, а не рядом с ним:
              они того же рода, что фото и заметка, — своё про этот засіб.
              До 20.08.2026 надзаголовок стоял только над фото и заметкой,
              и «Власні поля» читались как продолжение регламента. */}
          <div className="sm:col-span-2">
            <p className="eyebrow mb-2">{t('inventory.material.own.title')}</p>

            <div className="flex items-start gap-3">
              {/* Фото — квадратом, а не полосой: в списке оно рисуется
                  миниатюрой, и кадрировать его человек должен там же,
                  где выбирает. */}
              <span className="list-card-thumb">
                {imagePath
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={photoUrl(imagePath)} alt=""
                         className="h-full w-full object-cover" />
                  : <IconBox size={26} />}
              </span>
              <div className="min-w-0 flex-1">
                <label className="field-label">{t('inventory.material.photo.label')}</label>
                {/* ⚠️ СИСТЕМНОЕ ПОЛЕ ВЫБОРА ФАЙЛА СЮДА НЕ ВОЗВРАЩАТЬ.
                    Голый `input[type=file]` рисует ОПЕРАЦИОННАЯ СИСТЕМА:
                    своим шрифтом и своим языком — на телефоне владельца
                    это была русская надпись «Выбрать файл» посреди
                    украинского кабинета, и никаким классом она
                    не чинится (20.08.2026). Поле спрятано в `sr-only`
                    (не `hidden`: так оно остаётся доступным с клавиатуры
                    и для чтения с экрана), а нажимают на нашу кнопку —
                    `label` открывает выбор файла и на телефоне тоже. */}
                <label className="btn-secondary w-fit cursor-pointer">
                  {busy
                    ? t('catalog.form.media.uploading')
                    : t('catalog.form.media.add')}
                  <input type="file" className="sr-only"
                         accept="image/jpeg,image/png,image/webp,image/avif"
                         disabled={busy}
                         onChange={(e) => {
                           const f = e.target.files?.[0]
                           if (f) void uploadPhoto(f)
                           e.target.value = ''
                         }} />
                </label>
                <p className="field-hint">{t('inventory.material.photo.hint')}</p>
                {imagePath && (
                  <button type="button" className="btn-ghost t-sm" disabled={busy}
                          onClick={() => void dropPhoto()}>
                    {t('inventory.material.photo.remove')}
                  </button>
                )}
                {photoErr && <p className="field-error">{photoErr}</p>}
              </div>
            </div>

            <div className="mt-3">
              <label className="field-label">{t('inventory.material.note.label')}</label>
              <textarea className="textarea" placeholder={t('inventory.material.note.placeholder')}
                        value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="mt-3">
              <label className="field-label">{t('inventory.material.attrs.label')}</label>
              {attrs.map(([k, v], i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input className="input" placeholder={t('inventory.material.attrs.key')}
                         value={k}
                         onChange={(e) => setAttrs(attrs.map((row, j) =>
                           (j === i ? [e.target.value, row[1]] : row)))} />
                  <input className="input" placeholder={t('inventory.material.attrs.value')}
                         value={v}
                         onChange={(e) => setAttrs(attrs.map((row, j) =>
                           (j === i ? [row[0], e.target.value] : row)))} />
                  <button type="button" className="btn-icon shrink-0"
                          aria-label={t('common.delete')}
                          onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}>
                    <IconClose size={18} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn-secondary t-sm"
                      onClick={() => setAttrs([...attrs, ['', '']])}>
                {t('inventory.material.attrs.add')}
              </button>
              <p className="field-hint">{t('inventory.material.attrs.hint')}</p>
            </div>
          </div>
        </div>
      )}

      {err && <p className="field-error sm:col-span-2">{err}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
