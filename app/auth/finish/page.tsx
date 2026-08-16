'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureConsent } from '@/lib/consent'
import { nextRoute } from '@/lib/where'
import { authErrorText } from '@/app/(auth)/google-button'
import { useT } from '@/lib/i18n/client'

// Завершение входа через провайдера.
//
// Обмен делается на клиенте сознательно: PKCE-верификатор Supabase
// кладёт в куки браузера при нажатии кнопки, и код, обменянный
// где-то ещё, просто не сойдётся.
export default function AuthFinishPage() {
  const t = useT()
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
    if (err) { setError(authErrorText(t, err)); setRaw(err); return }
    if (!code) { setError('Код входу не отримано'); return }

    const supabase = createClient()
    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) { setError(authErrorText(t, error.message)); setRaw(error.message); return }
      await ensureConsent(supabase)
      window.location.replace(params.get('next') || (await nextRoute(supabase)))
    })()
    // Обмен кода делается ОДИН раз на монтирование: повторный вызов
    // exchangeCodeForSession с уже использованным кодом отвечает отказом.
    // `t` из зависимостей исключён сознательно — он один на язык
    // (`createT` кэширует), и ссылка между отрисовками не меняется.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
