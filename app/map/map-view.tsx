'use client'

import { useEffect, useRef } from 'react'

type Point = {
  slug: string; name: string; tagline: string | null
  city: string | null; address: string | null
  lat: number; lng: number; kind: string
}

// Leaflet + OpenStreetMap: без ключей и без платных лимитов.
// Грузится только на клиенте и только на этой странице.
export function MapView({ points }: { points: Point[] }) {
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

      for (const p of points) {
        L.marker([p.lat, p.lng], { icon })
          .addTo(map!)
          .bindPopup(
            // Внутри всплывающего окна leaflet рисует свой фон, поэтому
            // текст берёт его цвет, а приглушение даётся прозрачностью,
            // а не цветовой переменной интерфейса — она рассчитана на
            // наши поверхности и на чужой оказалась бы нечитаемой.
            `<div style="font-family:inherit;min-width:180px">
               <strong style="font-size:14px">${p.name}</strong><br/>
               <span style="opacity:.68;font-size:12px">
                 ${p.tagline ?? ''}${p.address ? `<br/>${p.address}` : ''}
               </span><br/>
               <a href="/t/${p.slug}" style="
                 display:inline-block;margin-top:8px;padding:8px 12px;
                 background:var(--color-accent);color:var(--color-accent-text);
                 border-radius:var(--radius-control);
                 font-size:12px;text-decoration:none">Відкрити сторінку</a>
             </div>`,
          )
      }
    })()

    return () => { map?.remove(); inited.current = false }
  }, [points])

  return (
    <div className="relative h-full">
      <div ref={ref} className="h-full w-full" />
      {points.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-[500] mx-auto max-w-sm px-4">
          <div className="card t-md text-center rise">
            Заклади з адресою з’являться тут — платформа щойно відкривається.
          </div>
        </div>
      )}
    </div>
  )
}
