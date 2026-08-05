'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureConsent } from '@/lib/consent'
import { nextRoute } from '@/lib/where'
import { haptic } from '@/lib/haptic'

// Глубокие ссылки: единственная дверь в приложение снаружи.
//
// Через неё приходят три разных вещи, и обрабатывать их надо в одном
// месте, иначе они разъедутся:
//
//   cresca://auth?code=…            — возврат от Apple и Google
//   cresca://open?path=/app/orders  — тап по пушу и ссылки из писем
//   https://cres-ca.com/<путь>      — ссылка из инстаграма или мессенджера,
//                                     перехваченная App Links (Android)
//
// Две дороги внутрь, потому что мосты у платформ разные:
//   iOS     — плагин App даёт событие appUrlOpen (мост в веб-вью есть);
//   Android — моста в удалённый server.url нет вовсе (урок DaKi),
//             поэтому MainActivity кладёт ссылку в AndroidDeepLink
//             и стреляет событием cres:deeplink.
type NativeWindow = Window & {
  AndroidDeepLink?: { consume(): string }
  Capacitor?: {
    Plugins?: {
      Browser?: { close?: () => Promise<void> }
      App?: {
        addListener?: (
          name: string,
          cb: (d: { url?: string }) => void,
        ) => Promise<{ remove: () => void }>
        getLaunchUrl?: () => Promise<{ url?: string } | null>
      }
    }
  }
}

export function DeepLink() {
  useEffect(() => {
    let dead = false
    const w = window as unknown as NativeWindow

    async function closeBrowser() {
      // Системный браузер после возврата остаётся открытым поверх
      // приложения. На iOS его надо закрыть руками, иначе человек
      // видит пустую страницу, а не свой кабинет.
      try {
        await w.Capacitor?.Plugins?.Browser?.close?.()
      } catch { /* плагина может не быть — не повод падать */ }
    }

    function go(path: string) {
      if (!path.startsWith('/')) return
      // Уже здесь — не перезагружаем: моргание на ровном месте.
      if (path === window.location.pathname + window.location.search) return
      window.location.assign(path)
    }

    async function finishAuth(code: string, next: string) {
      const supabase = createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        go('/m/login?oauth=' + encodeURIComponent(error.message))
        return
      }
      await ensureConsent(supabase)
      haptic.success()
      go(next || (await nextRoute(supabase)))
    }

    async function handle(raw: string) {
      if (dead || !raw) return
      let u: URL
      try { u = new URL(raw) } catch { return }

      void closeBrowser()

      const scheme = u.protocol.replace(':', '')
      const path = u.pathname || ''
      const next = u.searchParams.get('next') || ''
      const err = u.searchParams.get('error')
      const code = u.searchParams.get('code')

      // Вход через провайдера. Приезжает двумя видами: своей схемой
      // (обычный путь) и обычной ссылкой, если Android перехватил
      // редирект App Links'ом раньше, чем Chrome успел его показать.
      const isAuth =
        (scheme === 'cresca' && u.host === 'auth') ||
        path === '/auth/callback'

      if (isAuth) {
        if (err) { go('/m/login?oauth=' + encodeURIComponent(err)); return }
        if (code) { await finishAuth(code, next); return }
        return
      }

      if (scheme === 'cresca') {
        // cresca://open?path=/app/orders — и всё, что придёт от пушей.
        go(u.searchParams.get('path') || next || '/m')
        return
      }

      // Обычная ссылка на наш домен: открываем тот же адрес внутри.
      if (/(^|\.)cres-ca\.com$/.test(u.host)) go(u.pathname + u.search)
    }

    // ── Android: ссылка запуска лежит в мосте, дальше — события ──
    try {
      const first = w.AndroidDeepLink?.consume?.()
      if (first) void handle(first)
    } catch { /* моста нет — значит, не Android-приложение */ }

    const onEvent = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url
      if (url) void handle(url)
    }
    window.addEventListener('cres:deeplink', onEvent as EventListener)

    // ── iOS: плагин App ──────────────────────────────────────────
    let off: (() => void) | null = null
    const app = w.Capacitor?.Plugins?.App

    if (app?.addListener) {
      void app
        .addListener('appUrlOpen', (d) => { if (d?.url) void handle(d.url) })
        .then((h) => {
          if (dead) h.remove()
          else off = () => h.remove()
        })
        .catch(() => {})
    }
    if (app?.getLaunchUrl) {
      void app.getLaunchUrl().then((d) => { if (d?.url) void handle(d.url) }).catch(() => {})
    }

    return () => {
      dead = true
      window.removeEventListener('cres:deeplink', onEvent as EventListener)
      off?.()
    }
  }, [])

  return null
}
