'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { captureAttribution } from '@/lib/attribution'

// Читает `?from=` из адреса и запоминает его для заведения — та самая
// ссылка вида `cres-ca.com/t/<slug>?from=ig` из шапки Instagram (0105).
//
// `useSearchParams` обязан жить под `Suspense`, иначе статическая сборка
// падает — тот же приём, что в `components/app-shell.tsx`.
function Capture({ tenantId }: { tenantId: string }) {
  const params = useSearchParams()
  useEffect(() => {
    captureAttribution(tenantId, params.get('from'))
    // Строка адреса не меняется без перехода — зависимость от `tenantId`
    // и `params` достаточна, повторный вызов на каждый рендер не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, params])
  return null
}

/** Ничего не рисует — только запоминает источник перехода. */
export function AttributionCapture({ tenantId }: { tenantId: string }) {
  return (
    <Suspense fallback={null}>
      <Capture tenantId={tenantId} />
    </Suspense>
  )
}
