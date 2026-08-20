'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

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
//
// ⚠️ ПОДСТРОКИ РАЗБОРА НЕ ПЕРЕВОДЯТСЯ. `m.includes('вже учасник')` и
// соседние — это текст, которым отвечает САМА БАЗА; он написан
// по-украински в миграции и от языка интерфейса не зависит. Переведи
// их — и разбор перестанет срабатывать ни на одном языке, включая
// украинский. Переводится только ОТВЕТ человеку.
type Verdict = { text: string; action: 'app' | 'relogin' | 'retry' }

function acceptVerdict(t: T, raw: string): Verdict {
  const m = raw.toLowerCase()

  // Членство уже есть: приняли во второй вкладке, или владелец добавил
  // руками. Ошибка базы здесь не ошибка человека — ему просто в кабинет.
  if (m.includes('вже учасник')) return {
    text: t('invite.error.already'),
    action: 'app',
  }

  // Сеанс истёк, пока человек читал письмо.
  if (m.includes('не автентифіковано') || m.includes('jwt') || m.includes('session')) return {
    text: t('invite.error.session'),
    action: 'relogin',
  }

  // Одна фраза базы на четыре разных случая (использовано, отозвано,
  // просрочено, чужая почта) — различить их нельзя и не нужно: ответ
  // человеку во всех четырёх один и тот же.
  if (m.includes('недійсне')) return {
    text: t('invite.error.invalid'),
    action: 'relogin',
  }

  // Сеть или неизвестный ответ — единственный случай, где повтор осмыслен.
  return {
    text: t('invite.error.generic'),
    action: 'retry',
  }
}

export function AcceptClient({ token, email }: { token: string; email: string }) {
  const t = useT()
  const supabase = createClient()
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  async function accept() {
    setState('busy'); setVerdict(null)
    const { error } = await supabase.rpc('accept_invitation', { p_token: token })
    if (error) { setVerdict(acceptVerdict(t, error.message)); setState('error'); return }

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
      <h1 className="display t-2xl">{t('invite.title')}</h1>
      {/* Почта выделена жирным, поэтому предложение разбито на два
          ключа: разметки в словаре не бывает. Сама почта — данные. */}
      <p className="t-md prose-muted">
        {t('invite.signedAs.pre')} <b>{email}</b>{t('invite.signedAs.post')}
      </p>

      {state === 'error' && verdict && <p className="field-error">{verdict.text}</p>}

      {/* Кнопки столбцом и `btn-tall`, как на всех экранах входа.
          Рядом `flex-wrap` они на 390px переносились по одной и вставали
          разной ширины, а высота 44px расходилась с 52px соседних
          экранов того же потока. */}
      <div className="flex flex-col gap-2">
        {showAccept && (
          <button type="button" className="btn-primary btn-tall"
                  disabled={state === 'busy'} onClick={accept}>
            {state === 'busy' ? t('invite.accepting') : t('invite.accept')}
          </button>
        )}

        {verdict?.action === 'app' && (
          <button type="button" className="btn-primary btn-tall"
                  disabled={state === 'busy'} onClick={openApp}>
            {state === 'busy' ? t('invite.opening') : t('invite.openApp')}
          </button>
        )}

        {verdict?.action === 'relogin' && (
          <Link className="btn-primary btn-tall"
                href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            {t('invite.relogin')}
          </Link>
        )}

        {verdict?.action !== 'app' && (
          <Link className="btn-secondary btn-tall" href="/app">{t('invite.later')}</Link>
        )}
      </div>
    </div>
  )
}
