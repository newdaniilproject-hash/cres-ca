'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { IconBox, IconClose } from '@/components/icons'

// ── Рецептура НА КАРТОЧКЕ УСЛУГИ ────────────────────────────────────────────
//
// Требование владельца 19.08.2026: «Он открывает услугу и прикрепляет
// расходник, определяет, сколько уходит на услугу расходника. И всё
// считывается, а потом сколько услуг было проведено, сколько расходников
// было истрачено».
//
// ЧТО УЖЕ БЫЛО И ПОЧЕМУ ИМ НЕ ПОЛЬЗОВАЛИСЬ. Таблица `variant_materials`
// и списание по ней есть с 0003: `set_booking_status` при переводе записи
// в «виконано» сам зовёт `consume_materials_for_variant`, и расход ложится
// в журнал движений обычным списанием. Механизм рабочий и проверен тестом.
//
// Но ЗАВЕСТИ рецепт можно было только на отдельном экране склада
// (`/app/inventory/recipes`), то есть в другом разделе и через два перехода
// от услуги. На боевой базе рецептов ровно НОЛЬ — механизм есть, им никто
// не воспользовался. Это ровно тот случай, когда функция существует
// и не существует одновременно.
//
// Поэтому рецепт заводится ЗДЕСЬ, на карточке услуги, рядом с ценой
// и длительностью: человек описывает услугу целиком в одном месте.
// Экран склада при этом остаётся — он даёт обратный взгляд («куда уходит
// этот засіб»), и это другой вопрос, а не дубль.

export type RecipeMaterial = { id: string; name: string; unit: string }
export type RecipeLine = {
  variantId: string
  materialId: string
  quantityPerUnit: number
}

export function RecipeBlock({
  variants, materials, lines, canWrite, doneByVariant, usedByMaterial,
}: {
  /** Варианты услуги: у каждой свой рецепт. */
  variants: { id: string; name: string }[]
  materials: RecipeMaterial[]
  lines: RecipeLine[]
  /**
   * `catalog.write` — не `stock.write`: политики `variant_materials`
   * (0075) стоят на правах КАТАЛОГА, потому что рецепт принадлежит
   * услуге. Без него рецепт только читается.
   */
  canWrite: boolean
  /** Сколько раз услугу провели — по вариантам. */
  doneByVariant: Record<string, number>
  /**
   * Сколько ФАКТИЧЕСКИ израсходовано — по расходникам, из журнала
   * движений. Не рецепт × число визитов: журнал единственный источник
   * правды об остатке, а рецепт мог меняться между визитами.
   */
  usedByMaterial: Record<string, number>
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [qty, setQty] = useState<Record<string, string>>({})

  const nameOf = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  )

  async function add(variantId: string) {
    const materialId = pick[variantId] ?? ''
    const amount = Number((qty[variantId] ?? '').replace(',', '.'))
    if (!materialId || !(amount > 0)) return
    setBusy(variantId); setErr('')
    const { error } = await supabase.from('variant_materials').insert({
      variant_id: variantId, material_id: materialId, quantity_per_unit: amount,
    })
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    setPick({ ...pick, [variantId]: '' })
    setQty({ ...qty, [variantId]: '' })
    router.refresh()
  }

  async function drop(l: RecipeLine) {
    setBusy(l.materialId); setErr('')
    // Первичный ключ — пара «вариант × расходник», другого идентификатора
    // у строки нет.
    const { error } = await supabase.from('variant_materials')
      .delete()
      .eq('variant_id', l.variantId)
      .eq('material_id', l.materialId)
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    router.refresh()
  }

  return (
    <section className="rise-3">
      <p className="eyebrow mb-2">{t('catalog.recipe.title')}</p>
      <p className="field-hint mb-3">{t('catalog.recipe.hint')}</p>

      {err && <p className="field-error mb-2">{err}</p>}

      {materials.length === 0 ? (
        <div className="card">
          <div className="empty !py-6">
            <span className="empty-icon"><IconBox size={24} /></span>
            <p className="empty-title">{t('catalog.recipe.noMaterials')}</p>
            <p className="empty-desc">{t('catalog.recipe.noMaterialsDesc')}</p>
            <div className="empty-actions">
              <Link href="/app/inventory" className="btn-secondary">
                {t('catalog.recipe.toStock')}
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {variants.map((v) => {
            const own = lines.filter((l) => l.variantId === v.id)
            return (
              <div key={v.id} className="card !p-0">
                {/* Имя варианта — данные заведения, не переводится. */}
                <div className="flex items-center justify-between gap-2 px-4 pt-3">
                  <p className="t-md min-w-0 truncate">{v.name}</p>
                  {(doneByVariant[v.id] ?? 0) > 0 && (
                    <span className="badge tabular shrink-0">
                      {t('catalog.recipe.done', { n: t.number(doneByVariant[v.id]) })}
                    </span>
                  )}
                </div>

                {own.length === 0 ? (
                  <p className="field-hint px-4 pb-2">{t('catalog.recipe.empty')}</p>
                ) : (
                  <div className="flex flex-col px-4">
                    {own.map((l) => {
                      const mat = nameOf.get(l.materialId)
                      return (
                        <div key={l.materialId} className="row">
                          <span className="min-w-0 flex-1 t-md truncate">
                            {mat?.name ?? l.materialId}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="tabular t-md block">
                              {t.number(l.quantityPerUnit)} {mat?.unit ?? ''}
                            </span>
                            {/* Факт из журнала, а не прикидка. Показывается
                                только когда что-то уже списывалось: ноль
                                рядом с нормой расхода читается как ошибка. */}
                            {(usedByMaterial[l.materialId] ?? 0) > 0 && (
                              <span className="tabular t-xs block prose-muted">
                                {t('catalog.recipe.used', {
                                  n: t.number(usedByMaterial[l.materialId]),
                                  unit: mat?.unit ?? '',
                                })}
                              </span>
                            )}
                          </span>
                          {canWrite && (
                            <button type="button" className="btn-icon shrink-0"
                                    aria-label={t('common.delete')}
                                    disabled={busy === l.materialId}
                                    onClick={() => void drop(l)}>
                              <IconClose size={18} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2 border-t px-4 py-3"
                       style={{ borderColor: 'var(--color-border)' }}>
                    <div className="min-w-40 flex-1">
                      <label className="field-label">{t('catalog.recipe.material')}</label>
                      <select className="select" value={pick[v.id] ?? ''}
                              onChange={(e) => setPick({ ...pick, [v.id]: e.target.value })}>
                        <option value="">{t('catalog.recipe.choose')}</option>
                        {/* Уже добавленные не предлагаем: пара «вариант ×
                            расходник» уникальна, и вторая попытка упёрлась бы
                            в отказ базы вместо понятного «уже есть». */}
                        {materials
                          .filter((mm) => !own.some((l) => l.materialId === mm.id))
                          .map((mm) => (
                            <option key={mm.id} value={mm.id}>{mm.name} · {mm.unit}</option>
                          ))}
                      </select>
                    </div>
                    <div style={{ width: 120 }}>
                      <label className="field-label">{t('catalog.recipe.qty')}</label>
                      <input className="input" inputMode="decimal"
                             placeholder="0"
                             value={qty[v.id] ?? ''}
                             onChange={(e) => setQty({ ...qty, [v.id]: e.target.value })} />
                    </div>
                    <button type="button" className="btn-secondary shrink-0"
                            disabled={busy === v.id || !(pick[v.id] ?? '')
                              || !(Number((qty[v.id] ?? '').replace(',', '.')) > 0)}
                            onClick={() => void add(v.id)}>
                      {t('catalog.recipe.add')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
