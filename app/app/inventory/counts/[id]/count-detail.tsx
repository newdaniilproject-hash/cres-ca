'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { COUNT_STATUS_LABEL, countBadge, humanizeCount, qty } from '../counts-client'

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

  const shownValue = (l: CountLine) => draft[l.id] ?? (l.counted != null ? String(l.counted) : '')
  const num = (s: string) => {
    // Запятая — то, что реально набирают на украинской раскладке телефона,
    // и Number('0,5') это NaN. Приводим до разбора, а не после.
    const t = s.trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
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
      setErr('Залишок не буває відʼємним — перевірте введене число.')
      return
    }

    setBusy(line.id); setErr('')
    const { error } = await supabase.from('stock_count_lines')
      .update({ counted_qty: next }).eq('id', line.id)
    setBusy(null)
    if (error) { setErr(humanizeCount(error.message)); return }
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
        ? `«${known}» не входить у цей перерахунок`
        : `Код «${q}» не знайдено`)
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
      toast.warn('Камера-сканер недоступний',
        'Працює у Chrome на Android. Введіть код вручну — поле поруч.')
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
      else toast.info('Код не зчитано', 'Спробуйте ще раз або введіть вручну.')
    } catch {
      toast.error('Камера не відкрилась', 'Введіть код вручну — поле поруч.')
    }
  }

  async function apply() {
    const unfilled = lines.length - filled
    const warn = unfilled > 0
      ? `Не заповнено позицій: ${unfilled}. Вони лишаться без змін. `
      : ''
    if (!confirm(`${warn}Провести інвентаризацію? Розбіжності стануть рухами «коригування», і документ закриється назавжди.`)) return

    setBusy('apply'); setErr('')
    // Единственный путь: функция в одной транзакции проводит все расхождения
    // движениями 'adjustment' и закрывает документ. Правкой stock_qty это
    // сделать нельзя — триггер-охранник не даст (CLAUDE.md, правило 5).
    const { error } = await supabase.rpc('apply_stock_count', { p_count_id: count.id })
    setBusy(null)
    if (error) { setErr(humanizeCount(error.message)); return }
    toast.success('Інвентаризацію проведено',
      mismatches > 0
        ? `Розбіжностей рознесено: ${mismatches}. Дивіться їх у журналі рухів.`
        : 'Розбіжностей не було — залишок не змінився.')
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">

      {/* ── Шапка документа: где мы и сколько ещё идти ───────── */}
      <section className="card rise-1">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <p className="tabular t-lg">Перерахунок від {fmt(count.startedAt)}</p>
            <p className="tabular t-xs mt-0.5 prose-muted">
              {count.appliedAt ? `проведено ${fmt(count.appliedAt)}` : 'триває'}
              {count.note ? ` · ${count.note}` : ''}
            </p>
          </div>
          <span className={`${countBadge(count.status)} ml-auto`}>
            {COUNT_STATUS_LABEL[count.status] ?? count.status}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="badge-accent tabular">
            заповнено {filled} з {lines.length}
          </span>
          {mismatches > 0 && (
            <span className="badge-warn tabular">розбіжностей: {mismatches}</span>
          )}
        </div>
      </section>

      {loadError && <p className="field-error rise">Рядки не завантажились: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* ── Сканер: пересчёт ведут с кодом в руке ────────────── */}
      {editable && (
        <section className="card rise-2">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Сканувати наліпку або ввести код…"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
              autoComplete="off"
              inputMode="text"
            />
            <button type="button" onClick={() => void lookup(code)}
                    className="btn-secondary shrink-0">
              Знайти
            </button>
            <button type="button" onClick={() => void scanCamera()}
                    className="btn-primary shrink-0" title="Сканувати камерою"
                    aria-label="Сканувати камерою">
              ⌗
            </button>
          </div>
          {scanMiss && <p className="field-error">{scanMiss}</p>}
          <p className="field-hint">
            Годиться і QR наліпки з банки, і заводський штрихкод. Знайдений
            рядок підсвітиться і сам стане під курсор — лишиться вписати те,
            що бачите на полиці.
          </p>
        </section>
      )}

      {/* ── Фильтр состояния ─────────────────────────────────── */}
      {lines.length > 0 && (
        <div className="rise-2 flex flex-wrap gap-2">
          {([
            ['all', `Усі · ${lines.length}`],
            ['todo', `Не пораховані · ${lines.length - filled}`],
            ['diff', `Розбіжності · ${mismatches}`],
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
            <div className="empty">
              У цьому документі немає жодної позиції — проводити нічого.
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {filter === 'todo'
                ? 'Усі позиції пораховані — можна проводити.'
                : 'Розбіжностей немає: факт збігся з обліком скрізь.'}
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
                      <span className="prose-muted"> · засіб</span>
                    )}
                  </p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    очікується {qty(l.expected)} {l.unit}
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
                      placeholder="факт"
                      value={shownValue(l)}
                      disabled={busy === l.id}
                      onFocus={() => setHit(l.id)}
                      onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                      onBlur={() => void saveLine(l)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    />
                  ) : (
                    <span className="badge tabular">
                      {l.counted != null ? `${qty(l.counted)} ${l.unit}` : 'не рахували'}
                    </span>
                  )}
                  {diff == null ? (
                    <span className="badge">—</span>
                  ) : diff === 0 ? (
                    <span className="badge-success">збіглось</span>
                  ) : diff < 0 ? (
                    <span className="badge-danger tabular">нестача {qty(Math.abs(diff))}</span>
                  ) : (
                    <span className="badge-warn tabular">надлишок +{qty(diff)}</span>
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
                    disabled={busy !== null || lines.length === 0}
                    onClick={() => void apply()}>
              {busy === 'apply' ? 'Проводимо…' : 'Провести інвентаризацію'}
            </button>
          ) : (
            <p className="t-md prose-muted">
              {count.status === 'applied'
                ? 'Документ проведено — розбіжності вже стали коригуваннями в журналі, і правити його не можна.'
                : count.status === 'cancelled'
                  ? 'Перерахунок скасовано — на залишок він не вплинув.'
                  : 'Немає права змінювати склад, тому документ доступний лише для перегляду.'}
            </p>
          )}
          <Link href="/app/inventory/movements" className="btn-ghost ml-auto">
            Журнал рухів
          </Link>
        </div>
      </section>

      {editable && (
        <p className="field-hint">
          Факт зберігається сам, щойно ви переходите до наступного рядка —
          залишок при цьому не змінюється. Він зміниться один раз, під час
          проведення: на кожну розбіжність база запише рух «коригування».
          Вписати залишок напряму не можна ніде в системі — і це навмисно.
        </p>
      )}
    </div>
  )
}
