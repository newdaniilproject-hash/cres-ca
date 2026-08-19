// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ.
// Разбор — в шапке `app/zz-preview/page.tsx`. Данные — из хендоффа
// CRESKO, раздел E «Послуги», дословно.
'use client'

import { CatalogClient, type CatalogItem } from '../../app/catalog/catalog-client'

const S = (
  id: string, title: string, minutes: number, price: number, materials: number,
  status = 'active',
): CatalogItem => ({
  id, kind: 'service', status, title, subtitle: null, slug: id,
  listed: true, currency: 'UAH', price, durationMinutes: minutes,
  variants: 1, cover: null, category: null, stock: null, materials,
})

const ITEMS: CatalogItem[] = [
  S('s1', 'Ламінування брів', 60, 700, 4),
  S('s2', 'Манікюр + покриття', 90, 850, 8),
  S('s3', 'Педикюр апаратний', 75, 900, 6),
  S('s4', 'Нарощування вій', 120, 1200, 10),
  // «Акція» в макете — жёлтый бейдж. Акций в продукте нет (модуль
  // `marketing` пуст), поэтому жёлтый бейдж здесь означает то, что
  // он означает в продукте: чернетку.
  S('s5', 'Депіляція воском', 45, 500, 3, 'draft'),
  S('s6', 'Чистка обличчя', 60, 800, 5),
]

export default function ServicesPreview() {
  return (
    <div id="page">
      <div className="px-4 py-4">
        <CatalogClient items={ITEMS} error={null} canWrite hasStorefront />
      </div>
    </div>
  )
}
