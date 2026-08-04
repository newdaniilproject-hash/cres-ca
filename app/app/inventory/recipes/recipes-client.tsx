'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type RecipeLine = {
  variantId: string
  materialId: string
  quantity: number
  name: string
  unit: string
  cost: number | null
}

export type VariantRecipe = {
  id: string
  service: boolean
  title: string
  name: string
  unit: string
  lines: RecipeLine[]
}

type MaterialOption = { id: string; name: string; unit: string; cost: number | null }

// База отвечает по-русски и словами разработчика — переводим известное,
// незнакомое показываем как есть.
function humanize(message: string, code?: string): string {
  if (code === '23505') {
    return 'Цей засіб уже є в рецепті. Змініть кількість у наявному рядку.'
  }
  if (code === '23503') {
    return 'Засіб або позицію видалили — оновіть сторінку.'
  }
  if (code === '23514' || message.includes('quantity_per_unit')) {
    return 'Кількість має бути більшою за нуль.'
  }
  if (message.includes('row-level security') || message.includes('policy')) {
    return 'Немає права редагувати каталог (catalog.write). Попросіть власника магазину видати його.'
  }
  return message
}

// Рецептура: что уходит на одну единицу услуги или товара. Экран
// раскрывающийся, а не табличный: состав правят по одной позиции,
// а список позиций у салона длиннее, чем экран телефона.
export function RecipesClient({
  variants, materials, canWrite, error, loadError,
}: {
  variants: VariantRecipe[]
  materials: MaterialOption[]
  canWrite: boolean
  error: string
  loadError: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [tab, setTab] = useState<'services' | 'goods'>('services')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // Форма добавления одна на весь экран: она относится к раскрытой позиции,
  // и держать её состояние на каждую позицию отдельно незачем.
  const [materialId, setMaterialId] = useState('')
  const [qty, setQty] = useState('')

  const shown = variants.filter((v) => (tab === 'services' ? v.service : !v.service))
  const unit = materials.find((mt) => mt.id === materialId)?.unit ?? ''

  const lineCost = (l: RecipeLine) => (l.cost != null ? l.cost * l.quantity : null)
  const sum = (lines: RecipeLine[]) =>
    lines.reduce((acc, l) => acc + (lineCost(l) ?? 0), 0)
  const money = (n: number) =>
    n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })

  function toggle(id: string) {
    setOpenId(openId === id ? null : id)
    setMaterialId(''); setQty(''); setErr('')
  }

  async function addLine(e: React.FormEvent, variantId: string) {
    e.preventDefault()
    setBusy(variantId); setErr('')
    const { error: insertError } = await supabase.from('variant_materials').insert({
      variant_id: variantId,
      material_id: materialId,
      quantity_per_unit: Number(qty),
    })
    setBusy(null)
    if (insertError) { setErr(humanize(insertError.message, insertError.code)); return }
    setMaterialId(''); setQty('')
    router.refresh()
  }

  async function removeLine(l: RecipeLine) {
    setBusy(l.materialId); setErr('')
    // Первичный ключ таблицы — пара (variant_id, material_id), другого
    // идентификатора у строки просто нет.
    const { error: deleteError } = await supabase.from('variant_materials')
      .delete()
      .eq('variant_id', l.variantId)
      .eq('material_id', l.materialId)
    setBusy(null)
    if (deleteError) { setErr(humanize(deleteError.message, deleteError.code)); return }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити позиції: {error}</p>}
      {loadError && <p className="field-error rise">Не вдалося завантажити склад рецептів: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      <section className="card rise">
        <p className="eyebrow">Списання за рецептом</p>
        <p className="t-md mt-2 prose-muted">
          Тут ви один раз описуєте, що йде на одну одиницю: на «Коси 60 см» —
          4 упаковки канекалону і 30 мл засобу. Далі рахувати не треба:
          коли запис переводять у статус «виконано», склад спишеться сам.
          Редагування рецепта нічого не списує — воно лише змінює правило
          на майбутнє.
        </p>
      </section>

      <div className="rise-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setTab('services'); setOpenId(null) }}
                className={tab === 'services' ? 'chip-active' : 'chip'}>
          Послуги
        </button>
        <button type="button" onClick={() => { setTab('goods'); setOpenId(null) }}
                className={tab === 'goods' ? 'chip-active' : 'chip'}>
          Товари
        </button>
      </div>

      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            {tab === 'services'
              ? 'Послуг ще немає — їх заводять у каталозі.'
              : 'Товарів ще немає — їх заводять у каталозі.'}
          </div>
        ) : shown.map((v) => {
          const open = openId === v.id
          const total = sum(v.lines)
          const partial = v.lines.some((l) => l.cost == null)
          return (
            <div key={v.id} className="px-5">
              <div className="row">
                <button type="button" className="min-w-0 flex-1 text-left"
                        onClick={() => toggle(v.id)}>
                  <p className="t-md truncate">
                    {v.title}<span className="prose-muted"> · {v.name}</span>
                  </p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {v.lines.length === 0
                      ? 'склад не описано'
                      : `позицій у складі: ${v.lines.length}`}
                    {v.lines.length > 0 && total > 0
                      ? ` · ${partial ? 'від ' : ''}${money(total)} ₴ за 1 ${v.unit}`
                      : ''}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {v.lines.length > 0 && <span className="badge-accent tabular">{v.lines.length}</span>}
                  <button type="button" className="btn-icon" onClick={() => toggle(v.id)}
                          title={open ? 'Згорнути' : 'Показати склад'}>
                    {open ? '−' : '+'}
                  </button>
                </div>
              </div>

              {open && (
                <div className="pb-5">
                  {v.lines.length === 0 ? (
                    <p className="t-md prose-muted">
                      Склад порожній — під час виконання нічого не спишеться.
                    </p>
                  ) : (
                    <div className="card-flat !p-0 px-4">
                      {v.lines.map((l) => {
                        const c = lineCost(l)
                        return (
                          <div key={l.materialId} className="row">
                            <div className="min-w-0">
                              <p className="t-md truncate">{l.name}</p>
                              <p className="tabular t-xs mt-0.5 prose-muted">
                                {l.quantity} {l.unit} на 1 {v.unit}
                                {c != null ? ` · ${money(c)} ₴` : ' · ціну засобу не вказано'}
                              </p>
                            </div>
                            {canWrite && (
                              <button type="button" className="btn-icon" title="Прибрати з рецепта"
                                      disabled={busy !== null}
                                      onClick={() => void removeLine(l)}>
                                ✕
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {canWrite && (
                    <form onSubmit={(e) => void addLine(e, v.id)}
                          className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="field-label">Витратний засіб</label>
                        <select required className="select" value={materialId}
                                onChange={(e) => setMaterialId(e.target.value)}>
                          <option value="">— оберіть —</option>
                          {materials
                            .filter((mt) => !v.lines.some((l) => l.materialId === mt.id))
                            .map((mt) => (
                              <option key={mt.id} value={mt.id}>{mt.name}</option>
                            ))}
                        </select>
                        {materials.length === 0 && (
                          <p className="field-hint">
                            Витратних засобів ще немає — заведіть їх на складі.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="field-label">
                          Скільки йде на 1 {v.unit}{unit ? `, ${unit}` : ''}
                        </label>
                        <input required type="number" min="0.001" step="any" className="input"
                               placeholder="4" value={qty}
                               onChange={(e) => setQty(e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <button className="btn-primary"
                                disabled={busy !== null || !materialId || !qty}>
                          Додати до рецепта
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <p className="field-hint">
        Собівартість рахується з ціни за одиницю витратного засобу. Якщо
        її не вказано, засіб у суму не потрапляє — сума показується як «від».
      </p>

      {!canWrite && (
        <p className="field-hint">
          Немає права редагувати каталог, тому рецепти доступні лише для перегляду.
        </p>
      )}
    </div>
  )
}
