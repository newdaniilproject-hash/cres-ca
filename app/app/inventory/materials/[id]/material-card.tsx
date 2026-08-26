'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { Fold } from '@/components/fold'
import { RemoveEntity } from '@/components/remove-entity'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { MaterialForm, type MaterialInit, type RefItem } from '../../material-form'
import { EXPIRY_KEY } from '../../inventory-client'
import { EXPIRY_BADGE, expiryState } from '@/lib/expiry'
import { dbErrorText } from '@/lib/errors/db'
import { IconBeaker, IconBox, IconDoc, IconQr } from '@/components/icons'
// Подпись типа движения берётся ТАМ ЖЕ, где её берёт журнал движений:
// второй список `receipt → прихід` разъехался бы с первым в тот день,
// когда в enum добавят значение (правило «один источник правды»).
import { movementLabel } from '../../movements/movements-client'
import type { DocKind } from '@/lib/documents'

export type Batch = {
  id: string; number: string
  made: string | null; expiry: string
  received: string; supplierId: string | null
}
export type Container = {
  id: string; code: string; status: string
  volume: number | null; unit: string | null
  openedAt: string | null; useBy: string | null
  decantedAt: string | null; parentId: string | null
}
/** Документ засоба без пути к файлу: сам файл открывает подэкран `docs/`. */
export type MaterialDoc = {
  id: string; kind: DocKind; title: string; createdAt: string
}
/** Строка журнала движений по этому засобу. */
export type Movement = {
  id: string; type: string; qty: number; note: string | null; at: string
}

/** Вкладки широкого экрана (хендофф CRESKO Web, §9 «Картка товару»). */
type WebTab = 'batches' | 'containers' | 'movements' | 'docs'

// Строка «поле — значение». Ровно та таблица, что на макете: подпись
// слева серым, значение справа. Отдельным компонентом, потому что таких
// строк на экране одиннадцать и разъехаться они не должны.
function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className={`kv-val ${mono ? 'tabular' : ''}`}>{value}</span>
    </div>
  )
}

export function MaterialCard({
  tenantId, canWrite, hasCompliance, material, isActive, stock, batches,
  containers, docsCount, docs, movements, suppliers, locations,
}: {
  tenantId: string
  canWrite: boolean
  /**
   * У заведения подключён модуль `compliance`. Подэкран документов стоит
   * именно на нём, а карточка — на `inventory`: без этого признака строка
   * «Документи та сертифікати» вела бы на экран отказа. Дверь в чужой
   * модуль прячется, а не показывает `<ModuleOff>`.
   */
  hasCompliance: boolean
  material: MaterialInit
  /** Засіб в обращении. Показывается значком, формой не правится. */
  isActive: boolean
  /**
   * Остаток на складе. `null` — у читателя нет `stock.read` (инспектор):
   * строка «В наявності» не показывается вовсе. Ноль и «нет права» —
   * разные вещи, и подменять второе первым значит соврать в карточке.
   */
  stock: number | null
  batches: Batch[]
  containers: Container[]
  docsCount: number
  docs: MaterialDoc[]
  /**
   * Журнал движений по засобу. Пустой массив у того, у кого нет
   * `stock.read`: RLS не отдала строк — и вкладка не рисуется.
   */
  movements: Movement[]
  suppliers: RefItem[]
  locations: RefItem[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const photoUrl = (p: string) => supabase.storage.from('media').getPublicUrl(p).data.publicUrl
  const router = useRouter()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [batchEdit, setBatchEdit] = useState<Batch | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [relocate, setRelocate] = useState(false)
  const [relocBusy, setRelocBusy] = useState(false)
  // Вкладка широкого экрана. На телефоне её нет вовсе: там секции лежат
  // одна под другой, и переключатель прятал бы половину карточки за
  // лишним нажатием.
  const [tab, setTab] = useState<WebTab>('batches')
  // ── Раскрытая секция телефона ────────────────────────────────────────
  //
  // Ключ ОДИН, а не набор: открыта ровно одна секция, нажатие на вторую
  // закрывает первую — то же правило, что в реестре склада, и заведено
  // оно тем же требованием владельца («чтобы не занимать полотно целое»).
  //
  // Стартовое значение `null` — все свёрнуты. На складе стартовой была
  // «Потребує уваги», потому что там есть что кричать; здесь ответ
  // на главный вопрос карточки (диюча партия и срок) стоит РАЗВЁРНУТЫМ
  // всегда, вне акордеонов, и открывать сверх него нечего.
  const [fold, setFold] = useState<string | null>(null)
  const toggleFold = (key: string) => setFold((k) => (k === key ? null : key))

  // Действующая партия — та, что кончится раньше остальных ещё не
  // просроченных. Именно её номер и срок инспектор ждёт в карточке.
  // Если все просрочены — показываем последнюю: скрывать просрочку
  // нельзя, это и есть предмет проверки.
  const active = useMemo(() => {
    const live = batches.filter((b) => expiryState(b.expiry) !== 'expired')
    return live[0] ?? batches[batches.length - 1] ?? null
  }, [batches])

  const state = expiryState(active?.expiry)
  const opened = containers.filter((c) => c.status === 'opened')

  // Имена справочников — одним поиском на обе раскладки. Два одинаковых
  // `find` в разметке расходятся ровно тогда, когда правят один из них.
  const supplierName = (id: string | null) =>
    suppliers.find((s) => s.id === id)?.name ?? null
  const locationName = locations.find((l) => l.id === material.locationId)?.name ?? null

  // ── Мета шапки §9: три строки «підпис: значення» ─────────────────────
  //
  // Собрана списком, а не разметкой: строк три, пар в них разное число,
  // и разложенная по JSX она превращается в четыре вложенные тернарки.
  // Пустая пара выпадает целиком — «Бренд: —» это не факт о засобі,
  // а сообщение о незаполненном поле формы, и в паспорте ему не место.
  // Штрих-кода среди пар нет намеренно: привязки `material_barcodes`
  // в карточку не приходят, а показать вместо кода артикул под чужой
  // подписью значит соврать в паспорте.
  type MetaPair = [label: string, value: string, mono: boolean]
  const webMeta: MetaPair[][] = ([
    [
      material.category
        ? [t('inventory.material.row.category'), material.category, false] as MetaPair
        : null,
      material.brand
        ? [t('inventory.material.row.brand'), material.brand, false] as MetaPair
        : null,
    ].filter((x): x is MetaPair => x !== null),
    material.sku
      ? [[t('inventory.material.row.sku'), material.sku, true] as MetaPair]
      : [],
    [[t('inventory.material.row.unit'), material.unit, false] as MetaPair],
  ] as MetaPair[][]).filter((line) => line.length > 0)

  // ── CRESKO Web, §9: вкладки карточки ─────────────────────────────────
  // Вкладка заводится только под то, что на карточке ЕСТЬ. «Історія руху»
  // пропадает у того, кому RLS не отдала журнал (инспектор), — пустая
  // вкладка это обещание, за которым ничего нет. «Партії», «Ємності»
  // и «Документи» остаются всегда: у них пустое состояние само по себе
  // сообщение — партии нет («перевірка не приймає засіб»), документов нет
  // («потрібні»), банка не заведена (вход в контроль вскрытия).
  const webTabs: { key: WebTab; label: string; n: number; show: boolean }[] = [
    { key: 'batches', label: t('inventory.material.web.tab.batches'), n: batches.length, show: true },
    { key: 'containers', label: t('inventory.material.web.tab.containers'), n: containers.length, show: true },
    { key: 'movements', label: t('inventory.material.web.tab.movements'), n: movements.length, show: movements.length > 0 },
    // Вкладка документов — только когда модуль соответствия у заведения
    // есть: подэкран `docs/` стоит на нём, и без модуля вкладка вела бы
    // на `<ModuleOff>`.
    { key: 'docs', label: t('inventory.material.web.tab.docs'), n: docsCount, show: hasCompliance },
  ]

  // Колонки таблиц CRESKO Web: единственное место, где размер задаётся
  // строкой, — так велит `.wtable` (грид задаёт экран, а не файл стилей).
  const GRID_BATCH = '1.1fr .9fr .9fr .9fr 1.2fr .9fr 40px'
  const GRID_CONT = '1.2fr .8fr .9fr .9fr .9fr 40px'
  const GRID_MOVE = '1fr 1fr .8fr 2fr'
  const GRID_DOC = '1.2fr 2fr .9fr'

  // Цвет остатка в стат-ряду: красное — нечего выдавать, жёлтое — ниже
  // порога, зелёное — норма. Порог берётся тот же, каким мобильная
  // карточка ставит значок «мінімум N».
  const stockTone = stock == null || stock <= 0
    ? 'var(--color-danger)'
    : material.threshold > 0 && stock <= material.threshold
      ? 'var(--color-warn)'
      : 'var(--color-success)'

  async function saveBatch(form: {
    number: string; made: string; expiry: string; supplierId: string
  }) {
    setBusy(true)
    const row = {
      batch_number: form.number.trim(),
      manufactured_date: form.made || null,
      expiry_date: form.expiry,
      supplier_id: form.supplierId || null,
    }
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = batchEdit && batchEdit !== 'new'
      ? await supabase.from('material_batches').update(row).eq('id', batchEdit.id)
      : await supabase.from('material_batches').insert({
          tenant_id: tenantId, material_id: material.id,
          created_by: user!.id, ...row,
        })
    setBusy(false)
    if (error) {
      // Экранный переводчик даёт лучшую подпись для дубля; запасной
      // путь — общий разбор dbErrorText, а не сырой текст Postgres (М25).
      toast.error(t('inventory.material.batch.saveError'), error.code === '23505'
        ? t('inventory.material.batch.duplicate')
        : dbErrorText(t, error))
      return
    }
    setBatchEdit(null)
    toast.success(t('inventory.material.batch.saved'))
    router.refresh()
  }

  // Перемещение — функцией relocate_stock (0113), а не правкой location_id:
  // функция пишет след в журнал движений («кто, когда, откуда и куда»),
  // прямой UPDATE переносит банку молча. Форма правки места в карточке
  // остаётся для заведения; осознанный перенос — только отсюда.
  async function doRelocate(locationId: string, note: string) {
    if ((locationId || null) === (material.locationId ?? null)) {
      toast.error(t('inventory.material.relocate.error'),
        t('inventory.material.relocate.same'))
      return
    }
    setRelocBusy(true)
    const { error } = await supabase.rpc('relocate_stock', {
      p_material_id: material.id,
      p_location_id: locationId || null,
      p_note: note.trim() || null,
    })
    setRelocBusy(false)
    if (error) {
      toast.error(t('inventory.material.relocate.error'), dbErrorText(t, error))
      return
    }
    setRelocate(false)
    toast.success(t('inventory.material.relocate.done'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-5">

      {/* ═══ CRESKO Web, §9 «Картка товару» — ТОЛЬКО lg ══════════════════
          Второй визуальный язык кабинета (решение владельца 19.08.2026),
          а не вторая копия карточки: разметка своя, а состояние, шторки
          и все действия — те же самые. Кнопка «Редагувати» здесь и внизу
          открывает ОДНУ шторку; два набора обработчиков разъехались бы
          на первой правке.

          Мобильная карточка ниже уходит под `lg:hidden` целиком: смешивать
          «ключ → значение» мобильного паспорта с колоночной раскладкой
          веба значит показать одни и те же поля дважды на одном экране. */}
      <div className="hidden flex-col gap-5 lg:flex">

        {/* ── «Назад до складу» ─────────────────────────────────────
            В веб-каркасе имя открытого ПОДЭКРАНА не пишет никто:
            сайдбар подсвечивает раздел «Склад», а стрелка «назад»
            из мобильной шапки на широком экране не рисуется. Без этой
            ссылки выход из карточки — только повторное нажатие пункта
            сайдбара, то есть человек возвращается не туда, откуда
            пришёл, а в начало раздела. §9 ставит её первой строкой. */}
        <Link href="/app/inventory"
              className="inline-flex items-center gap-2 self-start"
              style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-accent-ink)' }}>
          <span aria-hidden>←</span>
          {t('inventory.web.back')}
        </Link>

        {/* ── Шапка: фото 216×216 слева, имя и мета справа ──────────
            БЕЗ карточки под собой — так в §9: фото и заголовок стоят
            прямо на фоне страницы, а первая белая плоскость экрана —
            это стат-ряд ниже. Пока шапка была `.webcard`, имя засоба
            и стат-ряд читались как две одинаковые карточки подряд,
            и глазу не за что было зацепиться.
            Радиус 16 — тот же, что у `.webcard`; фото раздаётся из
            публичного бакета `media` (0111), поэтому обычный <img>,
            а не next/image: оптимизатор был бы ещё одним прокси
            на пути картинки без выигрыша.
            Пустого серого прямоугольника нет: без фото стоит плашка
            со значком — она читается как «фото не додали», а серый
            прямоугольник как «не завантажилось». */}
        <section className="flex gap-5">
          {material.imagePath ? (
            <span className="h-[216px] w-[216px] shrink-0 overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(material.imagePath)} alt=""
                   className="h-full w-full object-cover" />
            </span>
          ) : (
            <span className="flex h-[216px] w-[216px] shrink-0 items-center justify-center rounded-2xl"
                  style={{
                    background: 'var(--color-surface)',
                    // Пунктир, а не сплошная линия: §9 рисует место
                    // под фото именно так — это «сюда можно положить»,
                    // а не «здесь рамка карточки».
                    border: '1px dashed var(--color-border-strong, var(--color-border))',
                    color: 'var(--color-faint)',
                  }}>
              <IconBox size={40} />
            </span>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {/* Имя засоба — данные арендатора, не переводится. */}
                <h1 className="webh1" data-size="27">{material.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>
                  <span className={isActive ? 'badge-success' : 'badge'}>
                    {isActive
                      ? t('inventory.material.web.active')
                      : t('inventory.material.web.inactive')}
                  </span>
                  {material.isCosmetic && (
                    <span className="badge-accent">{t('inventory.material.badge.cosmetic')}</span>
                  )}
                  {!canWrite && <span className="badge">{t('inventory.material.badge.readonly')}</span>}
                </div>
              </div>
              {/* Действия карточки — те же две, что и на телефоне.
                  «Перемістити» стоит здесь, а не отдельной карточкой
                  справа: место зберігання уже названо в стат-ряду ниже,
                  и карточка с тем же значением была бы вторым его
                  показом на одном экране. */}
              {canWrite && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary"
                          onClick={() => setEdit(true)}>
                    {t('inventory.material.edit')}
                  </button>
                  {stock !== null && (
                    <button type="button" className="btn-secondary"
                            onClick={() => setRelocate(true)}>
                      {t('inventory.material.relocate.action')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Три строки меты (§9). Штрих-кода среди них нет намеренно:
                привязки `material_barcodes` в карточку не приходят,
                а показывать вместо кода артикул под чужой подписью
                значит соврать в паспорте. */}
            {/* Подпись серым, значение тёмным и полужирным — так в §9
                («Категорія: Манікюр • Бренд: Kodi Professional»).
                Прежде вся строка шла одним серым тоном, и в «Манікюр ·
                Kodi Professional» не было видно, где кончается категория
                и начинается бренд. Разделитель между парами — точка,
                как в референсе. */}
            <div className="mt-4 flex flex-col gap-1.5" style={{ fontSize: 14 }}>
              {webMeta.map((line, li) => (
                <p key={li} className="flex flex-wrap items-baseline gap-x-2">
                  {line.map(([label, value, mono], i) => (
                    <span key={label} className="flex items-baseline gap-1.5">
                      {i > 0 && <span aria-hidden style={{ color: 'var(--color-faint)' }}>·</span>}
                      <span style={{ color: 'var(--color-muted)' }}>{label}:</span>
                      {/* Значение — данные арендатора. */}
                      <span className={mono ? 'tabular' : ''}
                            style={{ color: 'var(--color-text)', fontWeight: 650 }}>
                        {value}
                      </span>
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── Стат-ряд ──────────────────────────────────────────────
            Четыре величины через пунктирные делители (README). Весь ряд
            коммерческий: у инспектора запрос к `materials` вернул пустоту
            (stock === null), и ряд не рисуется вовсе — той же логикой,
            какой у него не рисуется строка «В наявності».
            Кегль числа — `.wmetric-value`, существующий примитив: свой
            размер здесь был бы шестым источником правды о типографике. */}
        {stock !== null && (
          <section className="webcard flex">
            {([
              {
                key: 'stock', label: t('inventory.web.table.stock'),
                value: `${t.number(stock)} ${material.unit}`, tone: stockTone,
              },
              {
                key: 'threshold', label: t('inventory.material.threshold.label'),
                value: material.threshold > 0
                  ? `${t.number(material.threshold)} ${material.unit}`
                  : '—',
                tone: undefined,
              },
              {
                key: 'cost', label: t('inventory.material.row.cost'),
                value: material.cost != null ? t.money(material.cost) : '—',
                tone: undefined,
              },
              {
                key: 'location', label: t('inventory.material.location.label'),
                value: locationName ?? t('inventory.material.relocate.none'),
                tone: undefined,
              },
            ] as const).map((s, i) => (
              <div key={s.key} className="min-w-0 flex-1 px-5 first:pl-0 last:pr-0"
                   style={i > 0
                     ? { borderLeft: '1px dashed var(--web-border-dash, var(--color-border))' }
                     : undefined}>
                <p className="wmetric-label">{s.label}</p>
                {/* 23px/800 — величина §9. Вес и моноширинные цифры берутся
                    у `.wmetric-value`, кегль перебивается: у метрики
                    полосы он 25px, и второй набор правил ради двух
                    пикселей завёл бы ещё один источник типографики. */}
                <p className="wmetric-value tabular truncate"
                   style={{ fontSize: 23, ...(s.tone ? { color: s.tone } : {}) }}>
                  {s.value}
                </p>
              </div>
            ))}
          </section>
        )}

        {/* ── Две колонки: таблицы слева, справочные карточки справа ── */}
        <div className="flex items-start gap-5">
          <div className="flex min-w-0 flex-1 flex-col gap-4">

            <div className="wtabs">
              {webTabs.filter((x) => x.show).map((x) => (
                <button key={x.key} type="button" className="wtab"
                        data-active={tab === x.key} onClick={() => setTab(x.key)}>
                  {x.label}{x.n > 0 ? ` · ${t.number(x.n)}` : ''}
                </button>
              ))}
            </div>

            {/* ── Партії ────────────────────────────────────────────
                Колонки «Залишок» из §9 здесь НЕТ: остаток ведётся
                по засобу, а не по партии (журнал `stock_movements`
                номера партии не хранит), и колонка из повторяющегося
                общего числа врала бы про партионный учёт. Вместо неё —
                постачальник партии, величина настоящая. */}
            {tab === 'batches' && (
              batches.length > 0 ? (
                <div className="wtable">
                  <div className="wtable-head" style={{ gridTemplateColumns: GRID_BATCH }}>
                    <span>{t('inventory.material.web.col.batch')}</span>
                    <span>{t('inventory.material.web.col.received')}</span>
                    <span>{t('inventory.material.web.col.made')}</span>
                    <span>{t('inventory.web.table.expiry')}</span>
                    <span>{t('inventory.material.batchForm.supplier.label')}</span>
                    <span>{t('inventory.material.row.status')}</span>
                    <span aria-hidden />
                  </div>
                  {batches.map((b) => {
                    const s = expiryState(b.expiry)
                    const inner = (
                      <>
                        {/* Номер партии — данные арендатора. */}
                        <span className="tabular truncate font-semibold"
                              style={{ color: 'var(--color-text)' }}>{b.number}</span>
                        <span className="tabular">{t.date(b.received)}</span>
                        <span className="tabular">{t.date(b.made)}</span>
                        <span className="tabular">{t.date(b.expiry)}</span>
                        <span className="truncate">{supplierName(b.supplierId) ?? '—'}</span>
                        <span><span className={EXPIRY_BADGE[s]}>{t(EXPIRY_KEY[s])}</span></span>
                        <span aria-hidden className="text-right"
                              style={{ color: 'var(--color-faint)' }}>
                          {canWrite ? '›' : ''}
                        </span>
                      </>
                    )
                    // Читателю — строка, а не выключенная кнопка: она обещает
                    // действие, которого нет, и глушит фокус с прокруткой.
                    return canWrite ? (
                      <button key={b.id} type="button" className="wtable-row"
                              style={{ gridTemplateColumns: GRID_BATCH, minHeight: 'var(--tap-min)' }}
                              onClick={() => setBatchEdit(b)}>
                        {inner}
                      </button>
                    ) : (
                      <div key={b.id} className="wtable-row"
                           style={{ gridTemplateColumns: GRID_BATCH, minHeight: 'var(--tap-min)' }}>
                        {inner}
                      </div>
                    )
                  })}
                  <div className="wtable-foot">
                    <span className="tabular">
                      {t('inventory.web.table.total', { n: t.number(batches.length) })}
                    </span>
                    {canWrite && (
                      <button type="button" className="btn-secondary"
                              onClick={() => setBatchEdit('new')}>
                        {t('inventory.material.batches.add')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="webcard">
                  <div className="empty">
                    <span className="empty-icon"><IconBox size={24} /></span>
                    <p className="empty-title">{t('inventory.material.batches.emptyTitle')}</p>
                    <p className="empty-desc">{t('inventory.material.batches.emptyDesc')}</p>
                    {canWrite && (
                      <div className="empty-actions">
                        <button type="button" className="btn-primary"
                                onClick={() => setBatchEdit('new')}>
                          {t('inventory.material.batch.create')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {/* ── Ємності ───────────────────────────────────────────
                Открыть банку, разлить в дозатор и напечатать наклейку
                можно только на подэкране контроля вскрытия: там стоят
                функции с ключом идемпотентности (0100). Здесь — показ
                и вход туда, поэтому строка ведёт на `/pao`. */}
            {tab === 'containers' && (
              containers.length > 0 ? (
                <div className="wtable">
                  <div className="wtable-head" style={{ gridTemplateColumns: GRID_CONT }}>
                    <span>{t('inventory.material.web.col.code')}</span>
                    <span>{t('inventory.material.web.col.volume')}</span>
                    <span>{t('inventory.material.web.col.opened')}</span>
                    <span>{t('inventory.material.web.col.useBy')}</span>
                    <span>{t('inventory.material.row.status')}</span>
                    <span aria-hidden />
                  </div>
                  {containers.map((c) => {
                    const s = expiryState(c.useBy)
                    return (
                      <Link key={c.id} href={`/app/inventory/materials/${material.id}/pao`}
                            className="wtable-row"
                            style={{ gridTemplateColumns: GRID_CONT, minHeight: 'var(--tap-min)' }}>
                        {/* Код наліпки — данные арендатора. */}
                        <span className="tabular truncate font-semibold"
                              style={{ color: 'var(--color-text)' }}>{c.code}</span>
                        <span className="tabular">
                          {c.volume != null ? `${t.number(c.volume)} ${c.unit ?? ''}`.trim() : '—'}
                        </span>
                        <span className="tabular">{c.openedAt ? t.date(c.openedAt) : '—'}</span>
                        <span className="tabular">{c.useBy ? t.date(c.useBy) : '—'}</span>
                        <span>
                          {c.status === 'sealed'
                            ? <span className="badge">{t('inventory.container.sealed')}</span>
                            : <span className={EXPIRY_BADGE[s]}>{t(EXPIRY_KEY[s])}</span>}
                        </span>
                        <span aria-hidden className="text-right"
                              style={{ color: 'var(--color-faint)' }}>›</span>
                      </Link>
                    )
                  })}
                  <div className="wtable-foot">
                    <span className="tabular">
                      {t('inventory.web.table.total', { n: t.number(containers.length) })}
                    </span>
                    <Link href={`/app/inventory/materials/${material.id}/pao`}
                          style={{ color: 'var(--color-accent-ink)', fontWeight: 650 }}>
                      {t('inventory.material.pao.title')}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="webcard">
                  <div className="empty">
                    <span className="empty-icon"><IconQr size={24} /></span>
                    <p className="empty-title">{t('inventory.material.web.containers.emptyTitle')}</p>
                    <p className="empty-desc">{t('inventory.material.web.containers.emptyDesc')}</p>
                    <div className="empty-actions">
                      <Link href={`/app/inventory/materials/${material.id}/pao`}
                            className="btn-secondary">
                        {t('inventory.material.pao.title')}
                      </Link>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ── Історія руху ──────────────────────────────────────
                Строки журнала не открываются и не правятся ни здесь,
                ни где-либо ещё: это источник правды об остатке, а не
                нотатник (правило 5). Поэтому строка — не ссылка. */}
            {tab === 'movements' && (
              <div className="wtable">
                <div className="wtable-head" style={{ gridTemplateColumns: GRID_MOVE }}>
                  <span>{t('inventory.material.web.col.date')}</span>
                  <span>{t('inventory.material.web.col.type')}</span>
                  <span>{t('inventory.material.web.col.qty')}</span>
                  <span>{t('inventory.material.web.col.note')}</span>
                </div>
                {movements.map((mv) => (
                  <div key={mv.id} className="wtable-row"
                       style={{ gridTemplateColumns: GRID_MOVE, minHeight: 'var(--tap-min)' }}>
                    <span className="tabular">{t.dateTime(mv.at)}</span>
                    <span>{movementLabel(t, mv.type)}</span>
                    <span className="tabular font-semibold"
                          style={{ color: mv.qty < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                      {mv.qty > 0 ? '+' : ''}{t.number(mv.qty)} {material.unit}
                    </span>
                    {/* Причина — текст продавца, не переводится. */}
                    <span className="truncate">{mv.note ?? '—'}</span>
                  </div>
                ))}
                {/* «Разом» здесь НЕТ намеренно: запрос ограничен последними
                    строками, и число под таблицей читалось бы как «всего
                    движений столько». Вместо него — вход в полный журнал. */}
                <div className="wtable-foot">
                  <span />
                  <Link href="/app/inventory/movements"
                        style={{ color: 'var(--color-accent-ink)', fontWeight: 650 }}>
                    {t('inventory.material.web.movements.all')}
                  </Link>
                </div>
              </div>
            )}

            {/* ── Документи ─────────────────────────────────────────
                Таблица показывает вид, название и дату — но НЕ путь
                к файлу: файл отдаётся подписанной ссылкой на пять минут
                по праву `compliance.read`, и делает это подэкран `docs/`,
                куда ведёт подвал. Пустое состояние оставлено вкладкой
                намеренно: у косметики отсутствие MSDS — это и есть
                предмет проверки, и прятать его нельзя. */}
            {tab === 'docs' && (
              docs.length > 0 ? (
                <div className="wtable">
                  <div className="wtable-head" style={{ gridTemplateColumns: GRID_DOC }}>
                    <span>{t('inventory.material.web.col.kind')}</span>
                    <span>{t('inventory.web.table.item')}</span>
                    <span>{t('inventory.material.web.col.date')}</span>
                  </div>
                  {docs.map((d) => (
                    <div key={d.id} className="wtable-row"
                         style={{ gridTemplateColumns: GRID_DOC, minHeight: 'var(--tap-min)' }}>
                      <span>{t(`documents.kind.${d.kind}.short`)}</span>
                      {/* Название файла — данные арендатора. */}
                      <span className="truncate font-semibold"
                            style={{ color: 'var(--color-text)' }}>{d.title}</span>
                      <span className="tabular">{t.date(d.createdAt)}</span>
                    </div>
                  ))}
                  <div className="wtable-foot">
                    <span className="tabular">
                      {t('inventory.web.table.total', { n: t.number(docsCount) })}
                    </span>
                    <Link href={`/app/inventory/materials/${material.id}/docs`}
                          style={{ color: 'var(--color-accent-ink)', fontWeight: 650 }}>
                      {t('inventory.material.web.docs.manage')}
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="webcard">
                  <div className="empty">
                    <span className="empty-icon"><IconDoc size={24} /></span>
                    <p className="empty-title">{t('inventory.material.docs.title')}</p>
                    <p className="empty-desc">{t('inventory.material.docs.none')}</p>
                    <div className="empty-actions">
                      <Link href={`/app/inventory/materials/${material.id}/docs`}
                            className={material.isCosmetic ? 'btn-primary' : 'btn-secondary'}>
                        {t('inventory.material.web.docs.manage')}
                      </Link>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* ── Правая колонка 340px (README) ────────────────────────
              Карточки под то, что в карточке ЕСТЬ. «Використання
              в техкартах» здесь нет: рецептура (`variant_materials`)
              в карточку не приходит, а карточка с заголовком и без
              содержимого сообщает только о том, что мы про неё помним. */}
          <aside className="flex w-[340px] shrink-0 flex-col gap-4">

            {/* Паспорт: только то, чего НЕТ в шапке. Бренд, артикул,
                категорию и одиницю она уже назвала, и повторять их
                строкой ниже значит завести второй их показ. */}
            <section className="webcard">
              <p className="webh2 mb-3">{t('inventory.material.web.passport.title')}</p>
              <div className="kv">
                <Row label={t('inventory.material.row.country')} value={material.country ?? '—'} />
                <Row label={t('inventory.material.row.pao')}
                     value={material.paoMonths ? `${t.number(material.paoMonths)}M` : '—'} mono />
              </div>
            </section>

            {/* Постачальник засоба — из его карточки, а не из партии:
                у партий он свой и стоит колонкой в таблице. Карточки
                нет вовсе, если поставщик не указан. */}
            {supplierName(material.supplierId ?? null) && (
              <section className="webcard">
                <p className="webh2 mb-3">{t('inventory.material.batchForm.supplier.label')}</p>
                {/* Название поставщика — данные арендатора. */}
                <p style={{ fontSize: 14, color: 'var(--color-text)' }}>
                  {supplierName(material.supplierId ?? null)}
                </p>
              </section>
            )}

            {material.isCosmetic && material.inci && (
              <section className="webcard">
                <p className="webh2 mb-3">{t('inventory.material.inci.title')}</p>
                <p className="t-xs prose-muted">{material.inci}</p>
              </section>
            )}

            {/* Нотификация: только статус и вход. Код, дата и приём
                подтверждения живут на экране документов — подтверждение
                ЕСТЬ документ, и принимается оно там же (0106). */}
            {material.isCosmetic && hasCompliance && (
              <section className="webcard">
                <p className="webh2 mb-3">{t('inventory.material.web.moz.title')}</p>
                <Link href={`/app/inventory/materials/${material.id}/docs`}
                      className={material.notificationConfirmedAt ? 'badge-success' : 'badge-danger'}>
                  {material.notificationConfirmedAt
                    ? t('inventory.material.moz.proof.ok', {
                        date: t.date(material.notificationConfirmedAt),
                      })
                    : `${t('inventory.material.moz.proof.missing')} · ${t('inventory.material.moz.proof.open')}`}
                </Link>
              </section>
            )}

            {/* Заметка и свои поля (0111). Инспектору эти колонки
                не приходят вовсе, и карточка у него не рисуется. */}
            {(material.note || Object.keys(material.attributes ?? {}).length > 0) && (
              <section className="webcard">
                <p className="webh2 mb-3">{t('inventory.material.own.title')}</p>
                {material.note && (
                  <p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{material.note}</p>
                )}
                {Object.keys(material.attributes ?? {}).length > 0 && (
                  <div className={`kv ${material.note ? 'mt-3' : ''}`}>
                    {Object.entries(material.attributes ?? {}).map(([k, v]) => (
                      <Row key={k} label={k} value={v} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {material.cost != null && (
              // С 0112 приёмка пересчитывает себестоимость сама — без этой
              // строки владелец «чинит» цифру руками и ломает средневзвешенную.
              <p className="field-hint">{t('inventory.material.cost.hint')}</p>
            )}
          </aside>
        </div>
      </div>

      {/* ── Шапка карточки ───────────────────────────────────────
          README, розділ C: фото 4:3 (радіус 16), бейдж статусу,
          назва 22px/700, опис 13px/muted — в этом порядке.

          Фото — во всю ширину и ТОЛЬКО когда оно есть. Прежняя запись
          здесь отказывала полосе 4:3 целиком, боясь «отдать треть экрана
          серому прямоугольнику»; условие снимает ровно этот страх, не
          отменяя макета: без фото полосы нет вовсе, а с фото банку
          узнают с расстояния вытянутой руки — ради чего его и снимают.
          Второй показ той же картинки (миниатюра рядом с именем) снят:
          одно изображение на экран.

          Радиус 16px — ступень шкалы README (10 · 12 · 14 · 16 · 18 · 20),
          токен назван по первому применению; своего значения здесь нет. */}
      <section className="card rise-1 flex flex-col gap-2 lg:hidden">
        {material.imagePath && (
          <span className="block w-full overflow-hidden"
                style={{ aspectRatio: '4 / 3', borderRadius: 'var(--radius-calendar)' }}>
            {/* Обычный <img>, а не next/image: файл лежит в публичном
                бакете Supabase, и оптимизатор Next для него означал бы
                ещё один прокси на пути картинки без выигрыша. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(material.imagePath)} alt=""
                 className="h-full w-full object-cover" />
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>
          {material.isCosmetic && (
            <span className="badge-accent">{t('inventory.material.badge.cosmetic')}</span>
          )}
          {!canWrite && <span className="badge">{t('inventory.material.badge.readonly')}</span>}
        </div>
        <h2 className="display t-2xl">{material.name}</h2>
        {/* Опис — 13px/muted (README), то есть `.t-base`, а не 12px:
            подпись под именем и вторичный текст списка — разные роли.

            ⚠️ БЕЗ ТОЧКИ-РАЗДЕЛИТЕЛЯ. Владелец снял их 25.08.2026 на складе,
            и правило не про один экран: бренд и категория — две РАЗНЫЕ
            величины, и разделяет их зазор, а не знак препинания. */}
        <p className="t-base flex flex-wrap items-baseline gap-x-3"
           style={{ color: 'var(--color-muted)' }}>
          {/* Бренд и категория — данные арендатора. */}
          {[material.brand, material.category].filter(Boolean).length > 0
            ? [material.brand, material.category].filter(Boolean)
                .map((v) => <span key={v}>{v}</span>)
            : <span>{t('inventory.material.noCategory')}</span>}
        </p>
        {stock !== null && (
          <p className="tabular t-md">
            {t('inventory.material.inStock')}: <b>{t.number(stock)} {material.unit}</b>
            {material.threshold > 0 && stock <= material.threshold && (
              <span className="badge-warn ml-2">
                {t('inventory.material.minimum', { n: t.number(material.threshold) })}
              </span>
            )}
          </p>
        )}
        {canWrite && (
          <button type="button" className="btn-secondary mt-2 self-start"
                  onClick={() => setEdit(true)}>
            {t('inventory.material.edit')}
          </button>
        )}
      </section>

      {/* ── ДІЇ ТЗ 3.2 — НА КАРТЦІ, А НЕ ЗА ДВЕРИМА ──────────────
          Бриф і розбір 25.08.2026. ТЗ називає щоденною роботою майстра
          вскриття банки і розлив у дозатор, а на картці їх не було
          ВЗАГАЛІ: обидві лежали за рядком «Контроль відкриття та
          фасування» — тобто про них треба було здогадатись. Шлях до
          вскриття був у п'ять переходів.

          Дії ВЕДУТЬ на екран контролю, а не виконують вскриття тут.
          Причина не в ліні: банок у засоба буває кілька, і вибір «яку
          саме» — це і є той екран. Робити другу копію вибору на картці
          значить завести другу реалізацію вскриття зі своєю офлайн-чергою
          і своїм записом у незмінюваний журнал; вони розійдуться.
          Виграш тут у тому, що дію ВИДНО і названо її словами.

          Розлив іде з наміром `?do=decant`: коли відкрита банка одна,
          екран одразу відкриває форму розливу. Той самий приём, що
          `?scan=1` на складі й `?new=1` на прийманні.

          Рядка «Контроль відкриття та фасування» нижче більше немає —
          він вів рівно сюди ж, і два входи в одне місце на одному екрані
          це той самий дубляж, за який переробляли склад. */}
      <section className="rise-2 grid grid-cols-2 gap-2 lg:hidden">
        <Link href={`/app/inventory/materials/${material.id}/pao`} className="quick-tile">
          <span className="quick-tile-icon"><IconQr size={18} /></span>
          {t('inventory.container.open')}
        </Link>
        <Link href={`/app/inventory/materials/${material.id}/pao?do=decant`} className="quick-tile">
          <span className="quick-tile-icon"><IconBeaker size={18} /></span>
          {t('inventory.material.act.decant')}
        </Link>
      </section>

      {/* ── Нотифікація не підтверджена ──────────────────────────
          Гучний блок ТІЛЬКИ тоді, коли справді нема чим підтвердити.
          Код нотифікації — це слова постачальника, а перевірка дивиться
          ДОКУМЕНТ (0106): тому тривожить саме відсутність документа,
          а не відсутність коду.

          Підтверджений стан сюди не потрапляє — він тихим рядком
          у паспорті нижче. Зелена плашка на першому екрані щоразу,
          коли все гаразд, — це шум, на тлі якого червона перестає
          виділятись; те саме правило, що в реєстрі складу. */}
      {material.isCosmetic && hasCompliance && !material.notificationConfirmedAt && (
        <Link href={`/app/inventory/materials/${material.id}/docs`}
              className="rise-2 flex items-center gap-3 lg:hidden"
              style={{
                background: 'var(--color-danger-soft)',
                borderRadius: 'var(--radius-card)',
                padding: 'var(--space-4)',
                minHeight: 'var(--tap-min)',
              }}>
          <span aria-hidden className="hero-dot shrink-0"
                style={{ background: 'var(--color-danger)' }} />
          <span className="min-w-0 flex-1">
            <span className="t-md block" style={{ color: 'var(--color-danger)' }}>
              {t('inventory.material.moz.proof.missing')}
            </span>
            <span className="t-sm block" style={{ color: 'var(--color-danger)', opacity: 0.85 }}>
              {t('inventory.material.moz.proof.open')}
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-danger)' }}>›</span>
        </Link>
      )}

      {/* ── Діюча партія і термін ────────────────────────────────
          Єдиний блок, який лишається розгорнутим завжди: це відповідь
          на питання, з яким відкривають картку. Решта — акордеонами.

          ⚠️ ЗАДВОЄННЯ ЗНЯТО. Тут стояла таблиця діючої партії, а одразу
          під нею — список «Усі партії», в якому та сама партія була
          першим рядком. Тепер список живе в акордеоні і з'являється,
          лише коли партій БІЛЬШЕ ОДНІЄЇ: при одній показувати «усі»
          нічого. */}
      <section className="rise-2 lg:hidden">
        <div className="section-head">
          <p className="eyebrow">{t('inventory.material.batches.title')}</p>
          {canWrite && active && (
            <button type="button" className="btn-ghost t-sm"
                    onClick={() => setBatchEdit('new')}>
              {t('inventory.material.batches.add')}
            </button>
          )}
        </div>

        {active ? (
          <div className="kv">
            {/* Номер партії — дані орендаря, не перекладається. */}
            <Row label={t('inventory.material.row.batchNumber')} value={active.number} mono />
            <Row label={t('inventory.material.row.made')} value={t.date(active.made)} mono />
            <Row label={t('inventory.material.row.expiry')} value={t.date(active.expiry)} mono />
            <Row label={t('inventory.material.row.pao')}
                 value={material.paoMonths ? `${t.number(material.paoMonths)}M` : '—'} mono />
            <Row label={t('inventory.material.row.status')}
                 value={<span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>} />
          </div>
        ) : (
          <div className="card">
            <div className="empty">
              <span className="empty-icon"><IconBox size={24} /></span>
              <p className="empty-title">{t('inventory.material.batches.emptyTitle')}</p>
              <p className="empty-desc">{t('inventory.material.batches.emptyDesc')}</p>
              {canWrite && (
                <div className="empty-actions">
                  <button type="button" className="btn-primary"
                          onClick={() => setBatchEdit('new')}>
                    {t('inventory.material.batch.create')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Документи: підекран, а не акордеон ───────────────────
          Файли відкриваються підписаним посиланням на п'ять хвилин
          і мають свій екран завантаження і підтвердження. Розгортати
          їх тут значить обіцяти вміст, якого на цьому екрані немає.
          Двері в чужий модуль ховаються, а не показують відмову:
          підекран стоїть на модулі `compliance`, картка — на `inventory`. */}
      {hasCompliance && (
        <Link href={`/app/inventory/materials/${material.id}/docs`}
              className="card rise-3 row px-5 lg:hidden"
              style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="list-anchor" data-tone="accent">
            <IconDoc size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-md block">{t('inventory.material.docs.title')}</span>
            {/* Скільки файлів і ЯКІ саме потрібні — дві різні величини,
                і стоять вони порізно з зазором. У словнику вони були
                склеєні крапкою в один рядок («2 файли · MSDS, сертифікати,
                висновок СЕС»), тобто крапка-роздільник ховалась у перекладі
                і пережила прибирання з розмітки. */}
            <span className="t-xs flex flex-wrap items-baseline gap-x-2"
                  style={{ color: 'var(--color-faint)' }}>
              <span>
                {docsCount > 0
                  ? t.plural('inventory.material.docs.count', docsCount)
                  : t('inventory.material.docs.none')}
              </span>
              <span>{t('inventory.material.docs.kinds')}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {material.isCosmetic && docsCount === 0 && (
              <span className="badge-warn">{t('inventory.material.docs.needed')}</span>
            )}
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </span>
        </Link>
      )}

      {/* ── Решта картки — акордеонами, одна відкрита ────────────
          Було вісім секцій одна під одною на 2,2 екрана. Тепер нижче
          згину лежить оглавління: видно, ЩО є і СКІЛЬКИ всередині,
          а розгортається рівно одна секція — те саме правило, що
          в реєстрі складу, і той самий компонент (`components/fold.tsx`),
          щоб липкий підзаголовок і поворот стрілки не розійшлись
          між екранами. */}
      <div className="rise-3 fab-clear flex flex-col gap-2 lg:hidden">

        {/* Ємності цього засоба. До 25.08.2026 картка їх не показувала
            зовсім — лише лічильник у рядку «Контроль відкриття»; щоб
            побачити, яка банка вже відкрита і скільки їй лишилось,
            треба було перейти на інший екран. */}
        {containers.length > 0 && (
          <Fold title={t('inventory.tab.containers')} count={containers.length}
                open={fold === 'containers'} onToggle={() => toggleFold('containers')}>
            <div className="flex flex-col gap-2">
              {containers.map((c) => {
                const s = expiryState(c.useBy)
                return (
                  <Link key={c.id} href={`/app/inventory/materials/${material.id}/pao`}
                        className="list-card">
                    <span className="list-card-thumb"><IconQr size={20} /></span>
                    <span className="min-w-0 flex-1">
                      {/* Код наліпки — дані орендаря. */}
                      <span className="tabular t-md block truncate">{c.code}</span>
                      <span className="t-sm mt-0.5 flex flex-wrap items-baseline gap-x-3">
                        {c.useBy && (
                          <span className={EXPIRY_BADGE[s]}>{t(EXPIRY_KEY[s])}</span>
                        )}
                        <span className="tabular" style={{ color: 'var(--color-faint)' }}>
                          {c.useBy
                            ? t('inventory.container.until', { date: t.date(c.useBy) })
                            : t('inventory.container.sealed')}
                        </span>
                      </span>
                    </span>
                    {c.volume != null && (
                      <span className="tabular t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>
                        {t.number(c.volume)} {c.unit ?? ''}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </Fold>
        )}

        {/* Список партій — тільки коли їх більше однієї: діюча вже
            показана таблицею вище, і «усі партії» з одного рядка
            повторювали б її слово в слово. */}
        {batches.length > 1 && (
          <Fold title={t('inventory.material.fold.batches')} count={batches.length}
                open={fold === 'batches'} onToggle={() => toggleFold('batches')}>
            <div className="flex flex-col gap-2">
              {batches.map((b) => {
                const s = expiryState(b.expiry)
                const inner = (
                  <>
                    <span className="tabular t-md min-w-0 flex-1">{b.number}</span>
                    <span className={`tabular shrink-0 ${EXPIRY_BADGE[s]}`}>
                      {t('inventory.material.batch.until', {
                        date: t.date(b.expiry, { day: 'numeric', month: 'short' }),
                      })}
                    </span>
                  </>
                )
                // Читачеві — div, а не вимкнена кнопка: disabled-кнопка
                // обіцяє дію, якої немає, і глушить прокрутку з фокусом.
                return canWrite ? (
                  <button key={b.id} type="button" onClick={() => setBatchEdit(b)}
                          className="list-card">
                    {inner}
                  </button>
                ) : (
                  <div key={b.id} className="list-card">{inner}</div>
                )
              })}
            </div>
          </Fold>
        )}

        {/* Паспорт (ТЗ 3.1) плюс склад INCI і код нотифікації — одна
            секція, бо це одна відповідь: «що це за засіб за документами».
            Розводити їх по трьох підзаголовках означало три заголовки
            над чотирма рядками кожен. */}
        <Fold title={t('inventory.material.passport.title')}
              open={fold === 'passport'} onToggle={() => toggleFold('passport')}>
          <div className="kv">
            <Row label={t('inventory.material.row.brand')} value={material.brand ?? '—'} />
            <Row label={t('inventory.material.row.sku')} value={material.sku ?? '—'} mono />
            <Row label={t('inventory.material.row.category')} value={material.category ?? '—'} />
            <Row label={t('inventory.material.row.country')} value={material.country ?? '—'} />
          </div>

          {/* INCI — абзац складу, а не рядок таблиці: у «ключ → значення»
              він займав п'ять рядків висоти і ламав ритм решти. Кегль
              13px (`.t-sm`) зі шкали: INCI читають очима, звіряючи
              з етикеткою. */}
          {material.isCosmetic && material.inci && (
            <div className="card mt-2">
              <p className="eyebrow mb-1">{t('inventory.material.inci.title')}</p>
              <p className="t-sm prose-muted">{material.inci}</p>
            </div>
          )}

          {/* Код нотифікації МОЗ. Гучним блоком нагорі стоїть тільки
              ВІДСУТНІСТЬ підтвердження; сам код — довідка, і місце їй тут.
              Посилання веде туди, де нотифікацію правлять і підтверджують. */}
          {material.isCosmetic && hasCompliance && (
            <Link href={`/app/inventory/materials/${material.id}/docs`}
                  className="mt-2 block"
                  style={{
                    background: 'var(--color-accent-soft)',
                    borderRadius: 'var(--radius-card)',
                    padding: 'var(--space-4)',
                  }}>
              <span className="eyebrow block">{t('inventory.docs.moz.title')}</span>
              {material.notificationCode ? (
                <>
                  {/* Код нотифікації — дані орендаря. */}
                  <span className="tabular t-md mt-2 block">
                    {t('inventory.docs.moz.code', { code: material.notificationCode })}
                  </span>
                  <span className="tabular t-sm block" style={{ color: 'var(--color-muted)' }}>
                    {t('inventory.docs.moz.date', { date: t.date(material.notificationDate) })}
                  </span>
                </>
              ) : (
                <span className="t-sm mt-2 block" style={{ color: 'var(--color-muted)' }}>
                  {t('inventory.docs.moz.noCode')}
                </span>
              )}
              {material.notificationConfirmedAt && (
                <span className="mt-3 block">
                  <span className="badge-success">
                    {t('inventory.material.moz.proof.ok', {
                      date: t.date(material.notificationConfirmedAt),
                    })}
                  </span>
                </span>
              )}
            </Link>
          )}
        </Fold>

        {/* Комерційна частина закладу. Інспектору запит до `materials`
            повертає порожнечу (stock === null) — і секції немає зовсім,
            та сама логіка, що в рядка «В наявності». */}
        {stock !== null && (
          <Fold title={t('inventory.material.storage.title')}
                open={fold === 'storage'} onToggle={() => toggleFold('storage')}>
            <div className="kv">
              <Row label={t('inventory.material.location.label')}
                   value={locationName ?? t('inventory.material.relocate.none')} />
              {material.cost != null && (
                <Row label={t('inventory.material.row.cost')}
                     value={t.money(material.cost)} mono />
              )}
            </div>
            {material.cost != null && (
              // З 0112 приймання перераховує cost_per_unit само — без цього
              // рядка власник «лагодить» цифру руками і ламає середньозважену.
              <p className="field-hint mt-1">{t('inventory.material.cost.hint')}</p>
            )}
            {canWrite && (
              // Перенос місця — ТІЛЬКИ кнопкою: вона зве relocate_stock (0113)
              // і лишає слід у журналі рухів, чого мовчазний селект не робить.
              <button type="button" className="btn-secondary mt-2"
                      onClick={() => setRelocate(true)}>
                {t('inventory.material.relocate.action')}
              </button>
            )}
          </Fold>
        )}

        {/* Показується тільки тому, хто їх бачить: інспектору ці колонки
            не приходять зовсім (0111), і секції в нього просто немає. */}
        {(material.note || Object.keys(material.attributes ?? {}).length > 0) && (
          <Fold title={t('inventory.material.own.title')}
                open={fold === 'own'} onToggle={() => toggleFold('own')}>
            {material.note && (
              <div className="card mb-2">
                {/* Кегль зі шкали (t-sm), а не ручний calc: свій розмір
                    випав би з множника --type-scale при першій правці. */}
                <p className="t-sm" style={{ whiteSpace: 'pre-wrap' }}>{material.note}</p>
              </div>
            )}
            {Object.keys(material.attributes ?? {}).length > 0 && (
              <div className="kv">
                {Object.entries(material.attributes ?? {}).map(([k, v]) => (
                  <Row key={k} label={k} value={v} />
                ))}
              </div>
            )}
          </Fold>
        )}
        {/* ── Прибрати засіб ────────────────────────────────────
            Стоїть ОСТАННІМ і за дверима: дію роблять раз у житті
            запису, а вагою вона тут єдина небезпечна. Той самий довід,
            через який «видалити акаунт» пішов у згорнуте на «Профілі».

            Що саме станеться — стирання чи прибирання з реєстру —
            вирішує база (0134). Тут навмисно НЕ рахується, чи є
            в засоба рухи й ємності: це був би другий опис звʼязків
            поруч зі схемою, і розійшовся б він мовчки. */}
        {canWrite && (
          <Fold title={t('inventory.material.danger.title')}
                open={fold === 'danger'} onToggle={() => toggleFold('danger')}>
            <RemoveEntity kind="material" id={material.id} name={material.name}
                          onDone={() => router.replace('/app/inventory')} />
          </Fold>
        )}
      </div>

      {/* ── Правка карточки ──────────────────────────────────── */}
      <Sheet open={edit} onClose={() => setEdit(false)}
             title={t('inventory.material.sheet.edit')}>
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          material={material} onDone={() => setEdit(false)}
        />
      </Sheet>

      {/* ── Перемещение в другое место хранения ──────────────── */}
      <Sheet open={relocate} onClose={() => setRelocate(false)}
             title={t('inventory.material.relocate.sheet')}
             footer={
               // Кнопка в подвале шторки; форма связана атрибутом form —
               // подвал живёт вне <form>, и без него submit не дошёл бы.
               <button form="relocate-form" className="btn-primary w-full"
                       disabled={relocBusy}>
                 {relocBusy ? t('common.saving') : t('inventory.material.relocate.submit')}
               </button>
             }>
        {relocate && (
          <RelocateForm
            current={locations.find((l) => l.id === material.locationId) ?? null}
            locations={locations}
            onSave={(loc, note) => void doRelocate(loc, note)}
          />
        )}
      </Sheet>

      {/* ── Правка партии ────────────────────────────────────── */}
      <Sheet open={batchEdit !== null} onClose={() => setBatchEdit(null)}
             title={batchEdit === 'new'
               ? t('inventory.material.sheet.newBatch')
               : t('inventory.material.sheet.batch')}>
        {batchEdit && (
          <BatchForm
            key={batchEdit === 'new' ? 'new' : batchEdit.id}
            batch={batchEdit === 'new' ? null : batchEdit}
            suppliers={suppliers}
            busy={busy}
            onSave={saveBatch}
            onCancel={() => setBatchEdit(null)}
          />
        )}
      </Sheet>
    </div>
  )
}

// Перемещение — отдельная маленькая форма: текущее место текстом,
// новое — списком, заметка по желанию. «Без місця» — тоже перенос
// (снять с полки), поэтому пустой пункт в списке законен.
function RelocateForm({
  current, locations, onSave,
}: {
  current: RefItem | null
  locations: RefItem[]
  onSave: (locationId: string, note: string) => void
}) {
  const t = useT()
  const [locationId, setLocationId] = useState(current?.id ?? '')
  const [note, setNote] = useState('')

  return (
    <form id="relocate-form" className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave(locationId, note) }}>
      <div className="card-flat">
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {t('inventory.material.relocate.current')}
        </p>
        <p className="t-md">{current?.name ?? t('inventory.material.relocate.none')}</p>
      </div>
      <div>
        <label className="field-label">{t('inventory.material.relocate.to.label')}</label>
        <select className="select" value={locationId}
                onChange={(e) => setLocationId(e.target.value)}>
          <option value="">{t('inventory.material.relocate.none')}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label">{t('inventory.material.relocate.note.label')}</label>
        <input className="input" maxLength={100}
               placeholder={t('inventory.material.relocate.note.placeholder')}
               value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="field-hint">{t('inventory.material.relocate.hint')}</p>
    </form>
  )
}

// Партия правится отдельной формой, а не вместе с карточкой: у одного
// засоба их бывает несколько, и «исправить срок» — самое частое
// действие в реестре. Смешать его с правкой бренда значит заставить
// пролистывать паспорт ради одной даты.
function BatchForm({
  batch, suppliers, busy, onSave, onCancel,
}: {
  batch: Batch | null
  suppliers: RefItem[]
  busy: boolean
  onSave: (f: { number: string; made: string; expiry: string; supplierId: string }) => void
  onCancel: () => void
}) {
  const t = useT()
  const [number, setNumber] = useState(batch?.number ?? '')
  const [made, setMade] = useState(batch?.made ?? '')
  const [expiry, setExpiry] = useState(batch?.expiry ?? '')
  const [supplierId, setSupplierId] = useState(batch?.supplierId ?? '')

  return (
    <form className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); onSave({ number, made, expiry, supplierId }) }}>
      <div className="sm:col-span-2">
        <label className="field-label">{t('inventory.material.batchForm.number.label')}</label>
        <input required autoFocus className="input"
               placeholder={t('inventory.material.batchForm.number.placeholder')}
               value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.material.batchForm.made.label')}</label>
        <input type="date" className="input" max={expiry || undefined}
               value={made} onChange={(e) => setMade(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('inventory.material.batchForm.expiry.label')}</label>
        <input required type="date" className="input" min={made || undefined}
               value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <label className="field-label">{t('inventory.material.batchForm.supplier.label')}</label>
        <select className="select" value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t('inventory.common.notSet')}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p className="field-hint sm:col-span-2">{t('inventory.material.batchForm.hint')}</p>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !number.trim() || !expiry}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
