'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { IconBox } from '@/components/icons'
import { UNITS, type RefItem } from './material-form'

export type MaterialOption = { id: string; name: string; unit: string; pao: number | null }
export type BatchOption = { id: string; materialId: string; number: string; expiry: string }

// Код наклейки — латиницей и цифрами: его диктуют по телефону и вбивают
// с клавиатуры сканера, где кириллицы может не быть вовсе.
//
// Кириллица в ключах этой карты — не строки интерфейса, а таблица
// транслитерации: она разбирает НАЗВАНИЕ засоба (данные арендатора)
// и в словарь локализации не едет.
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
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  // Значение для `<input type="date">` — через `t.inputDay`: срез
  // `toISOString()` режет по UTC и для отрицательных смещений подставлял
  // бы в поле вчерашний день.
  const today = useMemo(() => t.inputDay(new Date()), [t])
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
  const [bMade, setBMade] = useState('')
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
      // Экранная подпись для дубля кода; запасной путь — общий разбор (М25).
      setErr(error.code === '23505' ? t('inventory.containerForm.error.code') : dbErrorText(t, error))
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
      // Дата изготовления не обязательна: на части упаковок её попросту
      // нет. Но если она есть — без неё инспектору нечем сверить срок.
      manufactured_date: bMade || null,
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
        ? t('inventory.batchForm.error.duplicate')
        : dbErrorText(t, error))
      return
    }
    setBNumber(''); setBMade(''); setBExpiry(''); setBDone(true)
    router.refresh()
  }

  if (materials.length === 0) {
    // Тупика нет: формы заведения засоба в этой шторке не существует,
    // и честнее сказать, куда идти, чем оставить одну строку текста.
    return (
      <div className="empty">
        <span className="empty-icon"><IconBox size={24} /></span>
        <p className="empty-title">{t('inventory.containerForm.empty.title')}</p>
        <p className="empty-desc">{t('inventory.containerForm.empty.desc')}</p>
        <div className="empty-actions">
          <button type="button" className="btn-secondary" onClick={onDone}>
            {t('inventory.common.close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Вкладки без кнопки «Закрити»: закрытие — в нижнем ряду формы,
          как в material-form; действие в ряду фильтров читалось фильтром. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setMode('container'); setErr('') }}
                className={mode === 'container' ? 'chip-active' : 'chip'}>
          {t('inventory.containerForm.tab.container')}
        </button>
        <button type="button" onClick={() => { setMode('batch'); setErr('') }}
                className={mode === 'batch' ? 'chip-active' : 'chip'}>
          {t('inventory.containerForm.tab.batch')}
        </button>
      </div>

      {mode === 'container' && (
        <form onSubmit={saveContainer} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.containerForm.material.label')}</label>
            <select required className="select" value={material}
                    onChange={(e) => pickMaterial(e.target.value)}>
              <option value="">{t('inventory.common.choose')}</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.containerForm.batch.label')}</label>
            <select className="select" value={batchId} disabled={!material}
                    onChange={(e) => setBatchId(e.target.value)}>
              <option value="">{t('inventory.containerForm.batch.none')}</option>
              {materialBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  {t('inventory.containerForm.batch.option', {
                    number: b.number,
                    date: t.date(b.expiry, { day: 'numeric', month: 'short', year: '2-digit' }),
                  })}
                </option>
              ))}
            </select>
            {material && materialBatches.length === 0 && (
              <p className="field-hint">{t('inventory.containerForm.batch.hint')}</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.containerForm.code.label')}</label>
            <div className="flex gap-2">
              <input required className="input" placeholder="BLND-4821"
                     value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="btn-secondary shrink-0"
                      onClick={() => setCode(genCode(materials.find((m) => m.id === material)?.name ?? ''))}>
                {t('inventory.containerForm.code.generate')}
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">{t('inventory.containerForm.volume.label')}</label>
            <input type="number" min="0" step="any" className="input" placeholder="500"
                   value={volume} onChange={(e) => setVolume(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.containerForm.unit.label')}</label>
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">—</option>
              {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">{t('inventory.containerForm.pao.label')}</label>
            <input type="number" min="1" className="input"
                   placeholder={t('inventory.containerForm.pao.placeholder')}
                   value={pao} onChange={(e) => setPao(e.target.value)} />
          </div>

          <p className="field-hint sm:col-span-2">{t('inventory.containerForm.useBy.hint')}</p>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          {made && (
            <div className="card-flat rise sm:col-span-2">
              <p className="t-lg">{t('inventory.containerForm.created.title', { code: made })}</p>
              <p className="t-md mt-1 prose-muted">{t('inventory.containerForm.created.desc')}</p>
              <a href="/app/inventory/labels" target="_blank" rel="noreferrer"
                 className="btn-secondary mt-3 t-sm">
                {t('inventory.action.printLabels')}
              </a>
            </div>
          )}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !material || !code.trim()}>
              {t('inventory.containerForm.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={onDone}>
              {t('inventory.common.close')}
            </button>
          </div>
        </form>
      )}

      {mode === 'batch' && (
        <form onSubmit={saveBatch} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.containerForm.material.label')}</label>
            <select required className="select" value={bMaterial}
                    onChange={(e) => setBMaterial(e.target.value)}>
              <option value="">{t('inventory.common.choose')}</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">{t('inventory.batchForm.number.label')}</label>
            <input required className="input" placeholder={t('inventory.batchForm.number.placeholder')}
                   value={bNumber} onChange={(e) => setBNumber(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.batchForm.made.label')}</label>
            <input type="date" className="input" max={bExpiry || undefined}
                   value={bMade} onChange={(e) => setBMade(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.batchForm.expiry.label')}</label>
            <input required type="date" className="input" min={bMade || undefined}
                   value={bExpiry} onChange={(e) => setBExpiry(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.batchForm.received.label')}</label>
            <input type="date" className="input"
                   value={bReceived} onChange={(e) => setBReceived(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.batchForm.supplier.label')}</label>
            <select className="select" value={bSupplier} onChange={(e) => setBSupplier(e.target.value)}>
              <option value="">{t('inventory.common.notSet')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <p className="field-hint sm:col-span-2">{t('inventory.batchForm.hint')}</p>

          {err && <p className="field-error sm:col-span-2">{err}</p>}
          {bDone && (
            <p className="field-hint sm:col-span-2">{t('inventory.batchForm.saved')}</p>
          )}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !bMaterial || !bNumber.trim() || !bExpiry}>
              {t('inventory.batchForm.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={onDone}>
              {t('inventory.common.close')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
