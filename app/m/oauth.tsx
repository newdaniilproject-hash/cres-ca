'use client'

import Link from 'next/link'
import { useState } from 'react'
import { signInWithProvider, type OAuthProvider } from '@/lib/oauth'
import { LEGAL_DOCS } from '@/lib/legal'

// Кнопки входа через Apple и Google.
//
// Один компонент на вход и на регистрацию: у провайдера нет разницы
// между «войти» и «зарегистрироваться» — акаунт создаётся сам, если
// его не было. Разводить два вида кнопок значило бы обещать разницу,
// которой нет.
//
// Apple первой и не мельче Google — это требование App Store Review
// (пункт 4.8), а не вкусовщина: приложение с одним лишь Google
// отклоняют.
export function OAuthButtons({
  hint = 'або',
  sep = 'above',
  legal = false,
  disabled = false,
}: {
  hint?: string
  /** Где рисовать разделитель «або» — над кнопками или под ними. */
  sep?: 'above' | 'below'
  /** Показать, на что человек соглашается. Обязательно там, где
   *  кнопка провайдера создаёт акаунт: галочки согласия он не видит,
   *  а согласие в журнал всё равно уйдёт. */
  legal?: boolean
  disabled?: boolean
}) {
  const [busy, setBusy] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState('')

  async function run(p: OAuthProvider) {
    setBusy(p); setError('')
    try {
      await signInWithProvider(p)
      // Окно провайдера открылось — приложение ждёт возврата
      // по ссылке. Кнопку не разблокируем: второй тап откроет
      // второе окно и запутает вход.
    } catch (e) {
      setBusy(null)
      setError(e instanceof Error ? e.message : 'Не вдалося відкрити вхід')
    }
  }

  const line = (
    <div className={sep === 'below' ? 'oauth-sep below' : 'oauth-sep'}>
      <span>{hint}</span>
    </div>
  )

  return (
    <div className="oauth">
      {sep === 'above' && line}

      <button
        type="button"
        className="btn-apple"
        disabled={disabled || busy !== null}
        onClick={() => void run('apple')}
      >
        <AppleMark />
        <span>{busy === 'apple' ? 'Відкриваємо…' : 'Продовжити з Apple'}</span>
      </button>

      <button
        type="button"
        className="btn-google"
        disabled={disabled || busy !== null}
        onClick={() => void run('google')}
      >
        <GoogleMark />
        <span>{busy === 'google' ? 'Відкриваємо…' : 'Продовжити з Google'}</span>
      </button>

      {error && <p className="field-error">{error}</p>}

      {legal && (
        <p className="t-xs mt-1" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          Продовжуючи, ви приймаєте{' '}
          {LEGAL_DOCS.map((d, i) => (
            <span key={d.href}>
              <Link href={d.href} className="underline underline-offset-2"
                    style={{ color: 'var(--color-muted)' }}>
                {d.label}
              </Link>
              {i < LEGAL_DOCS.length - 2 ? ', ' : i === LEGAL_DOCS.length - 2 ? ' та ' : ''}
            </span>
          ))}
          .
        </p>
      )}

      {sep === 'below' && line}
    </div>
  )
}

// Знаки нарисованы путями, а не картинками: файл — это ещё один
// запрос и ещё одно место, где что-то может не загрузиться, а знак,
// не загрузившийся на кнопке входа, читается как сломанный вход.
function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.36 12.72c.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.18-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.05 1.52-.71 2.86-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.54ZM14.2 5.98c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.97-.49 2.58-1.23Z" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.87-3c-1.07.72-2.44 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.96h-4v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1h-4a12 12 0 0 0 0 10.76l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.87 8.87 4.75 12 4.75Z" />
    </svg>
  )
}
