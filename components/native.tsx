'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'

// Нативный слой: то, что оживает только внутри приложения из магазина.
// В обычном браузере весь файл — тишина, ни одного лишнего запроса.
//
// Главный урок DaKi, на котором это построено: на Android Capacitor
// НЕ инжектит JS-мост в удалённый server.url, на iOS — инжектит.
// Поэтому НИКАКИХ импортов нативных пакетов здесь нет — на iOS плагины
// берутся из window.Capacitor.Plugins (мост), на Android — из
// window.Android*-интерфейсов, которые ставит MainActivity
// (scripts/patch-android.sh). Импорт нативного пакета в веб-бандл
// сломал бы сборку Vercel, которой эти пакеты не нужны.

type CapBridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: Record<string, unknown>
}
type OneSignalWeb = {
  initialize?: (id: string) => void
  login: (id: string) => void
  logout?: () => void
  Notifications?: { requestPermission: (fallback: boolean) => Promise<unknown> }
  User?: { addTag?: (k: string, v: string) => void }
}

function cap(): CapBridge | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { Capacitor?: CapBridge }
  return w.Capacitor ?? null
}
export function isNative(): boolean {
  return cap()?.isNativePlatform?.() ?? false
}
function platform(): 'ios' | 'android' | 'web' {
  const p = cap()?.getPlatform?.()
  return p === 'ios' || p === 'android' ? p : 'web'
}

const BIO_KEY = 'cres:biolock'          // '1' — включён, '0' — отказался
const SESSION_KEY = 'cres:bio:passed'   // разблокировано в этом запуске приложения
const BIO_GRACE_MS = 5 * 60_000         // свернул на минуту-другую — не запирать

// Тумблер для кабинета: «Безпека» читает и пишет тот же ключ, что и замок.
export function bioLockEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(BIO_KEY) === '1'
}

export function setBioLockEnabled(on: boolean) {
  localStorage.setItem(BIO_KEY, on ? '1' : '0')
  // Выключили — снимаем и метку сессии, чтобы включение снова спросило палец.
  if (!on) sessionStorage.removeItem(SESSION_KEY)
}

export function NativeProvider() {
  const toast = useToast()
  const [locked, setLocked] = useState(false)
  const [offerBio, setOfferBio] = useState(false)

  // ── Привязка пушей к пользователю ──────────────────────────────
  // sendPush на сервере шлёт по external_id = id пользователя Supabase,
  // поэтому после входа устройство обязано представиться этим id —
  // иначе уведомления о заказах и сроках летят в пустоту.
  useEffect(() => {
    if (!isNative()) return
    const supabase = createClient()

    const bind = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const p = platform()
      if (p === 'android') {
        const w = window as unknown as { AndroidOneSignal?: { setUser: (u: string, t: string) => void } }
        w.AndroidOneSignal?.setUser(user.id, '')
      } else if (p === 'ios') {
        const w = window as unknown as { plugins?: { OneSignal?: OneSignalWeb } }
        const os = w.plugins?.OneSignal
        const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
        if (os && appId) {
          try {
            os.initialize?.(appId)
            os.login(user.id)
            void os.Notifications?.requestPermission(true)
          } catch { /* пуш не должен ронять кабинет */ }
        }
      }
    }
    void bind()

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void bind()
      if (event === 'SIGNED_OUT') {
        const w = window as unknown as {
          AndroidOneSignal?: { logout: () => void }
          plugins?: { OneSignal?: OneSignalWeb }
        }
        try { w.AndroidOneSignal?.logout(); w.plugins?.OneSignal?.logout?.() } catch { /* ignore */ }
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // ── Биометрический замок (Face ID / отпечаток) ─────────────────
  // Успешная проверка помечает запуск приложения как разблокированный,
  // чтобы палец не спрашивали на каждой перезагрузке страницы.
  const verify = useCallback(async (): Promise<boolean> => {
    const ok = await rawVerify()
    if (ok) { try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* приватный режим */ } }
    return ok
  }, [])

  // Объявление функцией, а не константой: verify() создаётся раньше по коду,
  // а объявления поднимаются — иначе временная мёртвая зона.
  async function rawVerify(): Promise<boolean> {
    const p = platform()
    if (p === 'android') {
      const w = window as unknown as { AndroidBiometric?: { available: () => boolean; request: () => void } }
      if (!w.AndroidBiometric?.available()) return true // биометрии нет — не запираем
      return new Promise((resolve) => {
        const onResult = (e: Event) => {
          window.removeEventListener('cres:bio', onResult)
          const d = (e as CustomEvent).detail
          resolve(d === 'ok' || d === 'none')
        }
        window.addEventListener('cres:bio', onResult)
        w.AndroidBiometric!.request()
      })
    }
    if (p === 'ios') {
      const nb = cap()?.Plugins?.NativeBiometric as
        | { isAvailable: () => Promise<{ isAvailable: boolean }>
            verifyIdentity: (o: object) => Promise<void> }
        | undefined
      if (!nb) return true
      try {
        const { isAvailable } = await nb.isAvailable()
        if (!isAvailable) return true
        await nb.verifyIdentity({
          reason: 'Вхід у Маркет',
          title: 'Вхід у Маркет',
          subtitle: 'Підтвердіть, що це ви',
        })
        return true
      } catch {
        return false
      }
    }
    return true
  }

  useEffect(() => {
    if (!isNative()) return
    const enabled = localStorage.getItem(BIO_KEY)

    // Первый запуск в приложении: один раз предлагаем включить замок.
    if (enabled === null) {
      const t = setTimeout(() => setOfferBio(true), 1500)
      return () => clearTimeout(t)
    }
    if (enabled !== '1') return

    // ГРАБЛИ: каждая перезагрузка страницы внутри приложения выглядела как
    // холодный старт, и Face ID спрашивали после каждого перехода — а это
    // ровно то, что бесит. sessionStorage живёт, пока жив процесс приложения,
    // и умирает, когда его смахнули из многозадачности. Именно та граница,
    // которая нам нужна: «уже разблокировали в этом запуске» против
    // «приложение закрыли».
    if (sessionStorage.getItem(SESSION_KEY) === '1') return

    // Холодный старт — запираем сразу.
    setLocked(true)
    void (async () => { if (await verify()) setLocked(false) })()

    // Возврат после долгого сворачивания — запираем снова.
    let hiddenAt = 0
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      if (hiddenAt && Date.now() - hiddenAt > BIO_GRACE_MS) {
        setLocked(true)
        void (async () => { if (await verify()) setLocked(false) })()
      }
      hiddenAt = 0
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [verify])

  if (locked) {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 px-8"
           style={{ background: 'var(--color-bg)' }}>
        <p className="display t-xl">Маркет<span style={{ color: 'var(--color-gold)' }}>.</span></p>
        <p className="t-md text-center prose-muted">
          Кабінет заблоковано. Підтвердіть, що це ви.
        </p>
        <button className="btn-primary"
                onClick={() => void (async () => { if (await verify()) setLocked(false) })()}>
          Розблокувати
        </button>
        <button className="t-sm underline underline-offset-2 prose-muted"
                onClick={() => { localStorage.setItem(BIO_KEY, '0'); setLocked(false)
                  toast.info('Замок вимкнено', 'Увімкнути знову можна в налаштуваннях безпеки.') }}>
          Вимкнути замок
        </button>
      </div>
    )
  }

  if (offerBio) {
    return (
      <div className="pointer-events-auto border p-3 rise"
           style={{ borderRadius: 'var(--radius-card)', borderColor: 'var(--color-border-strong)',
                    background: 'var(--color-surface)', boxShadow: 'var(--shadow-lift)' }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="t-md">Захистити вхід біометрією?</p>
            <p className="t-sm mt-0.5 prose-muted">Face ID або відбиток при відкритті застосунку</p>
          </div>
          <button className="btn-primary h-9 shrink-0 t-sm"
                  onClick={() => void (async () => {
                    setOfferBio(false)
                    if (await verify()) {
                      localStorage.setItem(BIO_KEY, '1')
                      toast.success('Замок увімкнено', 'Тепер кабінет відкривається тільки після Face ID чи відбитка.')
                    } else {
                      toast.warn('Не вдалося перевірити біометрію', 'Замок не увімкнено — спробуйте в налаштуваннях безпеки.')
                    }
                  })()}>
            Увімкнути
          </button>
          <button className="btn-ghost h-9 shrink-0 t-sm"
                  onClick={() => { localStorage.setItem(BIO_KEY, '0'); setOfferBio(false) }}>
            Ні
          </button>
        </div>
      </div>
    )
  }

  return null
}
