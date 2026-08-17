'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

export type CategoryRow = { id: string; name: string; kind: 'product' | 'service' }
export type LocationRow = { id: string; name: string }
export type MediaRow = { id: string; path: string; position: number }

export type OfferingRow = {
  id: string
  kind: 'product' | 'service'
  status: string
  category_id: string | null
  sku: string | null
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  price: number | null
  compare_at: number | null
  currency: string
  tags: string[]
  listed: boolean
  published_at: string | null
  deposit_percent: number
  cancel_window_hours: number
  booking_horizon_days: number
}

export type VariantRow = {
  id: string
  name: string
  sku: string | null
  price: number | null
  compare_at: number | null
  cost: number | null
  track_stock: boolean
  stock_qty: number
  reserved_qty: number
  weight_g: number | null
  barcode: string | null
  position: number
  is_active: boolean
  location_id: string | null
  min_stock_threshold: number
  unit: string
  duration_minutes: number | null
  buffer_minutes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Адрес страницы
// ─────────────────────────────────────────────────────────────────────────────
// Украинская официальная транслитерация (постанова КМУ 55/2010): г→h, ґ→g,
// и→y, і→i, ї→i, щ→shch. Пишем её здесь, а не берём готовую библиотеку:
// таблица короткая, а результат попадает в постоянный адрес страницы —
// менять его потом дороже, чем написать двадцать строк.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh',
  з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia',
  ы: 'y', э: 'e', ё: 'e', ъ: '',
}

export function slugify(raw: string): string {
  const base = raw
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  // База требует ^[a-z0-9][a-z0-9-]*$ — пустой адрес отвергнет, поэтому
  // на нечитаемом названии («手袋», «!!!») подставляем случайный.
  return base || `item-${Math.random().toString(36).slice(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Черновик варианта: всё в строках, потому что это состояние полей ввода
// ─────────────────────────────────────────────────────────────────────────────
type VariantDraft = {
  key: string
  id: string | null
  name: string
  sku: string
  price: string
  compareAt: string
  cost: string
  unit: string
  trackStock: boolean
  weight: string
  barcode: string
  threshold: string
  locationId: string
  duration: string
  buffer: string
  isActive: boolean
  stockQty: number
  reservedQty: number
}

// Ключи для React: счётчик, а не crypto.randomUUID(), — значение совпадает
// при отрисовке на сервере и в браузере.
let keySeq = 0
const nextKey = () => `new-${(keySeq += 1)}`

// Имя варианта по умолчанию и единица по умолчанию — ДАННЫЕ, которые
// уезжают в базу, а не строки интерфейса: переведи их — и одна и та же
// позиция называлась бы по-разному в зависимости от языка того, кто её
// завёл. В словарь не едут (CLAUDE.md → «Локализация»).
const DEFAULT_VARIANT = 'Стандарт'
const DEFAULT_UNIT = 'шт'

const str = (v: number | null | undefined) => (v == null ? '' : String(v))
// Продавец с телефона набирает «1 200,50» — пробелы и запятая нормальны.
const toNum = (v: string): number | null => {
  // Переменная названа `raw`, а не `t`: `t` в этом файле — переводчик.
  const raw = v.replace(/\s/g, '').replace(',', '.').trim()
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
const toInt = (v: string): number | null => {
  const n = toNum(v)
  return n == null ? null : Math.round(n)
}

function draftFrom(v: VariantRow): VariantDraft {
  return {
    key: v.id, id: v.id, name: v.name, sku: v.sku ?? '',
    price: str(v.price), compareAt: str(v.compare_at), cost: str(v.cost),
    unit: v.unit, trackStock: v.track_stock, weight: str(v.weight_g),
    barcode: v.barcode ?? '', threshold: str(v.min_stock_threshold),
    locationId: v.location_id ?? '', duration: str(v.duration_minutes),
    buffer: str(v.buffer_minutes), isActive: v.is_active,
    stockQty: v.stock_qty, reservedQty: v.reserved_qty,
  }
}

function emptyDraft(kind: 'product' | 'service', name = ''): VariantDraft {
  return {
    key: nextKey(), id: null, name, sku: '', price: '', compareAt: '', cost: '',
    unit: DEFAULT_UNIT, trackStock: kind === 'product', weight: '', barcode: '',
    threshold: '0', locationId: '',
    // Услуга без длительности не сохранится: этого требует триггер
    // offering_variants_duration. Ставим час — типовой визит.
    duration: kind === 'service' ? '60' : '',
    buffer: kind === 'service' ? '0' : '',
    isActive: true, stockQty: 0, reservedQty: 0,
  }
}

// Подписи к состояниям позиции — те же ключи, что в списке каталога.
// Само значение (`draft`, `archived`) не переводится: это служебное
// значение перечисления, по нему сверяется база.
const STATUSES = ['draft', 'active', 'hidden', 'archived'] as const
type Status = (typeof STATUSES)[number]
const statusLabel = (t: T, v: string): string =>
  ((STATUSES as readonly string[]).includes(v) ? t(`catalog.status.${v as Status}`) : v)

// ─────────────────────────────────────────────────────────────────────────────
// Форма
// ─────────────────────────────────────────────────────────────────────────────
// Одна форма на создание и на правку: поля товара и услуги различаются
// представлением, а не моделью (правило 4 CLAUDE.md). Разводить их на два
// экрана — значит завести два места, где чинить одну и ту же ошибку.
export function OfferingForm({
  tenantId, canWrite, canStock, hasStorefront = false, hasBookings = false,
  categories, locations,
  offering = null, variants = [], media = [],
}: {
  tenantId: string
  /**
   * `catalog.write` — сохранение, публикация, архив, фото и варианты.
   * Без него экран остаётся карточкой: поля видно, тронуть нельзя.
   * `catalog.read` есть у `operator`, `accountant` и `viewer` (0001) —
   * они открывали карточку, заполняли её целиком и упирались в отказ
   * политики `offerings_update` на «Зберегти». Потерянная работа вместо
   * честной отметки «лише перегляд».
   */
  canWrite: boolean
  /** `stock.read` — есть ли у читателя раздел «Склад». */
  canStock: boolean
  /**
   * Модуль `storefront` — вторая ось доступа, не право. Форма позиции
   * живёт в модуле `catalog`, но два её поля говорят не о каталоге,
   * а о витрине: галка «показувати в загальному каталозі маркетплейсу»
   * и адрес позиции `/t/ваш-магазин/…`. Заведению без витрины они
   * обещают публичную страницу, которой у него нет.
   *
   * Скрывается только показ: сохранённое `listed` не трогаем. Молча
   * переписать его в `false` значило бы спрятать позиции продавца
   * в тот день, когда витрину подключат.
   */
  hasStorefront?: boolean
  /**
   * Модуль `bookings`. Блок «Умови запису» (передоплата, окно отмены,
   * горизонт записи) — настройки раздела «Записи», а не каталога:
   * без модуля записей их некому применить, а продавец их заполняет.
   */
  hasBookings?: boolean
  categories: CategoryRow[]
  locations: LocationRow[]
  offering?: OfferingRow | null
  variants?: VariantRow[]
  media?: MediaRow[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  // Позиция могла быть создана прямо в этой сессии формы: если следом
  // упала запись вариантов, повторное нажатие «Зберегти» обязано
  // ДОПИСАТЬ, а не завести вторую позицию с тем же адресом.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const offeringId = offering?.id ?? createdId
  const [kind, setKind] = useState<'product' | 'service'>(offering?.kind ?? 'product')
  const [status, setStatus] = useState(offering?.status ?? 'draft')

  const [title, setTitle] = useState(offering?.title ?? '')
  const [slug, setSlug] = useState(offering?.slug ?? '')
  // Пока продавец не трогал адрес руками, он едет за названием.
  // После ручной правки — замирает: опубликованную ссылку менять нельзя.
  const [slugTouched, setSlugTouched] = useState(!!offering)
  const [subtitle, setSubtitle] = useState(offering?.subtitle ?? '')
  const [description, setDescription] = useState(offering?.description ?? '')
  const [categoryId, setCategoryId] = useState(offering?.category_id ?? '')
  const [sku, setSku] = useState(offering?.sku ?? '')
  const [price, setPrice] = useState(str(offering?.price))
  const [compareAt, setCompareAt] = useState(str(offering?.compare_at))
  const [tags, setTags] = useState((offering?.tags ?? []).join(', '))
  const [listed, setListed] = useState(offering?.listed ?? true)

  const [deposit, setDeposit] = useState(String(offering?.deposit_percent ?? 0))
  const [cancelHours, setCancelHours] = useState(String(offering?.cancel_window_hours ?? 24))
  const [horizon, setHorizon] = useState(String(offering?.booking_horizon_days ?? 60))

  const [drafts, setDrafts] = useState<VariantDraft[]>(
    variants.length > 0
      ? variants.map(draftFrom)
      : [emptyDraft(offering?.kind ?? 'product', DEFAULT_VARIANT)],
  )
  const [savedIds, setSavedIds] = useState<string[]>(variants.map((v) => v.id))

  const [mediaList, setMediaList] = useState<MediaRow[]>(
    [...media].sort((a, b) => a.position - b.position),
  )

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [mediaErr, setMediaErr] = useState('')
  const [saved, setSaved] = useState(false)

  const isService = kind === 'service'
  const catOptions = categories.filter((c) => c.kind === kind)
  const publicUrl = (path: string) =>
    supabase.storage.from('media').getPublicUrl(path).data.publicUrl

  function patchDraft(key: string, patch: Partial<VariantDraft>) {
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  // Смена вида до сохранения переписывает поля вариантов: у товара не бывает
  // длительности, у услуги она обязательна — иначе триггер отвергнет запись.
  function changeKind(next: 'product' | 'service') {
    setKind(next)
    setCategoryId('')
    setDrafts((list) => list.map((d) => ({
      ...d,
      trackStock: next === 'product',
      duration: next === 'service' ? (d.duration || '60') : '',
      buffer: next === 'service' ? (d.buffer || '0') : '',
    })))
  }

  function offeringPayload(finalSlug: string) {
    const base: Record<string, unknown> = {
      category_id: categoryId || null,
      // Пустая строка в citext нарушила бы unique (tenant_id, sku)
      // у второй позиции без артикула — поэтому именно null.
      sku: sku.trim() || null,
      slug: finalSlug,
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      price: toNum(price),
      compare_at: toNum(compareAt),
      // Параметр назван `tag`, а не `t`: `t` — переводчик.
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      listed,
    }
    if (isService) {
      base.deposit_percent = toInt(deposit) ?? 0
      base.cancel_window_hours = toInt(cancelHours) ?? 24
      base.booking_horizon_days = toInt(horizon) ?? 60
    }
    return base
  }

  function variantPayload(d: VariantDraft, position: number, oid: string) {
    // stock_qty и reserved_qty отсутствуют здесь сознательно: это кэш журнала
    // движений, прямой update по ним блокирует триггер (правило 5).
    // Форма всегда одна и та же (а не разная по ветке service/product):
    // это одна таблица с общими колонками, а не два варианта строки.
    return {
      tenant_id: tenantId,
      offering_id: oid,
      name: d.name.trim() || DEFAULT_VARIANT,
      sku: d.sku.trim() || null,
      price: toNum(d.price),
      compare_at: toNum(d.compareAt),
      cost: toNum(d.cost),
      barcode: d.barcode.trim() || null,
      position,
      is_active: d.isActive,
      track_stock: isService ? false : d.trackStock,
      // Триггер требует duration_minutes у услуги и null у товара.
      duration_minutes: isService ? (toInt(d.duration) ?? 60) : null,
      buffer_minutes: isService ? (toInt(d.buffer) ?? 0) : 0,
      unit: isService ? DEFAULT_UNIT : (d.unit.trim() || DEFAULT_UNIT),
      weight_g: isService ? null : toInt(d.weight),
      min_stock_threshold: isService ? 0 : (toInt(d.threshold) ?? 0),
      location_id: isService ? null : (d.locationId || null),
    }
  }

  // Возвращает id сохранённой позиции или null, если сохранить не удалось.
  async function save(): Promise<string | null> {
    // Кнопок записи без права на экране нет; проверка — на случай вызова
    // из `changeStatus`. Границей доверия она не является: ею остаётся RLS.
    if (!canWrite) return null
    setErr(''); setSaved(false); setBusy('save')

    if (!title.trim()) {
      setErr(t('catalog.form.error.title')); setBusy(null); return null
    }
    const finalSlug = slugify(slug.trim() || title)
    if (finalSlug !== slug) setSlug(finalSlug)

    // У позиции всегда есть хотя бы один вариант — именно его кладут
    // в корзину. Продавец о вариантах думать не обязан, поэтому пустой
    // список превращается в «Стандарт», а не в ошибку.
    const list = drafts.length > 0 ? drafts : [emptyDraft(kind, DEFAULT_VARIANT)]
    const names = list.map((d) => (d.name.trim() || DEFAULT_VARIANT).toLowerCase())
    if (new Set(names).size !== names.length) {
      setErr(t('catalog.form.error.dupVariants')); setBusy(null); return null
    }

    let oid = offeringId
    if (oid) {
      const { error } = await supabase.from('offerings')
        .update(offeringPayload(finalSlug)).eq('id', oid)
      if (error) { setErr(error.message); setBusy(null); return null }
    } else {
      const { data, error } = await supabase.from('offerings').insert({
        ...offeringPayload(finalSlug),
        tenant_id: tenantId,
        kind,
        // Публикация — отдельное осознанное действие продавца.
        status: 'draft',
      }).select('id').single()
      // `error.message` — текст базы, он показывается как есть.
      // Из словаря только наш запасной вариант.
      if (error || !data) {
        setErr(error?.message ?? t('catalog.form.error.save')); setBusy(null); return null
      }
      oid = data.id as string
      setCreatedId(oid)
    }

    // Удаляем убранные варианты до записи остальных: продавец мог перенести
    // имя со старого варианта на новый, а пара (offering_id, name) уникальна.
    const removed = savedIds.filter((id) => !list.some((d) => d.id === id))
    if (removed.length > 0) {
      const { error } = await supabase.from('offering_variants').delete().in('id', removed)
      if (error) { setErr(error.message); setBusy(null); return null }
    }

    // Записанные варианты сразу получают свой id в состоянии формы: иначе
    // после ошибки на третьем варианте повтор сохранения вставил бы первые
    // два заново и упёрся в unique (offering_id, name).
    const done: VariantDraft[] = []
    const syncIds = () => {
      const merged = list.map((x) => done.find((p) => p.key === x.key) ?? x)
      setDrafts(merged)
      setSavedIds(merged.filter((x) => x.id).map((x) => x.id as string))
    }

    for (let i = 0; i < list.length; i += 1) {
      const d = list[i]
      const payload = variantPayload(d, i, oid)
      if (d.id) {
        const { error } = await supabase.from('offering_variants').update(payload).eq('id', d.id)
        if (error) {
          syncIds()
          setErr(t('catalog.form.error.variant', {
            name: d.name || DEFAULT_VARIANT, message: error.message,
          }))
          setBusy(null); return null
        }
        done.push(d)
      } else {
        const { data, error } = await supabase.from('offering_variants')
          .insert(payload).select('id').single()
        if (error || !data) {
          syncIds()
          setErr(t('catalog.form.error.variant', {
            name: d.name || DEFAULT_VARIANT,
            message: error?.message ?? t('catalog.form.error.variantSave'),
          }))
          setBusy(null); return null
        }
        done.push({ ...d, id: data.id as string })
      }
    }
    syncIds()

    setBusy(null)
    if (!offering) {
      // Дальше работаем уже с существующей позицией: там доступны фото
      // и публикация, для которых нужен id.
      router.replace(`/app/catalog/${oid}`)
      return oid
    }
    await reloadVariants(oid)
    setSaved(true)
    router.refresh()
    setTimeout(() => setSaved(false), 2000)
    return oid
  }

  async function reloadVariants(oid: string) {
    const { data } = await supabase.from('offering_variants')
      .select(`id, name, sku, price, compare_at, cost, track_stock, stock_qty,
               reserved_qty, weight_g, barcode, position, is_active, location_id,
               min_stock_threshold, unit, duration_minutes, buffer_minutes`)
      .eq('offering_id', oid).order('position')
    if (!data) return
    const rows = data as VariantRow[]
    setDrafts(rows.map(draftFrom))
    setSavedIds(rows.map((v) => v.id))
  }

  async function changeStatus(next: 'active' | 'draft' | 'archived') {
    const oid = await save()
    if (!oid) return
    setBusy('status')
    const patch: Record<string, unknown> = { status: next }
    // Дата публикации — то, по чему витрина сортирует новинки;
    // проставляем её именно в момент, когда позиция стала видимой.
    if (next === 'active') patch.published_at = new Date().toISOString()
    const { error } = await supabase.from('offerings').update(patch).eq('id', oid)
    setBusy(null)
    if (error) { setErr(error.message); return }
    setStatus(next)
    router.refresh()
  }

  // ── Фото ──────────────────────────────────────────────────────────────────
  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || !offeringId) return
    setMediaErr(''); setBusy('media')
    let position = mediaList.reduce((mx, x) => Math.max(mx, x.position), -1) + 1
    const added: MediaRow[] = []

    for (const file of Array.from(files)) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`
      // Первый сегмент пути — tenant_id: политика хранилища разбирает
      // владельца именно из него, другой путь она отвергнет.
      const path = `${tenantId}/offerings/${offeringId}/${name}`
      // Бакет пропускает только картинки по mime. Некоторые камеры отдают
      // файл с пустым type — тогда берём его из расширения, иначе загрузка
      // упрётся в text/plain по умолчанию и будет отклонена.
      const mime = file.type
        || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp'
          : ext === 'avif' ? 'image/avif' : ext === 'gif' ? 'image/gif' : 'image/jpeg')

      const up = await supabase.storage.from('media')
        .upload(path, file, { contentType: mime, upsert: false })
      if (up.error) { setMediaErr(up.error.message); break }

      const { data, error } = await supabase.from('offering_media').insert({
        tenant_id: tenantId, offering_id: offeringId, path, position,
      }).select('id, path, position').single()

      if (error || !data) {
        // Файл уже в хранилище, а строки нет — убираем файл сразу,
        // иначе он останется невидимым мусором навсегда.
        await supabase.storage.from('media').remove([path])
        setMediaErr(error?.message ?? t('catalog.form.media.error.save'))
        break
      }
      added.push(data as MediaRow)
      position += 1
    }

    if (added.length > 0) setMediaList([...mediaList, ...added])
    setBusy(null)
    router.refresh()
  }

  async function removeMedia(item: MediaRow) {
    setMediaErr(''); setBusy(`media-${item.id}`)
    const { error } = await supabase.from('offering_media').delete().eq('id', item.id)
    if (error) { setMediaErr(error.message); setBusy(null); return }
    // Строку убрали — файл больше никто не найдёт, но место он занимает.
    await supabase.storage.from('media').remove([item.path])
    setMediaList(mediaList.filter((x) => x.id !== item.id))
    setBusy(null)
    router.refresh()
  }

  async function moveMedia(index: number, dir: -1 | 1) {
    const other = index + dir
    if (other < 0 || other >= mediaList.length) return
    const a = mediaList[index]
    const b = mediaList[other]
    setMediaErr(''); setBusy(`media-${a.id}`)

    // Меняем местами сами значения position, а не пересчитываем весь список:
    // порядок остаётся верным даже при пропусках в нумерации.
    const [r1, r2] = await Promise.all([
      supabase.from('offering_media').update({ position: b.position }).eq('id', a.id),
      supabase.from('offering_media').update({ position: a.position }).eq('id', b.id),
    ])
    setBusy(null)
    if (r1.error || r2.error) { setMediaErr((r1.error ?? r2.error)!.message); return }

    const list = [...mediaList]
    list[index] = { ...b, position: a.position }
    list[other] = { ...a, position: b.position }
    setMediaList(list)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Шапка: где мы и что с позицией */}
      <div className="rise flex flex-wrap items-center gap-3">
        <Link href="/app/catalog" className="btn-ghost">← {t('catalog.form.back')}</Link>
        {offeringId && (
          <span className={status === 'active' ? 'badge-success'
            : status === 'draft' ? 'badge-warn' : 'badge'}>
            {statusLabel(t, status)}
          </span>
        )}
        {/* Отметка на том же месте, что в карточке засоба: человек обязан
            понять, почему поля не набираются, не нажав ни одного из них. */}
        {!canWrite && <span className="badge">{t('catalog.form.readonly.badge')}</span>}
        {canWrite && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {saved && (
              <span className="t-md rise" style={{ color: 'var(--color-success)' }}>
                {t('common.saved')}
              </span>
            )}
            <button type="button" className="btn-secondary" disabled={busy !== null}
                    onClick={() => void save()}>
              {busy === 'save' ? t('common.saving') : t('common.save')}
            </button>
            {offeringId && status !== 'active' && (
              <button type="button" className="btn-primary" disabled={busy !== null}
                      onClick={() => void changeStatus('active')}>
                {t('catalog.form.publish')}
              </button>
            )}
            {offeringId && status === 'active' && (
              <button type="button" className="btn-secondary" disabled={busy !== null}
                      onClick={() => void changeStatus('draft')}>
                {t('catalog.form.unpublish')}
              </button>
            )}
            {offeringId && status !== 'archived' && (
              <button type="button" className="btn-danger" disabled={busy !== null}
                      onClick={() => void changeStatus('archived')}>
                {t('catalog.form.archive')}
              </button>
            )}
          </div>
        )}
      </div>

      {!canWrite && (
        <p className="field-hint rise !mt-0">{t('catalog.form.readonly.hint')}</p>
      )}

      {err && <p className="field-error rise">{err}</p>}

      {/* Основное */}
      <section className="card rise-1 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.kind.label')}</label>
          {offeringId ? (
            <>
              <span className="badge-accent">
                {isService ? t('catalog.kind.service') : t('catalog.kind.product')}
              </span>
              <p className="field-hint">{t('catalog.form.kind.hint')}</p>
            </>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => changeKind('product')} disabled={!canWrite}
                      className={kind === 'product' ? 'chip-active' : 'chip'}>
                {t('catalog.form.kind.product')}
              </button>
              <button type="button" onClick={() => changeKind('service')} disabled={!canWrite}
                      className={kind === 'service' ? 'chip-active' : 'chip'}>
                {t('catalog.form.kind.service')}
              </button>
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.title.label')}</label>
          <input required className="input" value={title} disabled={!canWrite}
                 placeholder={isService
                   ? t('catalog.form.title.placeholder.service')
                   : t('catalog.form.title.placeholder.product')}
                 onChange={(e) => {
                   setTitle(e.target.value)
                   if (!slugTouched) setSlug(slugify(e.target.value))
                 }} />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.slug.label')}</label>
          <input className="input" value={slug} disabled={!canWrite}
                 onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }}
                 onBlur={(e) => setSlug(slugify(e.target.value || title))} />
          {/* Про публичный адрес говорим только тому, у кого есть витрина:
              без модуля `storefront` страницы `/t/…` у заведения нет,
              и обещание ссылки было бы неправдой. Само поле остаётся —
              `slug` уникален внутри заведения и нужен строке в любом
              случае, витрина лишь делает его видимым снаружи. */}
          {/* Две развилки — две строки словаря целиком, а не общее начало
              плюс хвост: в другом языке предложение строится иначе. */}
          <p className="field-hint">
            {hasStorefront
              ? t('catalog.form.slug.hint.storefront', { slug: slug || '…' })
              : t('catalog.form.slug.hint.plain')}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.subtitle.label')}</label>
          <input className="input" value={subtitle} disabled={!canWrite}
                 onChange={(e) => setSubtitle(e.target.value)}
                 placeholder={isService
                   ? t('catalog.form.subtitle.placeholder.service')
                   : t('catalog.form.subtitle.placeholder.product')} />
        </div>

        <div>
          <label className="field-label">{t('catalog.form.category.label')}</label>
          <select className="select" value={categoryId} disabled={!canWrite}
                  onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('catalog.form.category.none')}</option>
            {catOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="field-hint">{t('catalog.form.category.hint')}</p>
        </div>

        <div>
          <label className="field-label">{t('catalog.form.sku.label')}</label>
          <input className="input" value={sku} onChange={(e) => setSku(e.target.value)}
                 disabled={!canWrite}
                 placeholder={t('catalog.form.sku.placeholder')} />
        </div>

        <div>
          <label className="field-label">{t('catalog.form.price.label')}</label>
          <input className="input" inputMode="decimal" value={price} disabled={!canWrite}
                 onChange={(e) => setPrice(e.target.value)} />
          <p className="field-hint">{t('catalog.form.price.hint')}</p>
        </div>

        <div>
          <label className="field-label">{t('catalog.form.compareAt.label')}</label>
          <input className="input" inputMode="decimal" value={compareAt}
                 disabled={!canWrite}
                 onChange={(e) => setCompareAt(e.target.value)}
                 placeholder={t('catalog.form.compareAt.placeholder')} />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.description.label')}</label>
          <textarea className="textarea" value={description} disabled={!canWrite}
                    onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label">{t('catalog.form.tags.label')}</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)}
                 disabled={!canWrite}
                 placeholder={t('catalog.form.tags.placeholder')} />
        </div>

        {/* Галка — про витрину, а не про каталог: она решает, попадёт ли
            позиция в ОБЩИЙ каталог маркетплейса. Заведению без модуля
            `storefront` предлагать это нельзя — показывать его позиции
            снаружи негде. */}
        {hasStorefront && (
        <label className="t-md flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={listed} disabled={!canWrite}
                 onChange={(e) => setListed(e.target.checked)} />
          {t('catalog.form.listed.label')}
        </label>
        )}
      </section>

      {/* Условия записи — только у услуг и только с модулем «Записи»:
          передоплата, окно отмены и горизонт записи применяются
          экраном `/app/bookings` и формой записи на витрине. Без модуля
          их некому прочитать, а продавец их заполняет и ждёт действия. */}
      {isService && hasBookings && (
        <section className="card rise-2 grid gap-4 sm:grid-cols-3">
          <h2 className="t-lg sm:col-span-3">{t('catalog.form.booking.title')}</h2>
          <div>
            <label className="field-label">{t('catalog.form.booking.deposit.label')}</label>
            <input className="input" inputMode="numeric" value={deposit}
                   disabled={!canWrite}
                   onChange={(e) => setDeposit(e.target.value)} />
            <p className="field-hint">{t('catalog.form.booking.deposit.hint')}</p>
          </div>
          <div>
            <label className="field-label">{t('catalog.form.booking.cancel.label')}</label>
            <input className="input" inputMode="numeric" value={cancelHours}
                   disabled={!canWrite}
                   onChange={(e) => setCancelHours(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{t('catalog.form.booking.horizon.label')}</label>
            <input className="input" inputMode="numeric" value={horizon}
                   disabled={!canWrite}
                   onChange={(e) => setHorizon(e.target.value)} />
          </div>
        </section>
      )}

      {/* Варианты */}
      <section className="card rise-2 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-lg">
            {isService
              ? t('catalog.form.variants.title.service')
              : t('catalog.form.variants.title.product')}
          </h2>
          {canWrite && (
            <button type="button" className="btn-secondary t-sm"
                    onClick={() => setDrafts([...drafts, emptyDraft(kind)])}>
              {t('catalog.form.variants.add')}
            </button>
          )}
        </div>
        <p className="field-hint !mt-0">
          {isService
            ? t('catalog.form.variants.hint.service')
            : t('catalog.form.variants.hint.product')}
        </p>

        {drafts.map((d, i) => (
          <div key={d.key} className="card-flat grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 flex items-center justify-between gap-3">
              <span className="tabular t-xs prose-muted">
                {t('catalog.form.variant.n', { n: i + 1 })}
              </span>
              <div className="flex items-center gap-3">
                <label className="t-xs flex items-center gap-2">
                  <input type="checkbox" checked={d.isActive} disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { isActive: e.target.checked })} />
                  {t('catalog.form.variant.active')}
                </label>
                {canWrite && drafts.length > 1 && (
                  <button type="button" className="btn-ghost !px-2 t-sm"
                          onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}>
                    {t('catalog.form.variant.remove')}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="field-label">{t('catalog.form.variant.name.label')}</label>
              <input className="input" value={d.name} disabled={!canWrite}
                     placeholder={isService
                       ? t('catalog.form.variant.name.placeholder.service')
                       : t('catalog.form.variant.name.placeholder.product')}
                     onChange={(e) => patchDraft(d.key, { name: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('catalog.form.variant.sku.label')}</label>
              <input className="input" value={d.sku} disabled={!canWrite}
                     onChange={(e) => patchDraft(d.key, { sku: e.target.value })} />
            </div>

            <div>
              <label className="field-label">{t('catalog.form.price.label')}</label>
              <input className="input" inputMode="decimal" value={d.price}
                     disabled={!canWrite}
                     onChange={(e) => patchDraft(d.key, { price: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('catalog.form.compareAt.label')}</label>
              <input className="input" inputMode="decimal" value={d.compareAt}
                     disabled={!canWrite}
                     onChange={(e) => patchDraft(d.key, { compareAt: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('catalog.form.variant.cost.label')}</label>
              <input className="input" inputMode="decimal" value={d.cost}
                     disabled={!canWrite}
                     onChange={(e) => patchDraft(d.key, { cost: e.target.value })} />
            </div>

            {isService ? (
              <>
                <div>
                  <label className="field-label">{t('catalog.form.variant.duration.label')}</label>
                  <input className="input" inputMode="numeric" value={d.duration}
                         disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { duration: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.buffer.label')}</label>
                  <input className="input" inputMode="numeric" value={d.buffer}
                         disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { buffer: e.target.value })} />
                  <p className="field-hint">{t('catalog.form.variant.buffer.hint')}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="field-label">{t('catalog.form.variant.unit.label')}</label>
                  <input className="input" value={d.unit} disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { unit: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.weight.label')}</label>
                  <input className="input" inputMode="numeric" value={d.weight}
                         disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { weight: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.barcode.label')}</label>
                  <input className="input" value={d.barcode} disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { barcode: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.location.label')}</label>
                  <select className="select" value={d.locationId} disabled={!canWrite}
                          onChange={(e) => patchDraft(d.key, { locationId: e.target.value })}>
                    <option value="">{t('catalog.form.variant.location.none')}</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.threshold.label')}</label>
                  <input className="input" inputMode="numeric" value={d.threshold}
                         disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { threshold: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">{t('catalog.form.variant.stock.label')}</label>
                  <div className="flex h-11 items-center gap-2">
                    <span className="badge tabular">
                      {d.trackStock
                        ? `${t.number(d.stockQty)} ${d.unit || DEFAULT_UNIT}`
                        : t('catalog.form.variant.stock.untracked')}
                    </span>
                    {d.reservedQty > 0 && (
                      <span className="badge tabular">
                        {t('catalog.form.variant.stock.reserved', { n: t.number(d.reservedQty) })}
                      </span>
                    )}
                  </div>
                  {/* Правило 5: остаток — кэш журнала движений, вписать его
                      в форму нельзя, триггер отклонит такой update.
                      Ссылка на «Склад» — только тем, у кого есть `stock.read`:
                      у `accountant` его нет (0001), и раздел молча вернул бы
                      его на «Сьогодні». */}
                  {/* Ссылка внутри предложения — три ключа: разметки
                      в словаре не бывает. Ветка без права на склад —
                      отдельная строка целиком, а не та же с вырезанной
                      ссылкой: предложение в ней другое. */}
                  <p className="field-hint">
                    {canStock ? (
                      <>
                        {t('catalog.form.variant.stock.hint.pre')}{' '}
                        <Link href="/app/inventory" className="underline">
                          {t('catalog.form.variant.stock.hint.link')}
                        </Link>{' '}
                        {t('catalog.form.variant.stock.hint.post')}
                      </>
                    ) : t('catalog.form.variant.stock.hint.plain')}
                  </p>
                </div>
                <label className="t-md flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" checked={d.trackStock} disabled={!canWrite}
                         onChange={(e) => patchDraft(d.key, { trackStock: e.target.checked })} />
                  {t('catalog.form.variant.track.label')}
                </label>
              </>
            )}
          </div>
        ))}
      </section>

      {/* Фото */}
      <section className="card rise-3 flex flex-col gap-3">
        <h2 className="t-lg">{t('catalog.form.media.title')}</h2>

        {!offeringId ? (
          <p className="field-hint !mt-0">{t('catalog.form.media.later')}</p>
        ) : (
          <>
            {canWrite && (
              <label className="btn-secondary w-fit cursor-pointer">
                {busy === 'media' ? t('catalog.form.media.uploading') : t('catalog.form.media.add')}
                <input type="file" accept="image/*" multiple className="hidden"
                       disabled={busy !== null}
                       onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
              </label>
            )}

            {mediaErr && <p className="field-error">{mediaErr}</p>}

            {mediaList.length === 0 ? (
              <p className="field-hint !mt-0">
                {canWrite
                  ? t('catalog.form.media.empty.write')
                  : t('catalog.form.media.empty.read')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {mediaList.map((item, i) => (
                  <div key={item.id} className="card-flat !p-2">
                    {/* Миниатюра из публичного бакета; размеров оригинала
                        мы не храним, поэтому обычный img. */}
                    <img src={publicUrl(item.path)} alt=""
                         className="mb-2 aspect-square w-full object-cover"
                         style={{ borderRadius: 'var(--radius-control)' }} />
                    {canWrite && (
                      <div className="flex items-center justify-between">
                        <div className="flex">
                          <button type="button" className="btn-icon"
                                  aria-label={t('catalog.form.media.up.aria')}
                                  disabled={i === 0 || busy !== null}
                                  onClick={() => void moveMedia(i, -1)}>↑</button>
                          <button type="button" className="btn-icon"
                                  aria-label={t('catalog.form.media.down.aria')}
                                  disabled={i === mediaList.length - 1 || busy !== null}
                                  onClick={() => void moveMedia(i, 1)}>↓</button>
                        </div>
                        <button type="button" className="btn-icon"
                                aria-label={t('catalog.form.media.remove.aria')}
                                disabled={busy !== null}
                                onClick={() => void removeMedia(item)}>✕</button>
                      </div>
                    )}
                    {i === 0 && (
                      <p className="t-xs text-center prose-muted">
                        {t('catalog.form.media.cover')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={busy !== null}
                  onClick={() => void save()}>
            {busy === 'save' ? t('common.saving')
              : offeringId ? t('catalog.form.saveChanges') : t('catalog.form.saveDraft')}
          </button>
          {!offeringId && (
            <p className="field-hint !mt-0">{t('catalog.form.draftHint')}</p>
          )}
        </div>
      )}
    </div>
  )
}
