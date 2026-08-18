'use client'

import { useEffect } from 'react'

// Глубокие ссылки: единственная дверь в приложение снаружи.
//
// Через неё приходят три разных вещи, и обрабатывать их надо в одном
// месте, иначе они разъедутся:
//
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

    async function handle(raw: string) {
      if (dead || !raw) return
      let u: URL
      try { u = new URL(raw) } catch { return }

      void closeBrowser()

      const scheme = u.protocol.replace(':', '')
      const next = u.searchParams.get('next') || ''

      // Ветки «возврат от провайдера» здесь больше НЕТ: вход через Google
      // удалён целиком решением владельца 18.08.2026 (правило 8).
      // Схема `cresca://` осталась и нужна — по ней приходят тапы по пушам
      // и ссылки на товар, присланные в мессенджере.

      if (scheme === 'cresca') {
        // cresca://open?path=/app/orders — и всё, что придёт от пушей.
        go(u.searchParams.get('path') || next || '/m')
        return
      }

      // Обычная ссылка на наш домен: открываем тот же адрес внутри.
      if (/(^|\.)cres-ca\.com$/.test(u.host)) go(u.pathname + u.search)
    }

    const onEvent = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url
      if (url) void handle(url)
    }
    window.addEventListener('cres:deeplink', onEvent as EventListener)

    let off: (() => void) | null = null

    // ═══════════════════════════════════════════════════════════════
    // ВСЁ, ЧТО ТРОГАЕТ МОСТ, — ВНУТРИ try/catch. Правило, оплаченное
    // неделей простоя 04–12.08.2026: отказ нативной возможности гасит
    // ВОЗМОЖНОСТЬ, а не приложение. Этот эффект живёт в корневом
    // макете и границей ошибок не накрыт, поэтому любой бросок отсюда
    // сносит всё дерево React до первой отрисовки, а снаружи это
    // выглядит как системный экран «This page couldn't load».
    // ═══════════════════════════════════════════════════════════════
    try {
      // ── Android: ссылка запуска лежит в мосте, дальше — события ──
      try {
        const first = w.AndroidDeepLink?.consume?.()
        if (first) void handle(first)
      } catch { /* моста нет — значит, не Android-приложение */ }

      // ── iOS: плагин App ────────────────────────────────────────
      const app = w.Capacitor?.Plugins?.App

      if (app?.addListener) {
        // ⚠️ Promise.resolve ОБЯЗАТЕЛЕН. НЕ СНИМАТЬ.
        //
        // Это и есть причина, по которой обёртка не открывалась
        // с 04.08 по 12.08.2026 — десять сборок и шесть опровергнутых
        // гипотез. Сломал коммит adb48796, добавивший слой глубоких
        // ссылок.
        //
        // Плагины здесь берутся ИЗ МОСТА (window.Capacitor.Plugins),
        // а не из npm-обёртки, и это намеренно (см. шапку файла).
        // Но контракты у них РАЗНЫЕ:
        //   npm-обёртка  addListener -> Promise<PluginListenerHandle>
        //   МОСТ         addListener -> PluginListenerHandle СИНХРОННО
        // У синхронного handle нет .then, и вызов его давал
        //   TypeError: …addListener("appUrlOpen", …).then is not a function
        // Синхронный бросок внутри useEffect корневого макета →
        // React сносит дерево → системный экран вместо сайта.
        //
        // Promise.resolve принимает и то, и другое. Снявший его
        // сломает приложение снова и будет искать неделю.
        Promise.resolve(
          app.addListener('appUrlOpen', (d) => { if (d?.url) void handle(d.url) }),
        )
          .then((h) => {
            if (dead) h?.remove?.()
            else off = () => h?.remove?.()
          })
          .catch(() => {})
      }
      if (app?.getLaunchUrl) {
        // Тот же контракт и та же защита: у моста getLaunchUrl тоже
        // может отдать значение синхронно. Место не «на всякий
        // случай» — это ровно вторая половина той же мины.
        void Promise.resolve(app.getLaunchUrl()).then((d) => {
          // ТОЛЬКО своя схема, и это не придирка к чистоте.
          //
          // При удалённом server.url getLaunchUrl отдаёт САМ server.url —
          // https://cres-ca.com/m. Это не глубокая ссылка, приложение
          // просто так запустилось. Пропустив её дальше, получаем цикл:
          // handle → go('/m') → страница грузится → DeepLink монтируется
          // → getLaunchUrl → то же самое.
          //
          // Ссылка снаружи всегда приходит схемой cresca:// (см. шапку
          // файла); https-ссылки на Android приезжают через
          // AndroidDeepLink, где мост отдаёт ровно то, что перехватил.
          if (d?.url && d.url.startsWith('cresca:')) void handle(d.url)
        }).catch(() => {})
      }
    } catch {
      // Мост повёл себя не так, как ждали. Глубокие ссылки в этом
      // запуске не работают — приложение работает. Это и есть правило:
      // отказ возможности не равен отказу продукта.
    }

    return () => {
      dead = true
      window.removeEventListener('cres:deeplink', onEvent as EventListener)
      off?.()
    }
  }, [])

  return null
}
