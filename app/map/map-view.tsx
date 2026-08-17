'use client'

import { useEffect, useRef } from 'react'
import { useT } from '@/lib/i18n/client'

type Point = {
  slug: string; name: string; tagline: string | null
  city: string | null; address: string | null
  lat: number; lng: number; kind: string
}

// Содержимое всплывающего окна метки.
//
// Собирается узлами, а не строкой HTML, и это принципиально: `name`,
// `tagline`, `address` и `slug` пишет сам продавец в настройках заклада,
// а страница публичная и индексируется. При сборке строкой любая из этих
// подстановок — внедрение разметки и скрипта на страницу платформы, и
// достаточно один раз забыть экранирование в будущей правке, чтобы дыра
// вернулась. Через `textContent` и `setAttribute` экранирование делает сам
// разбор документа, забыть его нельзя.
//
// Внутри всплывающего окна leaflet рисует свой фон, поэтому текст берёт
// его цвет, а приглушение даётся прозрачностью, а не цветовой переменной
// интерфейса — она рассчитана на наши поверхности и на чужой оказалась бы
// нечитаемой.
function popupContent(p: Point, openLabel: string): HTMLElement {
  const box = document.createElement('div')
  box.setAttribute('style', 'font-family:inherit;min-width:180px')

  const name = document.createElement('strong')
  name.setAttribute('style', 'font-size:14px')
  name.textContent = p.name
  box.append(name, document.createElement('br'))

  const sub = document.createElement('span')
  sub.setAttribute('style', 'opacity:.68;font-size:12px')
  sub.textContent = p.tagline ?? ''
  if (p.address) {
    sub.append(document.createElement('br'))
    sub.append(document.createTextNode(p.address))
  }
  box.append(sub, document.createElement('br'))

  // Схема адреса задана здесь и не берётся из данных, поэтому `javascript:`
  // подставить нельзя; `encodeURIComponent` закрывает выход из сегмента пути.
  const link = document.createElement('a')
  // ?from=map — атрибуция (0105): переход із мітки на мапі, а не за
  // власним посиланням продавця.
  link.setAttribute('href', `/t/${encodeURIComponent(p.slug)}?from=map`)
  link.setAttribute(
    'style',
    'display:inline-block;margin-top:8px;padding:8px 12px;' +
      'background:var(--color-accent);color:var(--color-accent-text);' +
      'border-radius:var(--radius-control);' +
      'font-size:12px;text-decoration:none',
  )
  link.textContent = openLabel
  box.append(link)

  return box
}

// Leaflet + OpenStreetMap: без ключей и без платных лимитов.
// Грузится только на клиенте и только на этой странице.
export function MapView({ points }: { points: Point[] }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const inited = useRef(false)

  useEffect(() => {
    if (!ref.current || inited.current) return
    inited.current = true

    let map: import('leaflet').Map | undefined

    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')

      // Центр: по точкам, иначе — центр Украины.
      const center: [number, number] = points.length
        ? [points.reduce((s, p) => s + p.lat, 0) / points.length,
           points.reduce((s, p) => s + p.lng, 0) / points.length]
        : [49.0, 31.4]

      map = L.map(ref.current!, { zoomControl: false })
        .setView(center, points.length ? 12 : 6)
      L.control.zoom({ position: 'bottomright' }).addTo(map)

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Цвета берутся переменными системы: разметка вставляется в документ,
      // поэтому var() здесь разрешается так же, как в обычном компоненте.
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:34px;height:34px;border-radius:50% 50% 50% 4px;
          transform:rotate(-45deg);
          background:var(--color-accent);border:2.5px solid var(--color-bg);
          box-shadow:var(--shadow-card);
          display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);color:var(--color-accent-text);font-size:13px">●</span>
        </div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 30],
      })

      // Название, подзаголовок и адрес заведения — данные продавца:
      // не переводятся. В словарь уехала только надпись на кнопке.
      const openLabel = t('public.map.popup.open')

      for (const p of points) {
        L.marker([p.lat, p.lng], { icon })
          .addTo(map!)
          // Содержимое строится по открытию, а не сразу: на карте бывают
          // сотни закладов, и собирать узлы для всех при загрузке значило
          // бы платить за то, что человек почти наверняка не откроет.
          .bindPopup(() => popupContent(p, openLabel))
      }
    })()

    return () => { map?.remove(); inited.current = false }
  }, [points, t])

  return (
    <div className="relative h-full">
      <div ref={ref} className="h-full w-full" />
      {points.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-[500] mx-auto max-w-sm px-4">
          <div className="card t-md text-center rise">{t('public.map.empty')}</div>
        </div>
      )}
    </div>
  )
}
