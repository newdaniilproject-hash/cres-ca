'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UNITS, type RefItem } from './material-form'

export type MaterialOption = { id: string; name: string; unit: string; pao: number | null }
export type BatchOption = { id: string; materialId: string; number: string; expiry: string }

// Код наклейки — латиницей и цифрами: его диктуют по телефону и вбивают
// с клавиатуры сканера, где кириллицы может не быть вовсе.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh',
  з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', ы: 'y', э: 'e',
  ё: 'e', ъ: '',
}

// Первые буквы названия + четыре цифры: «BLND-4821» человек прочитает
// вслух и найдёт глазами на полке. Случайные цифры, а не счётчик, —
// чтобы не ходить в базу за следующим номером на каждое нажатие.
function genCode(name: string): string {
  const latin = Array.from(name.toLowerCase())
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '')
  const prefix = (latin.slice(0, 4) || 'mat').toUpperCase()
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`
}

// Партия и банка одним экраном: это два шага одного действия «прийшов
// товар». Партия — метаданные прослеживаемости (номер и срок с коробки),
// банка — физическая ёмкость с кодом на наклейке.
export function ContainerForm({
  tenantId, userId, materials, batches, suppliers, onDone,
}: {
  tenantId: string
  userId: string
  materials: MaterialOption[]
  batches: BatchOption[]
  suppliers: RefItem[]
  onDone: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [mode, setMode] = useState<'container' | 'batch'>('container')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // банка
  const [material, setMaterial] = useState('')
  const [batchId, setBatchId] = useState('')
  const [code, setCode] = useState('')
  const [volume, setVolume] = useState('')
  const [unit, setUnit] = useState('')
  const [pao, setPao] = useState('')
  const [made, setMade] = useState<string | null>(null)

  // партия
  const [bMaterial, setBMaterial] = useState('')
  const [bNumber, setBNumber] = useState('')
  const [bExpiry, setBExpiry] = useState('')
  const [bReceived, setBReceived] = useState(today)
  const [bSupplier, setBSupplier] = useState('')
  const [bDone, setBDone] = useState(false)

  // Выбор материала подставляет всё, что о нём уже известно: единицу,
  // PAO и готовый код. Форма становится короче на три поля.
  function pickMaterial(id: string) {
    setMaterial(id)
    setBatchId('')
    const m = materials.find((x) => x.id === id)
    if (!m) return
    setUnit(m.unit)
    setPao(m.pao != null ? String(m.pao) : '')
    setCode(genCode(m.name))
  }

  const unitOptions = Array.from(new Set([...UNITS, unit].filter(Boolean)))
  const materialBatches = batches.filter((b) => b.materialId === material)

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: '2-digit' })

  async function saveContainer(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(''); setMade(null)
    const { error } = await supabase.from('material_containers').insert({
      tenant_id: tenantId,
      material_id: material,
      batch_id: batchId || null,
      code: code.trim(),
      volume: volume.trim() ? Number(volume) : null,
      unit: unit || null,
      pao_months: Number(pao) > 0 ? Number(pao) : null,
      created_by: userId,
      // status оставляем по умолчанию 'sealed': банку заводят закрытой,
      // а открывают сканером в момент, когда реально сорвали пломбу —
      // от этого мгновения база считает use_by.
    })
    setBusy(false)
    if (error) {
      setErr(error.code === '23505' ? 'Такий код вже є' : error.message)
      return
    }
    const created = code.trim()
    setMade(created)
    // Следующая банка обычно из той же партии — сбрасываем только код.
    setCode(genCode(materials.find((m) => m.id === material)?.name ?? ''))
    router.refresh()
  }

  async function saveBatch(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(''); setBDone(false)
    const { error } = await supabase.from('material_batches').insert({
      tenant_id: tenantId,
      material_id: bMaterial,
      batch_number: bNumber.trim(),
      expiry_date: bExpiry,
      // Поле даты можно очистить прямо в браузере — тогда ключ не
      // отправляем вовсе и срабатывает дефолт базы (сегодня).
      ...(bReceived ? { received_at: bReceived } : {}),
      supplier_id: bSupplier || null,
      created_by: userId,
    })
    setBusy(false)
    if (error) {
      setErr(error.code === '23505'
        ? 'Така партія для цього засобу вже заведена'
        : error.message)
      return
    }
    setBNumber(''); setBExpiry(''); setBDone(true)
    router.refresh()
  }

  if (materials.length === 0) {
    return (
      <div className="card rise empty">
        Спочатку заведіть витратний засіб — партії та банки чіпляються до нього.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setMode('container'); setErr('') }}
                className={mode === 'container' ? 'chip-active' : 'chip'}>
          Нова банка
        </button>
        <button type="button" onClick={() => { setMode('batch'); setErr('') }}
                className={mode === 'batch' ? 'chip-active' : 'chip'}>
          Нова партія
        </button>
        <button type="button" className="btn-ghost ml-auto" onClick={onDone}>Закрити</button>
      </div>

      {mode === 'container' && (
        <form onSubmit={saveContainer} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">Засіб</label>
            <select required className="select" value={material}
                    onChange={(e) => pickMaterial(e.target.value)}>
              <option value="">— оберіть —</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">Партія</label>
            <select className="select" value={batchId} disabled={!material}
                    onChange={(e) => setBatchId(e.target.value)}>
              <option value="">— без партії —</option>
              {materialBatches.map((b) => (
                <option key={b.id} value={b.id}>{b.number} · до {fmtDate(b.expiry)}</option>
              ))}
            </select>
            {material && materialBatches.length === 0 && (
              <p className="field-hint">
                Партій для цього засобу ще немає — заведіть її на сусідній вкладці,
                щоб система знала заводський термін придатності.
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">Код на наліпці</label>
            <div className="flex gap-2">
              <input required className="input" placeholder="BLND-4821"
                     value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="btn-secondary shrink-0"
                      onClick={() => setCode(genCode(materials.find((m) => m.id === material)?.name ?? ''))}>
                Згенерувати
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">Обʼєм</label>
            <input type="number" min="0" step="any" className="input" placeholder="500"
                   value={volume} onChange={(e) => setVolume(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Одиниця</label>
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">—</option>
              {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">PAO, місяців</label>
            <input type="number" min="1" className="input" placeholder="з картки засобу"
                   value={pao} onChange={(e) => setPao(e.target.value)} />
          </div>

          <p className="field-hint sm:col-span-2">
            Дату «використати до» рахує система: менша з двох — термін партії
            або день відкриття плюс PAO. Вручну її вводити не треба, і саме тому
            в ній не можна помилитися.
          </p>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          {made && (
            <div className="card-flat rise sm:col-span-2">
              <p className="t-lg">Банку {made} створено</p>
              <p className="t-md mt-1 prose-muted">
                Роздрукуйте наліпку з QR і наклейте на банку — далі майстер
                просто сканує її камерою.
              </p>
              <a href="/app/inventory/labels" target="_blank" rel="noreferrer"
                 className="btn-secondary mt-3 h-9 t-sm">
                Друк QR-наліпок
              </a>
            </div>
          )}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !material || !code.trim()}>
              Завести банку
            </button>
          </div>
        </form>
      )}

      {mode === 'batch' && (
        <form onSubmit={saveBatch} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">Засіб</label>
            <select required className="select" value={bMaterial}
                    onChange={(e) => setBMaterial(e.target.value)}>
              <option value="">— оберіть —</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">Номер партії</label>
            <input required className="input" placeholder="з коробки"
                   value={bNumber} onChange={(e) => setBNumber(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Придатна до</label>
            <input required type="date" className="input"
                   value={bExpiry} onChange={(e) => setBExpiry(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Дата отримання</label>
            <input type="date" className="input"
                   value={bReceived} onChange={(e) => setBReceived(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Постачальник</label>
            <select className="select" value={bSupplier} onChange={(e) => setBSupplier(e.target.value)}>
              <option value="">— не вказано —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <p className="field-hint sm:col-span-2">
            Партія — це не другий облік залишку, а простежуваність: який номер
            і до якого числа придатний товар, що ви прийняли. Кількість
            рахується приходами.
          </p>

          {err && <p className="field-error sm:col-span-2">{err}</p>}
          {bDone && <p className="field-hint sm:col-span-2">Партію збережено — тепер її можна обрати для банки.</p>}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !bMaterial || !bNumber.trim() || !bExpiry}>
              Зберегти партію
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
