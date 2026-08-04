'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { COUNT_STATUS_LABEL, countBadge, humanizeCount } from '../counts-client'

export type CountCard = {
  id: string
  status: string
  note: string | null
  startedAt: string
  appliedAt: string | null
}

export type CountLine = {
  id: string
  variantId: string
  title: string
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
  const counting = count.status === 'counting'
  const editable = counting && canWrite

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [scanMiss, setScanMiss] = useState('')
  // Подсвеченная строка держится до следующего скана: мастер отводит глаза
  // на полку и возвращается — строка должна остаться найденной.
  const [hit, setHit] = useState<string | null>(null)

  // Введённое перекрывает пришедшее с сервера, пока страница не обновилась.
  // Пустая строка — осознанное «ещё не считал», поэтому храним именно текст,
  // а не число: null и 0 в поле ввода выглядят одинаково, а значат разное.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const inputs = useRef(new Map<string, HTMLInputElement | null>())

  const shown = (l: CountLine) => draft[l.id] ?? (l.counted != null ? String(l.counted) : '')
  const num = (s: string) => {
    const t = s.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const filled = lines.filter((l) => num(shown(l)) != null).length
  const diffs = lines
    .map((l) => {
      const c = num(shown(l))
      return c == null ? null : c - l.expected
    })
  const mismatches = diffs.filter((d) => d != null && d !== 0).length

  async function saveLine(line: CountLine) {
    const value = num(shown(line))
    // counted_qty в базе целое: остаток товара считается штуками. Дробь
    // молча округлилась бы в Postgres — округляем здесь и видимо.
    const next = value == null ? null : Math.round(value)
    if (next === line.counted) return

    setBusy(line.id); setErr('')
    const { error } = await supabase.from('stock_count_lines')
      .update({ counted_qty: next }).eq('id', line.id)
    setBusy(null)
    if (error) { setErr(humanizeCount(error.message)); return }
    setDraft((d) => ({ ...d, [line.id]: next == null ? '' : String(next) }))
    router.refresh()
  }

  // Пересчёт удобно вести со сканером: код в руке, а не палец в списке
  // из ста строк. Ищем тем же вызовом, что и главный экран склада.
  async function lookup(raw: string) {
    const q = raw.trim()
    if (!q) return
    setCode(''); setScanMiss('')
    const { data } = await supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: q })
    const found = (data ?? []) as { kind: string; id: string; title: string }[]
    const line = found
      .map((f) => lines.find((l) => l.variantId === f.id))
      .find((l): l is CountLine => l != null)

    if (!line) {
      setHit(null)
      setScanMiss(found.length > 0
        ? `«${q}» — це не позиція цього перерахунку`
        : `Код «${q}» не знайдено`)
      return
    }
    setHit(line.id)
    const el = inputs.current.get(line.id)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus()
    el?.select()
  }

  async function scanCamera() {
    // BarcodeDetector есть в Chrome на Android — основной телефон мастера.
    type BD = { detect(source: ImageBitmap): Promise<{ rawValue: string }[]> }
    const W = window as unknown as { BarcodeDetector?: new (o?: object) => BD }
    if (!W.BarcodeDetector) {
      alert('Камера-сканер працює у Chrome на Android. Введіть код вручну.')
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
      let code: string | null = null
      while (!code && Date.now() < deadline) {
        const frame = await capture.grabFrame()
        const codes = await detector.detect(frame)
        if (codes.length > 0) code = codes[0].rawValue
        await new Promise((r) => setTimeout(r, 180))
      }
      track.stop()
      if (code) await lookup(code)
    } catch {
      alert('Не вдалося відкрити камеру — введіть код вручну.')
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
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory/counts" className="btn-ghost">← Усі перерахунки</Link>
        <Link href="/app/inventory" className="btn-ghost">Склад</Link>
        <span className={`${countBadge(count.status)} ml-auto`}>
          {COUNT_STATUS_LABEL[count.status] ?? count.status}
        </span>
      </div>

      {loadError && <p className="field-error rise">Рядки не завантажились: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* Шапка документа: где мы находимся и сколько ещё идти */}
      <section className="card rise-1">
        <p className="tabular t-lg">Перерахунок від {fmt(count.startedAt)}</p>
        <p className="tabular t-xs mt-0.5 prose-muted">
          {count.appliedAt ? `проведено ${fmt(count.appliedAt)}` : 'триває'}
          {count.note ? ` · ${count.note}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="badge-accent tabular">
            заповнено {filled} з {lines.length}
          </span>
          {mismatches > 0 && (
            <span className="badge-warn tabular">розбіжностей: {mismatches}</span>
          )}
        </div>
      </section>

      {/* Сканер: пересчёт ведут с кодом в руке */}
      {editable && (
        <section className="card rise-2">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Сканувати або ввести код…"
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
                    className="btn-primary shrink-0" title="Сканувати камерою">
              ⌗
            </button>
          </div>
          {scanMiss && <p className="field-error">{scanMiss}</p>}
          <p className="field-hint">
            Знайдений рядок підсвітиться і сам стане під курсор — лишиться
            вписати те, що бачите на полиці.
          </p>
        </section>
      )}

      {/* Строки */}
      <section className="card rise-3 !p-0">
        <div className="px-5">
          {lines.length === 0 ? (
            <div className="empty">
              У цьому документі немає жодної позиції — проводити нічого.
            </div>
          ) : lines.map((l, i) => {
            const diff = diffs[i]
            // Подсветка найденной строки — тенью с переменной темы, а не
            // подобранным цветом: иначе она разъедется при правке палитры.
            const found = hit === l.id
            return (
              <div key={l.id} className="row"
                   style={found
                     ? { boxShadow: '0 0 0 2px var(--color-accent)', borderRadius: 'var(--radius-control)' }
                     : undefined}>
                <div className="min-w-0">
                  <p className="t-md truncate">{l.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    очікується {l.expected} {l.unit}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editable ? (
                    <input
                      ref={(el) => { inputs.current.set(l.id, el) }}
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      className="input w-24"
                      placeholder="факт"
                      value={shown(l)}
                      disabled={busy === l.id}
                      onFocus={() => setHit(l.id)}
                      onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                      onBlur={() => void saveLine(l)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    />
                  ) : (
                    <span className="badge tabular">
                      {l.counted != null ? `${l.counted} ${l.unit}` : 'не рахували'}
                    </span>
                  )}
                  {diff == null ? (
                    <span className="badge">—</span>
                  ) : diff === 0 ? (
                    <span className="badge-success">збіглось</span>
                  ) : diff < 0 ? (
                    <span className="badge-danger tabular">нестача {Math.abs(diff)}</span>
                  ) : (
                    <span className="badge-warn tabular">надлишок +{diff}</span>
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
              Провести інвентаризацію
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
