'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'
import { IconBeaker, IconChevronRight, IconClose } from '@/components/icons'

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
// незнакомое показываем как есть. Подстроки и коды, по которым разбирается
// отказ, — текст базы: в словарь едет только наш ответ.
function humanize(t: T, message: string, code?: string): string {
  if (code === '23505') {
    return t('inventory.recipes.error.duplicate')
  }
  if (code === '23503') {
    return t('inventory.recipes.error.missing')
  }
  if (code === '23514' || message.includes('quantity_per_unit')) {
    return t('inventory.recipes.error.qty')
  }
  if (message.includes('row-level security') || message.includes('policy')) {
    return t('inventory.recipes.error.catalogWrite')
  }
  // Незнакомое базе-специфичное сюда не доходит: общий разбор
  // (`lib/errors/db.ts`) не отдаёт человеку сырой текст Postgres.
  return dbErrorText(t, { message, code })
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
  const t = useT()
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
    if (insertError) { setErr(humanize(t, insertError.message, insertError.code)); return }
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
    if (deleteError) { setErr(humanize(t, deleteError.message, deleteError.code)); return }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Отказ загрузки приезжает с сервера уже переведённым (`dbErrorText`
          в page.tsx): сырой текст Postgres печатает значения полей (М25). */}
      {error && (
        <p className="field-error rise">{t('inventory.recipes.error.variants')}: {error}</p>
      )}
      {loadError && (
        <p className="field-error rise">{t('inventory.recipes.error.lines')}: {loadError}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      {/* Вкладки — уезжающей вбок строкой, как на складе: перенос на вторую
          строку смешал бы их с тем, что стоит ниже. */}
      <div className="scroll-x rise -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        <button type="button" onClick={() => { setTab('services'); setOpenId(null) }}
                className={`${tab === 'services' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('inventory.recipes.tab.services')}
        </button>
        <button type="button" onClick={() => { setTab('goods'); setOpenId(null) }}
                className={`${tab === 'goods' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('inventory.recipes.tab.goods')}
        </button>
      </div>

      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          // Позиции заводятся в каталоге, а не здесь: этот экран — обратный
          // взгляд «куди йде засіб», второй формы заведения быть не должно.
          <div className="empty">
            <span className="empty-icon"><IconBeaker size={24} /></span>
            <p className="empty-title">{t('inventory.recipes.empty.title')}</p>
            <p className="empty-desc">
              {tab === 'services'
                ? t('inventory.recipes.empty.services')
                : t('inventory.recipes.empty.goods')}
            </p>
            <div className="empty-actions">
              <Link href="/app/catalog" className="btn-primary">
                {t('inventory.action.addInCatalog')}
              </Link>
            </div>
          </div>
        ) : shown.map((v) => {
          const open = openId === v.id
          const total = sum(v.lines)
          const partial = v.lines.some((l) => l.cost == null)
          return (
            <div key={v.id} className="px-5">
              {/* Вся строка — ОДНА кнопка. Раньше тело строки и «+» справа
                  звали один и тот же toggle — два входа в одно действие,
                  тот самый дубляж, из-за которого переделывался склад.
                  Шеврон — указатель, а не кнопка: нажимается строка. */}
              <button type="button" className="row w-full text-left"
                      style={{ minHeight: 'var(--tap-min)' }}
                      aria-expanded={open}
                      onClick={() => toggle(v.id)}>
                <span className="min-w-0 flex-1">
                  <span className="t-md block truncate">
                    {v.title}<span className="prose-muted"> · {v.name}</span>
                  </span>
                  <span className="tabular t-xs mt-0.5 block prose-muted">
                    {v.lines.length === 0
                      ? t('inventory.recipes.noComposition')
                      : t('inventory.recipes.lines', { n: t.number(v.lines.length) })}
                    {v.lines.length > 0 && total > 0
                      ? ` · ${partial
                        ? t('inventory.recipes.costFrom', { money: t.money(total), unit: v.unit })
                        : t('inventory.recipes.cost', { money: t.money(total), unit: v.unit })}`
                      : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {v.lines.length > 0 && (
                    <span className="badge-accent tabular">{t.number(v.lines.length)}</span>
                  )}
                  <IconChevronRight
                    className={`prose-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                </span>
              </button>

              {open && (
                <div className="pb-5">
                  {v.lines.length === 0 ? (
                    <p className="t-md prose-muted">{t('inventory.recipes.empty.lines')}</p>
                  ) : (
                    <div className="card-flat !p-0 px-4">
                      {v.lines.map((l) => {
                        const c = lineCost(l)
                        return (
                          <div key={l.materialId} className="row">
                            <div className="min-w-0">
                              <p className="t-md truncate">{l.name}</p>
                              <p className="tabular t-xs mt-0.5 prose-muted">
                                {t('inventory.recipes.line.per', {
                                  qty: t.number(l.quantity), unit: l.unit, target: v.unit,
                                })}
                                {c != null
                                  ? ` · ${t.money(c)}`
                                  : ` · ${t('inventory.recipes.line.noCost')}`}
                              </p>
                            </div>
                            {canWrite && (
                              <button type="button" className="btn-icon"
                                      title={t('inventory.recipes.remove.aria')}
                                      aria-label={t('inventory.recipes.remove.aria')}
                                      disabled={busy !== null}
                                      onClick={() => void removeLine(l)}>
                                {/* Значок, а не глиф «✕»: текстовые символы
                                    рисуются каждой прошивкой по-своему. */}
                                <IconClose size={18} />
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
                        <label className="field-label">{t('inventory.recipes.add.material.label')}</label>
                        <select required className="select" value={materialId}
                                onChange={(e) => setMaterialId(e.target.value)}>
                          <option value="">{t('inventory.common.choose')}</option>
                          {materials
                            .filter((mt) => !v.lines.some((l) => l.materialId === mt.id))
                            .map((mt) => (
                              <option key={mt.id} value={mt.id}>{mt.name}</option>
                            ))}
                        </select>
                        {materials.length === 0 && (
                          <p className="field-hint">{t('inventory.recipes.add.noMaterials')}</p>
                        )}
                      </div>
                      <div>
                        <label className="field-label">
                          {unit
                            ? t('inventory.recipes.add.qty.labelUnit', { target: v.unit, unit })
                            : t('inventory.recipes.add.qty.label', { target: v.unit })}
                        </label>
                        <input required type="number" min="0.001" step="any" className="input"
                               placeholder="4" value={qty}
                               onChange={(e) => setQty(e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <button className="btn-primary"
                                disabled={busy !== null || !materialId || !qty}>
                          {t('inventory.recipes.add.submit')}
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

      <p className="field-hint">{t('inventory.recipes.hint')}</p>

      {!canWrite && (
        <p className="field-hint">{t('inventory.recipes.readonly')}</p>
      )}
    </div>
  )
}
