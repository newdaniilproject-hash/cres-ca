'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Принять приглашение и войти в заведение.
//
// ⚠️ После успеха — window.location, а не router.push. Права живут
// в токене (правило 3), и токен на руках у браузера ещё СТАРЫЙ: в нём
// нового заведения нет. Мягкий переход показал бы кабинет без единого
// раздела — человек решил бы, что приглашение не сработало. Поэтому
// сначала обновляем сессию, потом жёсткая перезагрузка.
export function AcceptClient({ token, email }: { token: string; email: string }) {
  const supabase = createClient()
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState('')

  async function accept() {
    setState('busy'); setError('')
    const { error } = await supabase.rpc('accept_invitation', { p_token: token })
    if (error) { setState('error'); setError(error.message); return }

    await supabase.auth.refreshSession()
    window.location.href = '/app'
  }

  return (
    <div className="card flex flex-col gap-4">
      <h1 className="display t-2xl">Вас запросили в команду</h1>
      <p className="t-md prose-muted">
        Ви увійшли як <b>{email}</b>. Запрошення спрацює лише якщо його
        виписано саме на цю пошту.
      </p>

      {state === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="field-error">{error}</p>
          <p className="t-sm prose-muted">
            Найчастіші причини: посилання вже використали, минуло 72 години
            або воно виписане на іншу пошту. Попросіть надіслати нове.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary"
                disabled={state === 'busy'} onClick={accept}>
          {state === 'busy' ? 'Приймаємо…' : 'Прийняти запрошення'}
        </button>
        <Link className="btn-secondary" href="/app">Не зараз</Link>
      </div>
    </div>
  )
}
