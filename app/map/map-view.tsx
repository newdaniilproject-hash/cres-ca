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

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:34px;height:34px;border-radius:50% 50% 50% 4px;
          transform:rotate(-45deg);
          background:#22443a;border:2.5px solid #faf8f5;
          box-shadow:0 4px 12px rgb(28 26 23 / .35);
          display:flex;align-items:center;justify-content:center;">
          <span style="transform:rotate(45deg);color:#f6f4ef;font-size:13px">●</span>
        </div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 30],
      })

      for (const p of points) {
        L.marker([p.lat, p.lng], { icon })
          .addTo(map!)
          .bindPopup(
            `<div style="font-family:inherit;min-width:180px">
               <strong style="font-size:14px">${p.name}</strong><br/>
               <span style="color:#766f64;font-size:12px">
                 ${p.tagline ?? ''}${p.address ? `<br/>${p.address}` : ''}
               </span><br/>
               <a href="/t/${p.slug}" style="
                 display:inline-block;margin-top:8px;padding:6px 12px;
                 background:#22443a;color:#f6f4ef;border-radius:8px;
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
          <div className="card text-center text-sm rise">
            Заклади з адресою з’являться тут — платформа щойно відкривається.
          </div>
        </div>
      )}
    </div>
  )
}
