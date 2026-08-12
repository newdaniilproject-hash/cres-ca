'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { haptic } from '@/lib/haptic'

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

// Каталог, витрина продавца, поиск и карта — ЧАСТЬ ПРИЛОЖЕНИЯ, а не сайт.
// Это две площадки с одним содержимым, как у Rozetka или Temu: в приложении
// каталог выглядит приложением, в браузере — сайтом. Раньше здесь стоял
// список разрешённых путей, и всё, чего в нём не было, выбрасывало
// на /m — то есть каталога внутри приложения не существовало вовсе.
// Это была ошибка проектирования, а не мелочь.
//
// Различие теперь несёт не путь, а оболочка: `data-native` на <html>
// прячет шапку сайта и подвал, оставляя родной вид (globals.css).
//
// Вебовые экраны, у которых есть НАСТОЯЩИЙ двойник в приложении, —
// только вход и регистрация: там расходится не оформление, а поток.
// Порядок важен: сначала более длинный путь.
const TWINS: [string, string][] = [
  // Вебовый онбординг продавца — это два шага: акаунт и заклад.
  // В приложении их разводят два разных экрана, и решает, какой нужен,
  // сам /m/shop: без сессии он уводит на приветствие, с сессией
  // показывает одношаговое создание заклада.
  ['/register/seller', '/m/shop'],
  ['/register', '/m/register'],
  ['/login', '/m/login'],
  ['/account', '/app'],
]

// Внутри приложения признак ставится ещё до отрисовки (native-boot.ts),
// и это единственная надёжная проверка на Android: моста Capacitor там
// при удалённом server.url нет вовсе.
export function nativeish(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.hasAttribute('data-native') || isNative()
}

export function NativeProvider() {
  const toast = useToast()

  // Перевод на родной поток входа. Ловит и случайную ссылку, которую забыли
  // спрятать, и — что важнее — уже установленный на телефон бинарь,
  // собранный со старым server.url: он открывает /app, кабинет не видит
  // заведения и уводит на вебовую форму «Акаунт для бізнесу».
  // Пересборка это чинит, но человек с приложением на руках не должен
  // ждать ревью магазина.
  //
  // Ничего, кроме входа и регистрации, отсюда никуда не уводится:
  // каталог и витрина внутри приложения остаются на месте.
  useEffect(() => {
    // Всё, что трогает мост, — под try/catch. См. правило в шапке файла.
    let check: (() => void) | null = null
    try {
      if (!nativeish()) return

      check = () => {
        const p = window.location.pathname
        const twin = TWINS.find(([from]) => p === from || p.startsWith(from + '/'))
        if (twin) window.location.replace(twin[1] + window.location.search)
      }
      check()
      window.addEventListener('popstate', check)
    } catch {
      // Мост чудит — перевод на родной поток входа в этом запуске
      // не работает. Приложение работает.
      return
    }

    const bound = check
    return () => { if (bound) window.removeEventListener('popstate', bound) }
  }, [])

  // ── Отклик на касание ──────────────────────────────────────────
  // Один обработчик на всё приложение вместо onClick в каждой кнопке.
  // Причина не в лени: расставленный руками отклик обязательно где-то
  // забудут, и половина интерфейса будет отзываться, а половина нет —
  // это заметнее, чем полное его отсутствие.
  //
  // touchstart, а не click: палец должен получить ответ в момент
  // касания, до того как отработает переход. Разница в 100–200 мс
  // и есть та самая «отзывчивость нативного».
  useEffect(() => {
    // Мост здесь трогают и nativeish(), и haptic.* внутри обработчика.
    try { if (!nativeish()) return } catch { return }

    const onTouch = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null
      const el = t?.closest?.(
        'button, a, [role="button"], label, summary, .bottomnav-item, .sidebar-item, .chip, .chip-active',
      ) as HTMLElement | null
      if (!el) return
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return
      // Поля ввода отзываться не должны: набор текста — это не нажатие.
      if (el.closest('input, textarea, select')) return
      // Переключатели и вкладки — «выбор», у него свой, более сухой отклик.
      const isChoice =
        el.getAttribute('role') === 'tab' ||
        el.classList.contains('bottomnav-item') ||
        el.classList.contains('chip') ||
        el.classList.contains('chip-active') ||
        el.tagName === 'LABEL'
      if (isChoice) haptic.select(); else haptic.tap()
    }

    document.addEventListener('touchstart', onTouch, { passive: true })
    return () => document.removeEventListener('touchstart', onTouch)
  }, [])
  const [locked, setLocked] = useState(false)
  const [offerBio, setOfferBio] = useState(false)
  // Показывать текст и кнопки на экране замка только после отказа:
  // пока висит системное окно Face ID, за ним должно быть пусто.
  const [denied, setDenied] = useState(false)

  // ── Привязка пушей к пользователю ──────────────────────────────
  // sendPush на сервере шлёт по external_id = id пользователя Supabase,
  // поэтому после входа устройство обязано представиться этим id —
  // иначе уведомления о заказах и сроках летят в пустоту.
  useEffect(() => {
    // isNative() читает мост — под try, как и всё остальное.
    try { if (!isNative()) return } catch { return }
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
    // isNative() читает мост, localStorage падает в приватном режиме.
    let enabled: string | null = null
    try {
      if (!isNative()) return
      enabled = localStorage.getItem(BIO_KEY)
    } catch { return }

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
    void (async () => { if (await verify()) { setLocked(false); setDenied(false) } else setDenied(true) })()

    // Возврат после долгого сворачивания — запираем снова.
    let hiddenAt = 0
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      if (hiddenAt && Date.now() - hiddenAt > BIO_GRACE_MS) {
        setLocked(true)
        void (async () => { if (await verify()) { setLocked(false); setDenied(false) } else setDenied(true) })()
      }
      hiddenAt = 0
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [verify])

  if (locked) {
    // Пока системный запрос Face ID открыт — за ним ничего не пишем.
    // Своя надпись под чужим окном выглядит как ошибка вёрстки, а человеку
    // и так понятно, чего от него хотят. Текст и кнопки появляются только
    // если он отменил проверку.
    return (
      <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 px-8"
           style={{ background: 'var(--color-bg)' }}>
        <p className="display t-xl">Маркет<span style={{ color: 'var(--color-gold)' }}>.</span></p>

        {denied && (
          <>
            <p className="t-md text-center prose-muted">
              Не вдалося підтвердити. Спробуйте ще раз.
            </p>
            <button className="btn-primary"
                    onClick={() => void (async () => {
                      setDenied(false)
                      if (await verify()) setLocked(false); else setDenied(true)
                    })()}>
              Розблокувати
            </button>
            <button className="t-sm underline underline-offset-2 prose-muted"
                    onClick={() => { localStorage.setItem(BIO_KEY, '0'); setLocked(false); setDenied(false)
                      toast.info('Замок вимкнено', 'Увімкнути знову можна в налаштуваннях безпеки.') }}>
              Вимкнути замок
            </button>
          </>
        )}
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
