'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureConsent } from '@/lib/consent'
import { nextRoute, type Surface } from '@/lib/where'
import { authErrorText } from '@/app/(auth)/google-button'

// Завершение входа через провайдера.
//
// Обмен делается на клиенте сознательно: PKCE-верификатор Supabase
// кладёт в куки браузера при нажатии кнопки, и код, обменянный
// где-то ещё, просто не сойдётся.
export default function AuthFinishPage() {
  const [error, setError] = useState('')
  // Сырой текст — Supabase иногда отвечает служебным кодом ошибки,
  // а не фразой. Технические детали ниже, мелким шрифтом, а не вместо
  // человеческого объяснения.
  const [raw, setRaw] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    const code = params.get('code')

    // ⚠️ Голого текста от Supabase здесь показывать нельзя (12.08.2026):
    // при невключённом провайдере первым экраном человек видит не эту
    // страницу, а сырой JSON {"code":400,...} — сам Supabase отдаёт его
    // при переходе на /auth/v1/authorize, ДО всякого возврата на наш
    // сайт, и перехватить это на клиенте нечем: signInWithOAuth только
    // строит ссылку (см. lib/oauth.ts, google-button.tsx). Здесь чинится
    // только то, что действительно доезжает сюда параметром в адресе.
    if (err) { setError(authErrorText(err)); setRaw(err); return }
    if (!code) { setError('Код входу не отримано'); return }

    const supabase = createClient()
    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) { setError(authErrorText(error.message)); setRaw(error.message); return }
      await ensureConsent(supabase)
      // Шёл на конкретную страницу — туда и ведём (контракт next).
      // Не шёл — решает lib/where.ts, но адреса у поверхностей разные,
      // поэтому её проносит сюда параметр s (по умолчанию — приложение,
      // как было до появления этого экрана в вебе).
      const surface: Surface = params.get('s') === 'web' ? 'web' : 'm'
      window.location.replace(params.get('next') || (await nextRoute(supabase, surface)))
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
            Спробувати іншим способом
          </a>
          {raw && (
            <p className="t-xs mt-4" style={{ color: 'var(--color-faint)' }}>{raw}</p>
          )}
        </>
      ) : (
        <p className="t-md" style={{ color: 'var(--color-muted)' }}>Заходимо…</p>
      )}
    </main>
  )
}
