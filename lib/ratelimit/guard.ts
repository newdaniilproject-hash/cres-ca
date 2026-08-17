'use server'

import { headers } from 'next/headers'
import { getT } from '@/lib/i18n/server'
import { checkScope, type GuardResult } from './check'
import { waitText } from './deny'
import type { Scope } from './rules'

// Ограничитель для того, что уходит МИМО нашего сервера.
//
// ── Зачем это вообще нужно ─────────────────────────────────────────────────
//
// Вход, регистрация, восстановление пароля и создание записи выполняются
// клиентским кодом: форма зовёт `supabase.auth.signInWithOtp(...)` или
// `supabase.rpc('create_booking', ...)` НАПРЯМУЮ в Supabase. Такой запрос
// не проходит ни через Cloudflare, ни через Vercel — в `proxy.ts` его нет
// и быть не может. Три из пяти строк таблицы пределов при клиентском входе
// не применимы в принципе.
//
// Эти действия — серверные, они выполняются на нашей стороне, видят настоящий
// адрес и тратят тот же счётчик, что и всё остальное. Форма зовёт их ПЕРЕД
// обращением к Supabase и, получив отказ, к Supabase не идёт.
//
// ── ⚠️ ЧЕГО ЭТО НЕ ДАЁТ ────────────────────────────────────────────────────
//
// Это ограничение НАШЕЙ ФОРМЫ, а не ограничение входа. Тот, кто откроет
// консоль браузера и позовёт Supabase сам, не встретит здесь ничего: наш
// вызов делает форма, а не Supabase. Проверять это на стороне Supabase —
// единственный способ ограничить по-настоящему, и делается это ДВУМЯ
// местами, ни одно из которых не в этом файле:
//
//   • Supabase → Authentication → Rate Limits: свои пределы на отправку
//     писем, проверку кодов и регистрации, по адресу. Настраивается руками
//     в панели, миграцией не делается — как и хук токена;
//   • внутри `create_booking` и `create_order`: проверка счётчика прямо
//     в функции, которую браузер и так вызывает. Это ноль лишних обращений
//     к базе (в отличие от проверки в `proxy.ts`, см. `store.ts`) и
//     единственная точка, мимо которой запись не создать. Нужна миграция —
//     её пишет агент, отвечающий за SQL; что именно нужно, названо в отчёте
//     по шагу 6.
//
// То, что этот файл всё-таки даёт: долбёжку кнопкой и простой скрипт,
// работающий через нашу страницу, он останавливает, и человек при этом
// видит понятный текст со временем повтора, а не молчащую форму.

async function run(scope: Scope): Promise<GuardResult> {
  const denial = checkScope(await headers(), scope)
  if (!denial) return { ok: true }

  const t = await getT()
  const wait = waitText(t, denial.retryAfter)
  const message = scope === 'signup'
    ? t('limit.signup.desc', { wait })
    : scope === 'order'
      ? t('limit.order.desc', { wait })
      : t('limit.signin.desc', { wait })

  return { ok: false, retryAfter: denial.retryAfter, message }
}

/** Вход и восстановление пароля: 5 за 15 хвилин с адреса. */
export async function guardSignIn(): Promise<GuardResult> {
  return run('signin')
}

/** Регистрация: 3 за годину с адреса. */
export async function guardSignUp(): Promise<GuardResult> {
  return run('signup')
}

/** Оформление заказа и запись: 10 за годину с адреса. */
export async function guardOrder(): Promise<GuardResult> {
  return run('order')
}
