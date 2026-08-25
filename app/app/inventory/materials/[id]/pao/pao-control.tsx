'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { enqueue, isNetworkError, newKey } from '@/lib/offline/queue'
import { useT } from '@/lib/i18n/client'
import { noteIfImmutable } from '@/lib/security-log'
import { dbErrorText } from '@/lib/errors/db'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_KEY } from '../../../inventory-client'
import { EXPIRY_BADGE, daysLeft, expiryState } from '@/lib/expiry'
import { IconLabel, IconQr } from '@/components/icons'

type Container = {
  id: string; code: string; status: string
  volume: number | null; unit: string | null
  openedAt: string | null; useBy: string | null
  decantedAt: string | null; parentId: string | null
  paoMonths: number | null; note: string | null; batchId: string | null
}
type Batch = { id: string; number: string; expiry: string }

// Строка «поле — значение» — теми же классами .kv-row/.kv-key/.kv-val,
// что и паспорт на карточке засоба: две разные таблицы одного вида
// разъезжаются на первой правке темы. Значения здесь числовые и датные,
// поэтому tabular стоит на всех.
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className="kv-val tabular">{value}</span>
    </div>
  )
}

// Значения `material_containers.status` не переводятся — это ключи базы.
// Переводится подпись к ним.
const STATUS_KEY: Record<string, Key> = {
  sealed: 'inventory.pao.status.sealed',
  opened: 'inventory.pao.status.opened',
  finished: 'inventory.pao.status.finished',
  disposed: 'inventory.pao.status.disposed',
}

export function PaoControl({
  canOpen, canPrint, material, containers, batches, loadError,
}: {
  canOpen: boolean
  /**
   * Право на лист наклеек. Роут `/app/inventory/labels` требует
   * `stock.read` и осознанно отвечает 403 инспектору. Кнопка, которая
   * гарантированно приводит к 403, — это не защита, а сломанная
   * навигация, поэтому её просто нет.
   */
  canPrint: boolean
  material: { id: string; name: string; unit: string; paoMonths: number | null; isCosmetic: boolean }
  containers: Container[]
  batches: Batch[]
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  /** Подпись статуса ёмкости. Неизвестное значение показываем как есть. */
  const statusLabel = (status: string) =>
    (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status)

  const [busy, setBusy] = useState<string | null>(null)
  const [decantOf, setDecantOf] = useState<Container | null>(null)
  const [label, setLabel] = useState<{ code: string; id: string; text: string } | null>(null)
  // «Активні» по умолчанию: мастеру за креслом нужны живые банки.
  // «Всі» показывает и закрытые со списанными — история не исчезает
  // навсегда, как это делал прежний фильтр без переключателя.
  const [scope, setScope] = useState<'active' | 'all'>('active')

  // Розлив — это дочерняя ёмкость. Родительские банки и дозаторы
  // разделены не по объёму, а по происхождению: у дозатора есть parent_id.
  const jars = containers.filter((c) => c.parentId === null)
  const decants = containers.filter((c) => c.parentId !== null)
  const live = jars.filter((c) => c.status === 'sealed' || c.status === 'opened')
  const shownJars = scope === 'active' ? live : jars

  // Счётчики над списком — ответы на вопросы смены: сколько банок в работе,
  // у каких горит срок, был ли уже розлив сегодня. Считаются из данных
  // экрана, отдельный запрос им не нужен.
  const openedCount = jars.filter((c) => c.status === 'opened').length
  const soonCount = containers.filter((c) => {
    if (c.status !== 'opened') return false
    const left = daysLeft(c.useBy)
    return left != null && left >= 0 && left <= 7
  }).length
  const todayStr = new Date().toDateString()
  const decantsToday = decants.filter((d) =>
    d.decantedAt && new Date(d.decantedAt).toDateString() === todayStr).length

  const batchOf = (id: string | null) => batches.find((b) => b.id === id) ?? null

  // ── `?do=decant` ОТКРЫВАЕТ ФОРМУ РОЗЛИВА СРАЗУ ───────────────────────
  //
  // Кнопка «Розлив у дозатор» на карточке засоба ведёт сюда этим адресом.
  // Приём и порядок те же, что у `?scan=1` на складе и `?new=1` на приёмке:
  // человек нажал «розлив» — заставлять его искать ту же кнопку второй раз
  // на этом экране значит отменить смысл первого нажатия.
  //
  // Открываем ТОЛЬКО когда открытая банка ровно одна. Две и больше — это
  // выбор, и делать его за человека нельзя: розлив списывает объём
  // и заводит новую ёмкость, то есть ошибка стоит банки в реестре,
  // которой нет на полке. Ноль открытых — открывать нечего, и экран
  // честно показывает список с кнопкой «Відкрити».
  //
  // Признак снимается из адреса СРАЗУ: иначе повторное нажатие на карточке
  // ведёт на тот же адрес, компонент не перемонтируется, и второй раз
  // форма не откроется. `history.replaceState`, а не `router.replace`, —
  // серверный рендер ради чистки параметра не нужен.
  const sp = useSearchParams()
  useEffect(() => {
    if (sp.get('do') !== 'decant') return
    const openedJars = containers.filter((c) => c.parentId === null && c.status === 'opened')
    if (canOpen && openedJars.length === 1) setDecantOf(openedJars[0])
    window.history.replaceState(null, '', `/app/inventory/materials/${material.id}/pao`)
  }, [sp, canOpen, containers, material.id])

  async function open(c: Container) {
    setBusy(c.id)
    try {
      const { error } = await supabase.from('material_containers')
        .update({ status: 'opened' }).eq('id', c.id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      // Мастер вскрывает банку там, где стоит стеллаж, — связи может
      // не быть вовсе. Сетевая ошибка кладёт действие в очередь, ошибка
      // данных показывается честно: в очереди она не отправится никогда.
      if (isNetworkError(e)) {
        await enqueue(`${t('inventory.container.open')} · ${c.code}`,
          { kind: 'container.status', containerId: c.id, status: 'opened' })
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return
      }
      // Сторож ёмкости (0014/0044: «дата вскрытия не редактируется»)
      // роняет транзакцию — записать событие изнутри неё нельзя, оно
      // откатится вместе с попыткой. Пишем отсюда (0085, решение 4).
      // Сырой текст нужен только сторожу журнала; человеку — общий
      // разбор dbErrorText (М25), сообщение Postgres на экран не едет.
      const message = e instanceof Error ? e.message : String(e)
      void noteIfImmutable(supabase, message, 'ємність: відкриття')
      toast.error(t('inventory.pao.error.open'), dbErrorText(t, e))
      return
    }
    setBusy(null)
    toast.success(t('inventory.container.opened.title'), t('inventory.container.opened.desc'))
    router.refresh()
  }

  // Закрытие банки переживает офлайн так же, как вскрытие: смена одного
  // поля идемпотентна по своей природе — повтор ставит тот же статус.
  // Мастер закрывает пустую банку у рабочего места, где связь хуже всего,
  // и потерянное действие означает банку, которая в реестре ещё «в работе».
  async function finish(c: Container, disposed: boolean) {
    const status = disposed ? 'disposed' : 'finished'
    setBusy(c.id)
    try {
      const { error } = await supabase.from('material_containers')
        .update({ status }).eq('id', c.id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      if (isNetworkError(e)) {
        await enqueue(`${disposed ? t('inventory.pao.disposed') : t('inventory.pao.finished')} · ${c.code}`,
                      { kind: 'container.status', containerId: c.id, status })
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return
      }
      const message = e instanceof Error ? e.message : String(e)
      void noteIfImmutable(supabase, message, 'ємність: закриття')
      toast.error(t('inventory.container.saveError'), dbErrorText(t, e))
      return
    }
    setBusy(null)
    toast.success(disposed ? t('inventory.pao.disposed') : t('inventory.pao.finished'))
    router.refresh()
  }

  // Розлив идёт только функцией decant_container: она пишет партию,
  // код из пер-арендаторного счётчика и не даёт «омолодить» срок.
  // Прямой вставкой этого не повторить — и не нужно.
  //
  // ⚠️ КЛЮЧ ПОВТОРА ГЕНЕРИРУЕТСЯ ЗДЕСЬ, ДО ПЕРВОЙ ПОПЫТКИ, а не в момент
  // досылки. Сеть рвётся и ПОСЛЕ того, как база записала розлив: транзакция
  // прошла, ответ не доехал. С новым ключом досылка отлила бы второй раз
  // и завела бы в реестре банку, которой нет на полке. Тот же ключ уезжает
  // в очередь и в базу (0100).
  async function decant(parent: Container, volume: number, note: string) {
    setBusy('decant')
    const key = newKey()
    let data: unknown
    try {
      const res = await supabase.rpc('decant_container', {
        p_parent_id: parent.id,
        p_volume: volume,
        p_note: note.trim() || null,
        p_idempotency_key: key,
      })
      if (res.error) throw new Error(res.error.message)
      data = res.data
    } catch (e) {
      setBusy(null)
      if (isNetworkError(e)) {
        await enqueue(`${t('inventory.pao.decant.create')} · ${parent.code}`,
                      { kind: 'container.decant', parentId: parent.id, volume,
                        note: note.trim() || null, idempotencyKey: key })
        setDecantOf(null)
        // Наклейку офлайн не напечатать: код новой ёмкости выдаёт счётчик
        // базы. Об этом говорится прямо — мастер, ждущий наклейку, должен
        // понимать, почему её нет, иначе он отольёт ещё раз.
        toast.info(t('inventory.offline.saved'), t('inventory.pao.decant.offline'))
        return
      }
      toast.error(t('inventory.pao.decant.error'), dbErrorText(t, e))
      return
    }
    const child = (Array.isArray(data) ? data[0] : data) as { id: string; code: string } | null
    if (!child) {
      setBusy(null)
      toast.error(t('inventory.pao.decant.error'), t('inventory.pao.decant.noRow'))
      return
    }

    // Наклейку берём у базы, а не собираем на экране: пять реквизитов
    // ТЗ отдаёт функция container_label, и она же печатается на бумаге.
    const { data: text } = await supabase.rpc('container_label', { p_container_id: child.id })
    setBusy(null)
    setDecantOf(null)
    setLabel({ code: child.code, id: child.id, text: String(text ?? '') })
    toast.success(t('inventory.pao.decant.created', { code: child.code }))
    router.refresh()
  }

  // Наклейку любой ёмкости отдаёт база одной строкой — тем же вызовом,
  // что печатается на бумаге. Собирать её второй раз на экране нельзя:
  // две сборки разъедутся, а реквизитов ровно пять и они из ТЗ.
  async function showLabel(c: Container) {
    setBusy(c.id)
    const { data, error } = await supabase.rpc('container_label', { p_container_id: c.id })
    setBusy(null)
    if (error) { toast.error(t('inventory.pao.label.error'), dbErrorText(t, error)); return }
    setLabel({ code: c.code, id: c.id, text: String(data ?? '') })
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError && <p className="field-error rise">{loadError}</p>}

      {material.isCosmetic && material.paoMonths == null && (
        <p className="field-hint rise">{t('inventory.pao.noPao')}</p>
      )}

      {/* ── Счётчики смены ───────────────────────────────────────
          Крупное число и мелкая подпись (`.metric`), как на главном
          экране склада. Не кнопки: фильтр здесь один и живёт в `.seg`
          ниже, плитка-который-не-нажимается честнее плитки-обманки. */}
      <section className="grid grid-cols-3 gap-2 rise-1">
        <div className="metric">
          <span className="metric-value">{t.number(openedCount)}</span>
          <span className="metric-label">{t('inventory.pao.metric.opened')}</span>
        </div>
        <div className="metric" data-tone={soonCount > 0 ? 'amber' : undefined}>
          <span className="metric-value">{t.number(soonCount)}</span>
          <span className="metric-label">{t('inventory.pao.metric.soon')}</span>
        </div>
        <div className="metric">
          <span className="metric-value">{t.number(decantsToday)}</span>
          <span className="metric-label">{t('inventory.pao.metric.today')}</span>
        </div>
      </section>

      {/* Переключатель «Активні / Всі»: прежний фильтр прятал закрытые
          и списанные банки НАВСЕГДА, и историю нельзя было увидеть. */}
      <div className="seg self-start rise-1">
        {(['active', 'all'] as const).map((s) => (
          <button key={s} type="button" className="seg-item"
                  data-active={scope === s} aria-pressed={scope === s}
                  onClick={() => setScope(s)}>
            {s === 'active' ? t('inventory.pao.scope.active') : t('inventory.pao.scope.all')}
          </button>
        ))}
      </div>

      {/* ── Банки: учёт PAO по каждой ──────────────────────────
          README, розділ C (`stockPao`): секция «Облік PAO (після
          відкриття)». Надзаголовка здесь не было вовсе — карточки банок
          начинались сразу после переключателя, и две группы («банки»
          и «історія розливів») читались одним потоком. */}
      <p className="eyebrow rise-1">{t('inventory.pao.jars.title')}</p>
      {shownJars.length === 0 ? (
        <div className="card rise-1">
          <div className="empty">
            <span className="empty-icon"><IconQr size={24} /></span>
            <p className="empty-title">{t('inventory.pao.emptyTitle')}</p>
            <p className="empty-desc">{t('inventory.pao.empty')}</p>
            {/* Завести банку отсюда нельзя — форма заведения живёт на
                главном экране склада. Честная ссылка вместо тупика. */}
            <div className="empty-actions">
              <Link href="/app/inventory" className="btn-secondary">
                {t('inventory.pao.empty.go')}
              </Link>
            </div>
          </div>
        </div>
      ) : shownJars.map((c) => {
        const state = expiryState(c.useBy)
        const left = daysLeft(c.useBy)
        const b = batchOf(c.batchId)
        const closed = c.status !== 'sealed' && c.status !== 'opened'
        return (
          <section key={c.id} className="card rise-1">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="tabular t-lg">{c.code}</h3>
              {/* У закрытой и списанной срок больше ничего не значит —
                  бейдж называет статус, а не пугает «протерміновано». */}
              <span className={closed ? 'badge' : EXPIRY_BADGE[state]}>
                {c.status === 'sealed'
                  ? t('inventory.pao.status.sealed')
                  : closed ? statusLabel(c.status) : t(EXPIRY_KEY[state])}
              </span>
            </div>

            {/* Обёртка нужна правилу :last-child — без неё нижняя строка
                держит разделитель перед кнопками. */}
            <div>
              {/* Номер партии и объём — данные арендатора. */}
              <Row label={t('inventory.pao.row.batch')} value={b?.number ?? '—'} />
              <Row label={t('inventory.pao.row.volume')}
                   value={c.volume != null
                     ? `${t.number(c.volume)} ${c.unit ?? material.unit}`
                     : '—'} />
              <Row label={t('inventory.pao.row.openedAt')} value={t.date(c.openedAt)} />
              <Row label={t('inventory.pao.row.pao')}
                   value={(c.paoMonths ?? material.paoMonths)
                     ? t.plural('inventory.pao.months', (c.paoMonths ?? material.paoMonths)!)
                     : '—'} />
              <Row label={t('inventory.pao.row.useBy')}
                   value={c.useBy
                     ? <>{t.date(c.useBy)}{left != null && left >= 0
                         ? ` · ${t.plural('inventory.days', left)}`
                         : ''}</>
                     : t('inventory.pao.useBy.pending')} />
              <Row label={t('inventory.pao.row.status')} value={statusLabel(c.status)} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === 'sealed' && canOpen && (
                <button className="btn-primary" disabled={busy === c.id}
                        onClick={() => void open(c)}>
                  {t('inventory.container.open')}
                </button>
              )}
              {c.status === 'opened' && canOpen && (
                <>
                  <button className="btn-primary" disabled={busy === c.id}
                          onClick={() => setDecantOf(c)}>
                    {t('inventory.pao.decant.create')}
                  </button>
                  <button className="btn-secondary" disabled={busy === c.id}
                          onClick={() => void finish(c, false)}>
                    {t('inventory.container.finished')}
                  </button>
                  <button className="btn-danger" disabled={busy === c.id}
                          onClick={() => void finish(c, true)}>
                    {t('inventory.container.dispose')}
                  </button>
                </>
              )}
              {canPrint && (
                <a href={`/app/inventory/labels?ids=${c.id}`} target="_blank" rel="noreferrer"
                   className="btn-ghost t-sm">{t('inventory.pao.print')}</a>
              )}
            </div>

            {c.status === 'sealed' && (
              <p className="field-hint mt-2">{t('inventory.pao.sealed.hint')}</p>
            )}
          </section>
        )
      })}

      {/* ── История розливов ───────────────────────────────────
          README, розділ C: «ІСТОРІЯ РОЗЛИВІВ» — надзаголовок секции
          такой же, как у остальных разделов приложения (`.eyebrow`
          над карточкой), а не мелкая серая строка внутри неё. Значок
          с числом снят: количество розливов уже названо плиткой
          «розливів сьогодні» и самим списком, а число в кружке
          у заголовка не отвечало ни на один вопрос смены. */}
      <p className="eyebrow rise-2">{t('inventory.pao.decants.title')}</p>
      {decants.length === 0 ? (
        <section className="card rise-2">
          <div className="empty">
            <span className="empty-icon"><IconLabel size={24} /></span>
            <p className="empty-title">{t('inventory.pao.decants.emptyTitle')}</p>
            <p className="empty-desc">{t('inventory.pao.decants.emptyDesc')}</p>
          </div>
        </section>
      ) : (
        // ОТДЕЛЬНЫЕ карточки с зазором, как в хендоффе (`stockPao`,
        // «Історія розливів») и как реестр склада (`.list-card`).
        <div className="rise-2 flex flex-col gap-2">
          {decants.map((d) => {
            const state = expiryState(d.useBy)
            return (
              <div key={d.id} className="list-card">
                <div className="min-w-0 flex-1">
                  {/* Код наліпки — данные арендатора. */}
                  <p className="tabular t-lg">{d.code}</p>
                  <p className="tabular t-xs" style={{ color: 'var(--color-faint)' }}>
                    {t.date(d.decantedAt ?? d.openedAt)}
                    {d.note ? ` · ${d.note}` : ''}
                    {d.status !== 'opened' ? ` · ${statusLabel(d.status)}` : ''}
                  </p>
                </div>
                {/* Объём — справа и крупно (README): в списке розливов
                    спрашивают «скільки відлито», а не «як називається».
                    Раньше он висел приклеенным к коду серым хвостом
                    «QR-25-05-001 · 100 мл» и на 390px переносился
                    отдельной строкой посреди названия. */}
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-right">
                    <span className="tabular t-md block">
                      {d.volume != null ? t.number(d.volume) : '—'} {d.unit ?? material.unit}
                    </span>
                    <span className={`tabular ${EXPIRY_BADGE[state]}`}>
                      {t('inventory.pao.decant.until', { date: t.date(d.useBy) })}
                    </span>
                  </span>
                  <button className="btn-icon" aria-label={t('inventory.pao.label.aria')}
                          disabled={busy === d.id}
                          onClick={() => void showLabel(d)}>
                    <IconLabel size={18} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Розлив ───────────────────────────────────────────── */}
      <Sheet open={decantOf !== null} onClose={() => setDecantOf(null)}
             title={t('inventory.pao.sheet.decant')}>
        {decantOf && (
          <DecantForm
            parent={decantOf}
            unit={decantOf.unit ?? material.unit}
            busy={busy === 'decant'}
            onSave={(v, note) => void decant(decantOf, v, note)}
            onCancel={() => setDecantOf(null)}
          />
        )}
      </Sheet>

      {/* ── Наклейка ─────────────────────────────────────────── */}
      <Sheet open={label !== null} onClose={() => setLabel(null)}
             title={t('inventory.pao.sheet.label')}>
        {label && (
          <div className="flex flex-col gap-3">
            <p className="tabular display t-2xl">{label.code}</p>
            <div className="card-flat">
              <p className="t-md" style={{ whiteSpace: 'pre-line' }}>
                {label.text.split(' · ').join('\n')}
              </p>
            </div>
            <p className="field-hint">{t('inventory.pao.label.hint')}</p>
            <div className="flex flex-wrap gap-2">
              <a href={`/app/inventory/labels?ids=${label.id}`} target="_blank" rel="noreferrer"
                 className="btn-primary">{t('inventory.pao.label.print')}</a>
              <button type="button" className="btn-ghost" onClick={() => setLabel(null)}>
                {t('inventory.common.close')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

// Дата и мастер на розливе не выбираются, и это не упрощение.
// Наклейка — часть неизменяемого журнала: «відповідальний майстер» там
// обязан быть тем, кто нажал кнопку, а «дата розливу» — моментом самого
// действия. Дать выбрать их в форме значит разрешить подписать чужим
// именем задним числом — ровно то, от чего защищает Audit Trail в ТЗ.
function DecantForm({
  parent, unit, busy, onSave, onCancel,
}: {
  parent: { code: string; volume: number | null }
  unit: string
  busy: boolean
  onSave: (volume: number, note: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const [volume, setVolume] = useState('')
  const [note, setNote] = useState('')
  const v = Number(volume)
  const max = parent.volume ?? 0
  const tooMuch = max > 0 && v >= max

  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave(v, note) }}>
      <div className="card-flat">
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {t('inventory.pao.decant.from')}
        </p>
        <p className="tabular t-lg">{parent.code}
          {parent.volume != null && (
            <span style={{ color: 'var(--color-faint)' }}>
              {' '}· {t('inventory.pao.decant.rest', {
                volume: t.number(parent.volume), unit,
              })}
            </span>
          )}
        </p>
      </div>

      <div>
        <label className="field-label">
          {t('inventory.pao.decant.volume.label', { unit })}
        </label>
        <input required autoFocus type="number" min="0" step="any"
               className={tooMuch ? 'input input-error' : 'input'}
               placeholder="100" value={volume}
               onChange={(e) => setVolume(e.target.value)} />
        {tooMuch && (
          <p className="field-error">{t('inventory.pao.decant.tooMuch')}</p>
        )}
      </div>

      <div>
        <label className="field-label">{t('inventory.pao.decant.note.label')}</label>
        <input className="input" maxLength={100}
               placeholder={t('inventory.pao.decant.note.placeholder')}
               value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="field-hint">{note.length}/100</p>
      </div>

      <p className="field-hint">{t('inventory.pao.decant.hint')}</p>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !volume || v <= 0 || tooMuch}>
          {busy ? t('inventory.pao.decant.busy') : t('inventory.pao.decant.submit')}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
