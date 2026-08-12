'use client'

// ⚠️ ВРЕМЕННЫЙ ДИАГНОСТИЧЕСКИЙ МАЯЧОК. УДАЛИТЬ ПОСЛЕ РАЗБОРА.
// Заведён 12.08.2026 вместе с components/ping.ts.

import { useEffect } from 'react'

type PingWindow = Window & {
  __ping?: (stage: string, extra?: Record<string, unknown>) => void
}

/**
 * Ступень 3 — `mounted`. Значит: React смонтировался и гидратация
 * прошла. Если в логах есть `boot`, но нет `mounted` — обрыв между
 * разбором разметки и оживанием React.
 *
 * Ничего не рисует и ни на что не влияет.
 */
export function PingMounted() {
  useEffect(() => {
    ;(window as PingWindow).__ping?.('mounted')
  }, [])

  return null
}
