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

// Ответы `accept_invitation` — это сообщения БАЗЫ: они рассказывают,
// что не так с записью («не існує, вже використане, відкликане,
// протерміноване або виписане на іншу пошту»), а человеку нужно знать,
// что делать дальше. Приём тот же, что в lib/auth-errors.ts: узкий
// словарь по подстроке, на выходе — фраза с действием.
//
// Словарь живёт здесь, а не в общем файле: `accept_invitation` зовёт
// один этот экран, и класть его в lib/auth-errors.ts значило бы тащить
// в словарь входа то, к чему вход отношения не имеет.
//
// `action` решает, какую кнопку показать: одного текста мало —
// «попросіть нове запрошення» без кнопки «увійти іншою поштою»
// оставляет человека на странице, с которой некуда идти.
type Verdict = { text: string; action: 'app' | 'relogin' | 'retry' }

function acceptVerdict(raw: string): Verdict {
  const m = raw.toLowerCase()

  // Членство уже есть: приняли во второй вкладке, или владелец добавил
  // руками. Ошибка базы здесь не ошибка человека — ему просто в кабинет.
  if (m.includes('вже учасник')) return {
    text: 'Ви вже працюєте в цьому закладі — приймати запрошення вдруге не потрібно. '
        + 'Відкрийте кабінет, розділи вже доступні.',
    action: 'app',
  }

  // Сеанс истёк, пока человек читал письмо.
  if (m.includes('не автентифіковано') || m.includes('jwt') || m.includes('session')) return {
    text: 'Сеанс завершився, поки ви читали лист. Увійдіть ще раз тією ж поштою — '
        + 'ми повернемо вас на цю сторінку.',
    action: 'relogin',
  }

  // Одна фраза базы на четыре разных случая (использовано, отозвано,
  // просрочено, чужая почта) — различить их нельзя и не нужно: ответ
  // человеку во всех четырёх один и тот же.
  if (m.includes('недійсне')) return {
    text: 'Це посилання більше не працює: його вже використали, минули 72 години '
        + 'або воно виписане на іншу пошту. Попросіть надіслати нове запрошення '
        + 'і приймайте його з тієї пошти, на яку прийшов лист.',
    action: 'relogin',
  }

  // Сеть или неизвестный ответ — единственный случай, где повтор осмыслен.
  return {
    text: 'Не вдалося прийняти запрошення — можливо, зник звʼязок. Спробуйте ще раз, '
        + 'а якщо не вийде, попросіть надіслати нове запрошення.',
    action: 'retry',
  }
}

export function AcceptClient({ token, email }: { token: string; email: string }) {
  const supabase = createClient()
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  async function accept() {
    setState('busy'); setVerdict(null)
    const { error } = await supabase.rpc('accept_invitation', { p_token: token })
    if (error) { setVerdict(acceptVerdict(error.message)); setState('error'); return }

    await supabase.auth.refreshSession()
    window.location.href = '/app'
  }

  // «Вже учасник» — тот же случай, что и успех: заведение в базе есть,
  // а в токене на руках его может не быть (правило 3). Поэтому не Link,
  // а обновление сессии и жёсткий переход, иначе кабинет откроется
  // без разделов.
  async function openApp() {
    setState('busy')
    await supabase.auth.refreshSession()
    window.location.href = '/app'
  }

  const showAccept = state !== 'error' || verdict?.action === 'retry'

  return (
    <div className="card flex flex-col gap-4">
      <h1 className="display t-2xl">Вас запросили в команду</h1>
      <p className="t-md prose-muted">
        Ви увійшли як <b>{email}</b>. Запрошення спрацює лише якщо його
        виписано саме на цю пошту.
      </p>

      {state === 'error' && verdict && <p className="field-error">{verdict.text}</p>}

      <div className="flex flex-wrap gap-2">
        {showAccept && (
          <button type="button" className="btn-primary"
                  disabled={state === 'busy'} onClick={accept}>
            {state === 'busy' ? 'Приймаємо…' : 'Прийняти запрошення'}
          </button>
        )}

        {verdict?.action === 'app' && (
          <button type="button" className="btn-primary"
                  disabled={state === 'busy'} onClick={openApp}>
            {state === 'busy' ? 'Відкриваємо…' : 'Відкрити кабінет'}
          </button>
        )}

        {verdict?.action === 'relogin' && (
          <Link className="btn-primary"
                href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            Увійти іншою поштою
          </Link>
        )}

        {verdict?.action !== 'app' && (
          <Link className="btn-secondary" href="/app">Не зараз</Link>
        )}
      </div>
    </div>
  )
}
