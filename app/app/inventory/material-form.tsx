'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type RefItem = { id: string; name: string }

// Единица измерения в базе — свободный текст (словарь продавца).
// В форме это всё-таки список: свободный ввод рождает «мл», «Мл» и «ml»
// как три разные единицы — ровно та ошибка, из-за которой в 0009
// поставщика превратили из текста в таблицу.
export const UNITS = ['мл', 'г', 'шт', 'уп']

// Заведение расходника. Форма одна на весь материал: базовое сверху,
// косметический паспорт — за галочкой, потому что обычной нитке
// или фольге поля техрегламента не нужны и только пугают.
export function MaterialForm({
  tenantId, suppliers, locations, onDone,
}: {
  tenantId: string
  suppliers: RefItem[]
  locations: RefItem[]
  onDone: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [name, setName] = useState('')
  const [unit, setUnit] = useState(UNITS[0])
  const [category, setCategory] = useState('')
  const [threshold, setThreshold] = useState('0')
  const [cost, setCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState('')

  const [cosmetic, setCosmetic] = useState(false)
  const [brand, setBrand] = useState('')
  const [country, setCountry] = useState('')
  const [inci, setInci] = useState('')
  const [notification, setNotification] = useState('')
  const [pao, setPao] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.from('materials').insert({
      tenant_id: tenantId,
      name: name.trim(),
      unit,
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
      pao_months: cosmetic && Number(pao) > 0 ? Number(pao) : null,
    })
    setBusy(false)
    // 23505 — нарушение уникальности (tenant_id, name). Текст Postgres
    // мастеру в салоне ничего не объясняет, поэтому переводим.
    if (error) {
      setErr(error.code === '23505'
        ? 'Засіб із такою назвою вже є у списку'
        : error.message)
      return
    }
    router.refresh()
    onDone()
  }

  return (
    <form onSubmit={save} className="card rise grid gap-3 sm:grid-cols-2">
      <p className="display t-lg sm:col-span-2">Новий витратний засіб</p>

      <div className="sm:col-span-2">
        <label className="field-label">Назва</label>
        <input required autoFocus className="input" placeholder="Канекалон Jumbo, чорний"
               value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="field-label">Одиниця</label>
        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div>
        <label className="field-label">Мінімальний залишок</label>
        <input type="number" min="0" step="any" className="input"
               value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <p className="field-hint">
          Коли залишок опуститься до цього числа — засіб підсвітиться.
          Сам залишок вписати не можна: він набирається приходами і списаннями.
        </p>
      </div>

      <div>
        <label className="field-label">Ціна за одиницю, ₴</label>
        <input type="number" min="0" step="0.01" className="input" placeholder="не обовʼязково"
               value={cost} onChange={(e) => setCost(e.target.value)} />
      </div>

      <div>
        <label className="field-label">Категорія</label>
        <input className="input" placeholder="Канекалон"
               value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>

      <div>
        <label className="field-label">Постачальник</label>
        <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— не вказано —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label className="field-label">Місце зберігання</label>
        <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">— не вказано —</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <label className="t-md flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" checked={cosmetic}
               onChange={(e) => setCosmetic(e.target.checked)} />
        Косметичний засіб — потрібно для перевірки Держпродспоживслужби
      </label>

      {cosmetic && (
        <div className="card-flat grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <p className="t-xs prose-muted sm:col-span-2">
            Паспорт засобу за Технічним регламентом №65. Перепишіть з етикетки —
            саме це питає інспектор.
          </p>
          <div>
            <label className="field-label">Бренд</label>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Країна виробництва</label>
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Код нотифікації МОЗ</label>
            <input className="input" placeholder="з упаковки або від постачальника"
                   value={notification} onChange={(e) => setNotification(e.target.value)} />
          </div>
          <div>
            <label className="field-label">PAO, місяців</label>
            <input type="number" min="1" className="input" placeholder="12"
                   value={pao} onChange={(e) => setPao(e.target.value)} />
            <p className="field-hint">Скільки місяців придатний після відкриття (значок відкритої баночки).</p>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Склад INCI</label>
            <textarea className="textarea" placeholder="Aqua, Glycerin, …"
                      value={inci} onChange={(e) => setInci(e.target.value)} />
          </div>
        </div>
      )}

      {err && <p className="field-error sm:col-span-2">{err}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy || !name.trim()}>Зберегти</button>
        <button type="button" className="btn-ghost" onClick={onDone}>Скасувати</button>
      </div>
    </form>
  )
}
