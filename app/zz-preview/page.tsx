// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ.
//
// Экраны кабинета живут за входом, а сеть контейнера закрыта политикой
// окружения — открыть бой из сессии агента нельзя. Без этой страницы
// сверка с макетом сводится к чтению чисел из README, и именно так
// в продукт уже уехали расхождения, которые владелец увидел глазами.
//
// Здесь клиентские компоненты экранов рисуются с данными ИЗ ПРОТОТИПА
// (6 позиций реестра, услуги, записи дня — те же, что в хендоффе),
// чтобы кадр был сопоставим с эталоном пиксель в пиксель.
//
// Удаляется до коммита. Проверка: `git status` не должен показывать
// app/zz-preview.
'use client'

import { useState } from 'react'
import { InventoryClient } from '../app/inventory/inventory-client'

const MATERIALS = [
  {
    id: 'm1', name: "L'Oréal Professionnel Absolut Repair Mask", unit: 'шт',
    stock: 15, threshold: 3, cosmetic: true, pao: 12,
    brand: "L'Oréal Professionnel", sku: 'E3567800', batch: '62XS03',
    expiry: '2027-05-20', imagePath: null,
  },
  {
    id: 'm2', name: 'K18 Leave-In Molecular Repair', unit: 'шт',
    stock: 8, threshold: 2, cosmetic: true, pao: 12,
    brand: 'K18', sku: 'K18-LV-05', batch: '31A204',
    expiry: '2027-08-15', imagePath: null,
  },
  {
    id: 'm3', name: 'Olaplex No.5 Bond Maintenance', unit: 'шт',
    stock: 2, threshold: 3, cosmetic: true, pao: 12,
    brand: 'Olaplex', sku: 'OL-5-250', batch: 'A9876',
    expiry: '2026-09-05', imagePath: null,
  },
  {
    id: 'm4', name: 'Дезрозчин 2% для інструментів', unit: 'л',
    stock: 3, threshold: 1, cosmetic: false, pao: null,
    brand: 'АХД 2000 експрес', sku: 'DR-2000', batch: 'DR-25-05',
    expiry: '2026-05-25', imagePath: null,
  },
  {
    id: 'm5', name: 'Канекалон X-Pression, чорний', unit: 'пак',
    stock: 40, threshold: 10, cosmetic: false, pao: null,
    brand: 'X-Pression', sku: 'KN-BLK-100', batch: 'KN-0525',
    expiry: '2027-03-01', imagePath: null,
  },
  {
    id: 'm6', name: 'Рукавички нітрилові чорні (M)', unit: 'пар',
    stock: 50, threshold: 10, cosmetic: false, pao: null,
    brand: 'Medical Standard', sku: 'GL-M-0524', batch: 'GL-M-0524',
    expiry: '2027-05-30', imagePath: null,
  },
]

const CONTAINERS = [
  {
    id: 'c1', code: 'QR-25-05-001', status: 'open', useBy: '2026-05-09',
    openedAt: '2025-05-09', volume: 100, unit: 'мл',
    material: "L'Oréal Professionnel Absolut Repair Mask", materialId: 'm1',
  },
  {
    id: 'c2', code: 'QR-25-05-002', status: 'open', useBy: '2026-05-02',
    openedAt: '2025-05-02', volume: 50, unit: 'мл',
    material: 'Olaplex No.5 Bond Maintenance', materialId: 'm3',
  },
]

const MOVEMENTS = [
  { id: 'v1', type: 'receipt', qty: 20, unit: 'шт', title: 'K18 Leave-In', createdAt: '2026-08-18T10:15:00Z' },
  { id: 'v2', type: 'write_off', qty: 2, unit: 'л', title: 'Дезрозчин 2%', createdAt: '2026-08-18T09:02:00Z' },
  { id: 'v3', type: 'sale', qty: 1, unit: 'шт', title: 'Olaplex No.5', createdAt: '2026-08-17T16:40:00Z' },
]

const SCREENS = ['inventory'] as const

export default function PreviewPage() {
  const [screen] = useState<(typeof SCREENS)[number]>('inventory')

  if (screen === 'inventory') {
    return (
      <div id="page">
        <InventoryClient
          initialScan={false}
          tenantId="aaaaaaaa-0000-0000-0000-000000000001"
          userId="11111111-1111-1111-1111-111111111111"
          containers={CONTAINERS}
          materials={MATERIALS}
          variants={[]}
          totals={{ units: 118, cost: 24500, retail: 41000 }}
          suppliers={[{ id: 's1', name: 'Beauty Trade' }]}
          locations={[{ id: 'l1', name: 'Основний склад' }]}
          batches={[]}
          movements={MOVEMENTS}
        />
      </div>
    )
  }
  return null
}
