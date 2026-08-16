'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { enqueue, isNetworkError, list as queueList, onQueueChange } from '@/lib/offline/queue'
import { useT } from '@/lib/i18n/client'
import { countBadge, countStatusLabel, humanizeCount, qty } from '../counts-client'

export type CountCard = {
  id: string
  status: string
  note: string | null
  startedAt: string
  appliedAt: string | null
}

export type CountLine = {
  id: string
  /** Товар считается штуками, засіб — граммами и миллилитрами. */
  kind: 'variant' | 'material'
  /** Вариант товара или расходник — то, чем строка ищется сканером. */
  targetId: string
  title: string
  subtitle: string
  unit: string
  expected: number
  counted: number | null
}

export function CountDetail({
  tenantId, count, lines, canWrite, loadError,
}: {
  tenantId: string
  count: CountCard
  lines: CountLine[]
  canWrite: boolean
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const counting = count.status === 'counting'
  const editable = counting && canWrite

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [scanMiss, setScanMiss] = useState('')
  // Фильтр по состоянию строки. «Не пораховані» — то, ради чего экран
  // открывают во второй раз: список на сто позиций глазами не отфильтруешь.
  const [filter, setFilter] = useState<'all' | 'todo' | 'diff'>('all')
  // Подсвеченная строка держится до следующего скана: мастер отводит глаза
  // на полку и возвращается — строка должна остаться найденной.
  const [hit, setHit] = useState<string | null>(null)

  // Введённое перекрывает пришедшее с сервера, пока страница не обновилась.
  // Пустая строка — осознанное «ещё не считал», поэтому храним именно текст,
  // а не число: null и 0 в поле ввода выглядят одинаково, а значат разное.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const inputs = useRef(new Map<string, HTMLInputElement | null>())

  // Сколько строк ЭТОГО документа ещё лежит в офлайн-очереди. Число нужно
  // не для красоты: пока оно не ноль, проводить пересчёт нельзя.
  const lineIds = useMemo(() => new Set(lines.map((l) => l.id)), [lines])
  const pendingLines = useCallback(async () => {
    const all = await queueList()
    return all.filter((r) => r.action.kind === 'count.line'
      && lineIds.has(r.action.lineId))
  }, [lineIds])

  const [pending, setPending] = useState(0)
  useEffect(() => {
    const refresh = () => { void pendingLines().then((p) => setPending(p.length)) }
    refresh()
    return onQueueChange(refresh)
  }, [pendingLines])

  const shownValue = (l: CountLine) => draft[l.id] ?? (l.counted != null ? String(l.counted) : '')
  // Переменная разбора названа `raw`, а не `t`: `t` — переводчик.
  const num = (s: string) => {
    // Запятая — то, что реально набирают на украинской раскладке телефона,
    // и Number('0,5') это NaN. Приводим до разбора, а не после.
    const raw = s.trim().replace(',', '.')
    if (raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  // Округление зависит от того, что считаем. У товара остаток целый
  // (offering_variants.stock_qty int) — дробь там ничего не значит.
  // У расходника остаток numeric, и «0.5 л» это законное значение;
  // округлив его до 1, экран сам породил бы расхождение на пол-литра.
  const normalize = (l: CountLine, v: number) =>
    l.kind === 'variant' ? Math.round(v) : Math.round(v * 1000) / 1000

  const diffOf = (l: CountLine) => {
    const c = num(shownValue(l))
    return c == null ? null : normalize(l, c) - l.expected
  }

  const filled = lines.filter((l) => num(shownValue(l)) != null).length
  const mismatches = lines.filter((l) => {
    const d = diffOf(l)
    return d != null && d !== 0
  }).length

  const visible = lines.filter((l) => {
    if (filter === 'todo') return num(shownValue(l)) == null
    if (filter === 'diff') { const d = diffOf(l); return d != null && d !== 0 }
    return true
  })

  async function saveLine(line: CountLine) {
    const value = num(shownValue(line))
    const next = value == null ? null : normalize(line, value)
    if (next === line.counted) return
    if (next != null && next < 0) {
      setErr(t('inventory.count.error.negativeQty'))
      return
    }

    setBusy(line.id); setErr('')
    try {
      const { error } = await supabase.from('stock_count_lines')
        .update({ counted_qty: next }).eq('id', line.id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      // Пересчёт ведут у полок, где сети нет. Потерянная строка означает
      // поход к той же полке заново — а мастер уже ушёл дальше по ряду.
      // Повтор досылки безвреден: это одно поле, последняя запись
      // побеждает; движений отсюда не рождается — их сделает проведение.
      if (isNetworkError(e)) {
        await enqueue(t('inventory.count.queue.fact', { title: line.title }), {
          kind: 'count.line', lineId: line.id, countedQty: next,
        })
        setDraft((d) => ({ ...d, [line.id]: next == null ? '' : String(next) }))
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return
      }
      setErr(humanizeCount(t, e instanceof Error ? e.message : String(e)))
      return
    }
    setBusy(null)
    setDraft((d) => ({ ...d, [line.id]: next == null ? '' : String(next) }))
    router.refresh()
  }

  // Пересчёт удобно вести со сканером: код в руке, а не палец в списке
  // из ста строк. Ищем двумя вызовами сразу — наклейкой ёмкости и кодом
  // товара: на полке у салона наклеена именно ёмкость, а её QR ни один
  // штрихкодовый справочник не знает.
  async function lookup(raw: string) {
    const q = raw.trim()
    if (!q) return
    setCode(''); setScanMiss('')

    const [{ data: cont }, { data: items }] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: q }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: q }),
    ])

    const container = (cont ?? [])[0] as { material_id?: string; material?: string } | undefined
    const found = (items ?? []) as { kind: string; id: string; title: string }[]

    const line = container?.material_id
      ? lines.find((l) => l.kind === 'material' && l.targetId === container.material_id)
      : found
        .map((f) => lines.find((l) => l.targetId === f.id
          && l.kind === (f.kind === 'material' ? 'material' : 'variant')))
        .find((l): l is CountLine => l != null)

    if (!line) {
      setHit(null)
      const known = container?.material ?? found[0]?.title
      setScanMiss(known
        ? t('inventory.count.scan.notInDoc', { name: known })
        : t('inventory.scan.notFound', { code: q }))
      return
    }
    // Найденная строка обязана быть видимой: при включённом фильтре
    // «не пораховані» она могла оказаться скрытой, и скан выглядел бы
    // как «ничего не нашлось».
    setFilter('all')
    setHit(line.id)
    // Прокрутка и фокус — после перерисовки со снятым фильтром.
    setTimeout(() => {
      const el = inputs.current.get(line.id)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.focus()
      el?.select()
    }, 30)
  }

  async function scanCamera() {
    // BarcodeDetector есть в Chrome на Android — основной телефон мастера.
    type BD = { detect(source: ImageBitmap): Promise<{ rawValue: string }[]> }
    const W = window as unknown as { BarcodeDetector?: new (o?: object) => BD }
    if (!W.BarcodeDetector) {
      toast.warn(t('inventory.scan.unavailable.title'), t('inventory.scan.unavailable.desc'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      const track = stream.getVideoTracks()[0]
      const capture = new ImageCapture(track)
      const detector = new W.BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'code_128'],
      })
      const deadline = Date.now() + 15000
      let found: string | null = null
      while (!found && Date.now() < deadline) {
        const frame = await capture.grabFrame()
        const codes = await detector.detect(frame)
        if (codes.length > 0) found = codes[0].rawValue
        await new Promise((r) => setTimeout(r, 180))
      }
      track.stop()
      if (found) await lookup(found)
      else toast.info(t('inventory.scan.nothing.title'), t('inventory.scan.nothing.desc'))
    } catch {
      toast.error(t('inventory.scan.failed.title'), t('inventory.scan.failed.desc'))
    }
  }

  async function apply() {
    // Проведение — единственное действие этого экрана, которое НЕЛЬЗЯ
    // откладывать в очередь. Оно рождает движения по остатку и закрывает
    // документ навсегда; отложить его значит провести пересчёт по данным,
    // которые к моменту досылки успели устареть. И если часть фактов ещё
    // лежит в очереди, база проведёт документ без них — то есть разнесёт
    // недостачу там, где мастер всё посчитал.
    const waiting = (await pendingLines()).length
    if (waiting > 0) {
      setErr(t.plural('inventory.count.apply.pending', waiting))
      return
    }

    const unfilled = lines.length - filled
    const warn = unfilled > 0
      ? `${t('inventory.count.apply.unfilled', { n: t.number(unfilled) })} `
      : ''
    if (!confirm(`${warn}${t('inventory.count.apply.confirm')}`)) return

    setBusy('apply'); setErr('')
    // Единственный путь: функция в одной транзакции проводит все расхождения
    // движениями 'adjustment' и закрывает документ. Правкой stock_qty это
    // сделать нельзя — триггер-охранник не даст (CLAUDE.md, правило 5).
    const { error } = await supabase.rpc('apply_stock_count', { p_count_id: count.id })
    setBusy(null)
    if (error) {
      setErr(isNetworkError(new Error(error.message))
        ? t('inventory.count.apply.offline')
        : humanizeCount(t, error.message))
      return
    }
    toast.success(t('inventory.count.applied.title'),
      mismatches > 0
        ? t('inventory.count.applied.mismatches', { n: t.number(mismatches) })
        : t('inventory.count.applied.clean'))
    router.refresh()
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">

      {/* ── Шапка документа: где мы и сколько ещё идти ───────── */}
      <section className="card rise-1">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <p className="tabular t-lg">
              {t('inventory.count.title', { date: fmt(count.startedAt) })}
            </p>
            <p className="tabular t-xs mt-0.5 prose-muted">
              {count.appliedAt
                ? t('inventory.count.appliedAt', { date: fmt(count.appliedAt) })
                : t('inventory.count.ongoing')}
              {count.note ? ` · ${count.note}` : ''}
            </p>
          </div>
          <span className={`${countBadge(count.status)} ml-auto`}>
            {countStatusLabel(t, count.status)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="badge-accent tabular">
            {t('inventory.count.filled', {
              filled: t.number(filled), total: t.number(lines.length),
            })}
          </span>
          {mismatches > 0 && (
            <span className="badge-warn tabular">
              {t('inventory.count.mismatches', { n: t.number(mismatches) })}
            </span>
          )}
          {pending > 0 && (
            <span className="badge-warn tabular">
              {t('inventory.count.pending', { n: t.number(pending) })}
            </span>
          )}
        </div>
      </section>

      {/* Текст отказа базы показывается как есть — это её слова, не наши. */}
      {loadError && (
        <p className="field-error rise">{t('inventory.count.linesError')}: {loadError}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      {/* ── Сканер: пересчёт ведут с кодом в руке ────────────── */}
      {editable && (
        <section className="card rise-2">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder={t('inventory.count.scan.placeholder')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
              autoComplete="off"
              inputMode="text"
            />
            <button type="button" onClick={() => void lookup(code)}
                    className="btn-secondary shrink-0">
              {t('inventory.count.scan.find')}
            </button>
            <button type="button" onClick={() => void scanCamera()}
                    className="btn-primary shrink-0"
                    title={t('inventory.scan.camera.aria')}
                    aria-label={t('inventory.scan.camera.aria')}>
              ⌗
            </button>
          </div>
          {scanMiss && <p className="field-error">{scanMiss}</p>}
          <p className="field-hint">{t('inventory.count.scan.hint')}</p>
        </section>
      )}

      {/* ── Фильтр состояния ─────────────────────────────────── */}
      {lines.length > 0 && (
        <div className="rise-2 flex flex-wrap gap-2">
          {([
            ['all', t('inventory.count.filter.all', { n: t.number(lines.length) })],
            ['todo', t('inventory.count.filter.todo', { n: t.number(lines.length - filled) })],
            ['diff', t('inventory.count.filter.diff', { n: t.number(mismatches) })],
          ] as const).map(([key, label]) => (
            <button key={key} type="button"
                    className={filter === key ? 'chip-active' : 'chip'}
                    onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Строки ───────────────────────────────────────────── */}
      <section className="card rise-3 !p-0">
        <div className="px-5">
          {lines.length === 0 ? (
            <div className="empty">{t('inventory.count.empty')}</div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {filter === 'todo'
                ? t('inventory.count.todoEmpty')
                : t('inventory.count.diffEmpty')}
            </div>
          ) : visible.map((l) => {
            const diff = diffOf(l)
            // Подсветка найденной строки — тенью с переменной темы, а не
            // подобранным цветом: иначе она разъедется при правке палитры.
            const found = hit === l.id
            return (
              <div key={l.id} className="row"
                   style={found
                     ? { boxShadow: '0 0 0 2px var(--color-accent)', borderRadius: 'var(--radius-control)' }
                     : undefined}>
                <div className="min-w-0">
                  <p className="t-md truncate">
                    {l.title}
                    {l.kind === 'material' && (
                      <span className="prose-muted"> · {t('inventory.count.line.material')}</span>
                    )}
                  </p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {t('inventory.count.line.expected', {
                      qty: qty(t, l.expected), unit: l.unit,
                    })}
                    {l.subtitle ? ` · ${l.subtitle}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editable ? (
                    <input
                      ref={(el) => { inputs.current.set(l.id, el) }}
                      type="text"
                      // Дробь у расходника законна, поэтому тип поля не
                      // number со step=1: он на телефоне режет ввод «0,5».
                      inputMode="decimal"
                      className="input w-24"
                      placeholder={t('inventory.count.line.fact.placeholder')}
                      value={shownValue(l)}
                      disabled={busy === l.id}
                      onFocus={() => setHit(l.id)}
                      onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                      onBlur={() => void saveLine(l)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    />
                  ) : (
                    <span className="badge tabular">
                      {l.counted != null
                        ? `${qty(t, l.counted)} ${l.unit}`
                        : t('inventory.count.line.notCounted')}
                    </span>
                  )}
                  {diff == null ? (
                    <span className="badge">—</span>
                  ) : diff === 0 ? (
                    <span className="badge-success">{t('inventory.count.line.match')}</span>
                  ) : diff < 0 ? (
                    <span className="badge-danger tabular">
                      {t('inventory.count.line.short', { qty: qty(t, Math.abs(diff)) })}
                    </span>
                  ) : (
                    <span className="badge-warn tabular">
                      {t('inventory.count.line.over', { qty: qty(t, diff) })}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Проведение */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-4">
          {editable ? (
            <button type="button" className="btn-primary"
                    disabled={busy !== null || lines.length === 0 || pending > 0}
                    onClick={() => void apply()}>
              {busy === 'apply' ? t('inventory.count.apply.busy')
                : pending > 0
                  ? t('inventory.count.apply.waiting', { n: t.number(pending) })
                  : t('inventory.count.apply.submit')}
            </button>
          ) : (
            <p className="t-md prose-muted">
              {count.status === 'applied'
                ? t('inventory.count.readonly.applied')
                : count.status === 'cancelled'
                  ? t('inventory.count.readonly.cancelled')
                  : t('inventory.count.readonly.noRight')}
            </p>
          )}
          <Link href="/app/inventory/movements" className="btn-ghost ml-auto">
            {t('inventory.link.movements')}
          </Link>
        </div>
      </section>

      {editable && (
        <p className="field-hint">{t('inventory.count.hint')}</p>
      )}
    </div>
  )
}
