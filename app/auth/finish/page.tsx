'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureConsent } from '@/lib/consent'
import { nextRoute } from '@/lib/where'

// Завершение входа через провайдера в ВЕБЕ (в приложении этим
// занимается components/deep-link — там код приезжает ссылкой схемы).
//
// Обмен делается на клиенте сознательно: PKCE-верификатор Supabase
// кладёт в куки браузера при нажатии кнопки, и код, обменянный
// где-то ещё, просто не сойдётся.
export default function AuthFinishPage() {
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    const code = params.get('code')

    if (err) { setError(err); return }
    if (!code) { setError('Код входу не отримано'); return }

    const supabase = createClient()
    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) { setError(error.message); return }
      await ensureConsent(supabase)
      window.location.replace(params.get('next') || (await nextRoute(supabase)))
    })()
  }, [])

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      {error ? (
        <>
          <h1 className="display t-2xl">Вхід не завершився</h1>
          <p className="t-md mt-3" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
            {error}
          </p>
          <a href="/login" className="btn-primary mt-7 flex items-center justify-center"
             style={{ height: 52, fontSize: 16, paddingInline: 28 }}>
            Спробувати ще раз
          </a>
        </>
      ) : (
        <p className="t-md" style={{ color: 'var(--color-muted)' }}>Заходимо…</p>
      )}
    </main>
  )
}
