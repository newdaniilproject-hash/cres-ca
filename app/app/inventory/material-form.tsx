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
  paoMonths: number | null
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
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [name, setName] = useState(material?.name ?? '')
  const [unit, setUnit] = useState(material?.unit ?? UNITS[0])
  const [sku, setSku] = useState(material?.sku ?? '')
  const [category, setCategory] = useState(material?.category ?? '')
  const [threshold, setThreshold] = useState(String(material?.threshold ?? 0))
  const [cost, setCost] = useState(material?.cost != null ? String(material.cost) : '')
  const [supplierId, setSupplierId] = useState(material?.supplierId ?? '')
  const [locationId, setLocationId] = useState(material?.locationId ?? '')

  const [cosmetic, setCosmetic] = useState(material?.isCosmetic ?? false)
  const [brand, setBrand] = useState(material?.brand ?? '')
  const [country, setCountry] = useState(material?.country ?? '')
  const [inci, setInci] = useState(material?.inci ?? '')
  const [notification, setNotification] = useState(material?.notificationCode ?? '')
  const [notificationUrl, setNotificationUrl] = useState(material?.notificationUrl ?? '')
  const [notificationDate, setNotificationDate] = useState(material?.notificationDate ?? '')
  const [pao, setPao] = useState(material?.paoMonths != null ? String(material.paoMonths) : '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')

    const url = notificationUrl.trim()
    // База отобьёт неправильную ссылку ограничением, но текст Postgres
    // мастеру ничего не объясняет — проверяем здесь и говорим по-людски.
    if (cosmetic && url && !/^https?:\/\//i.test(url)) {
      setBusy(false)
      setErr('Посилання на реєстр МОЗ має починатися з https://')
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
    }

    const { error } = material
      ? await supabase.from('materials').update(row).eq('id', material.id)
      : await supabase.from('materials').insert({ tenant_id: tenantId, ...row })

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
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">

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
        <label className="field-label">Артикул</label>
        <input className="input" placeholder="KJ-24-BLK"
               value={sku} onChange={(e) => setSku(e.target.value)} />
        <p className="field-hint">Код з етикетки чи накладної — за ним шукає і інспектор, і постачальник.</p>
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

      <label className="t-md flex items-center gap-2 sm:col-span-2"
             style={{ minHeight: 'var(--tap-min)' }}>
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
            <input className="input" placeholder="UA.TR.116.003-25"
                   value={notification} onChange={(e) => setNotification(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Дата внесення до реєстру</label>
            <input type="date" className="input"
                   value={notificationDate} onChange={(e) => setNotificationDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Посилання на запис у реєстрі МОЗ</label>
            <input type="url" inputMode="url" className="input"
                   placeholder="https://…"
                   value={notificationUrl} onChange={(e) => setNotificationUrl(e.target.value)} />
            <p className="field-hint">
              ТЗ вимагає саме посилання, а не тільки код: за кодом інспектор
              нічого не перевірить, він відкриває запис у реєстрі.
            </p>
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
        <button className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>Скасувати</button>
      </div>
    </form>
  )
}
