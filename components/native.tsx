'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

// Есть ли на этом устройстве чем проверять палец или лицо.
//
// Отдельно от verify() СОЗНАТЕЛЬНО, и это не придирка к чистоте.
// verify() при отсутствии биометрии отвечает «пропускаем» — иначе
// человек с устройством без Face ID окажется заперт в приложении
// навсегда. Но «пропускаем» и «проверено» — разные вещи, и предлагать
// включить замок по такому ответу нельзя: получится обещание защиты,
// которой нет. Именно так и было до 14.08.2026 на iOS, где плагин
// @capgo/capacitor-native-biometric снят из сборки 12.08: тумблер
// говорил «Тепер кабінет відкривається тільки після Face ID»,
// а не проверялось ровно ничего.
async function bioAvailable(): Promise<boolean> {
  const p = platform()
  if (p === 'android') {
    const w = window as unknown as { AndroidBiometric?: { available: () => boolean } }
    try { return w.AndroidBiometric?.available?.() === true } catch { return false }
  }
  if (p === 'ios') {
    const nb = cap()?.Plugins?.NativeBiometric as
      | { isAvailable: () => Promise<{ isAvailable: boolean }> }
      | undefined
    if (!nb) return false
    try { return (await nb.isAvailable()).isAvailable === true } catch { return false }
  }
  return false
}

// Проверка пальцем или лицом. Уровнем модуля, а не внутри компонента:
// её зовут и замок при запуске, и тумблер в настройках заведения.
//
// Отсутствие биометрии отвечает «пропускаем», и это не оплошность:
// иначе человек с устройством без Face ID или со сломанным датчиком
// оказался бы заперт в приложении без выхода. Отличать «пропускаем»
// от «проверено» умеет bioAvailable() выше — включать замок можно
// только по нему.
async function rawVerify(): Promise<boolean> {
  const p = platform()
  if (p === 'android') {
    const w = window as unknown as { AndroidBiometric?: { available: () => boolean; request: () => void } }
    try {
      if (!w.AndroidBiometric?.available()) return true // биометрии нет — не запираем
      return await new Promise((resolve) => {
        const onResult = (e: Event) => {
          window.removeEventListener('cres:bio', onResult)
          const d = (e as CustomEvent).detail
          resolve(d === 'ok' || d === 'none')
        }
        window.addEventListener('cres:bio', onResult)
        w.AndroidBiometric!.request()
      })
    } catch { return true }
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


  useEffect(() => {
    // isNative() читает мост, localStorage падает в приватном режиме.
    let enabled: string | null = null
    try {
      if (!isNative()) return
      enabled = localStorage.getItem(BIO_KEY)
    } catch { return }

    // Первый запуск в приложении: один раз предлагаем включить замок —
    // но ТОЛЬКО если на устройстве есть чем проверять. Предложение там,
    // где биометрии нет, включает замок, который никого не проверяет,
    // и человек уверен, что кабинет защищён.
    if (enabled === null) {
      let dead = false
      const t = setTimeout(() => {
        void bioAvailable().then((ok) => { if (ok && !dead) setOfferBio(true) })
      }, 1500)
      return () => { dead = true; clearTimeout(t) }
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

  if (locked && typeof document !== 'undefined') {
    // Пока системный запрос Face ID открыт — за ним ничего не пишем.
    // Своя надпись под чужим окном выглядит как ошибка вёрстки, а человеку
    // и так понятно, чего от него хотят. Текст и кнопки появляются только
    // если он отменил проверку.
    //
    // ПОРТАЛОМ В BODY, И ЭТО ОБЯЗАТЕЛЬНО. NativeProvider живёт в нижнем
    // стеке оверлеев (layout.tsx → ToastProvider overlay), а у того
    // z-index 60 и pointer-events: none. Замок, отрисованный внутри,
    // получал обе беды сразу: шторка разделов (z-index 90) рисовалась
    // поверх защитного экрана, а кнопки «Розблокувати» и «Вимкнути
    // замок» не нажимались вовсе — отказ Face ID запирал человека
    // в приложении насмерть. Портал уносит замок из этого контекста;
    // высоту слоя задаёт .biolock-layer в globals.css.
    return createPortal(
      <div className="biolock-layer">
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
                      toast.info('Замок вимкнено', 'Увімкнути знову можна в налаштуваннях закладу, розділ «Безпека».') }}>
              Вимкнути замок
            </button>
          </>
        )}
      </div>,
      document.body,
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
                      toast.warn('Не вдалося перевірити біометрію', 'Замок не увімкнено — спробуйте в налаштуваннях закладу, розділ «Безпека».')
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

// ── Тумблер замка для настроек заведения ───────────────────────────
//
// Живёт ЗДЕСЬ, а не в экране настроек, и это не вкусовщина: замок —
// часть нативного модуля, у него свои ключи хранения, своя проверка
// доступности и свой мост. Экран настроек получает одну строку импорта
// и одну строку разметки, а вся логика остаётся в модуле, который
// переносится в другой проект целиком.
//
// ЗАЧЕМ ВООБЩЕ ПОЯВИЛСЯ (14.08.2026). Замок дважды говорил человеку
// «увімкнути знову можна в налаштуваннях безпеки» — при отказе от
// предложения и при выключении с экрана замка. Тумблера не было
// НИГДЕ: bioLockEnabled/setBioLockEnabled экспортировались и не
// использовались ни одной строкой, а /account/security внутри
// приложения вообще недостижим — путь /account переводится на /app
// (TWINS выше и native-boot.ts). То есть выключив замок один раз,
// включить его было нельзя никак, а подсказка отправляла на экран,
// которого в приложении нет.
//
// В браузере не рисуется ничего: замок на вход — свойство приложения,
// в вебе биометрия доступна только через WebAuthn, а это уже другой
// способ входа, а не замок поверх него.
export function BioLockRow() {
  const [show, setShow] = useState(false)
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let dead = false
    try {
      if (!isNative()) return
    } catch { return }
    void bioAvailable().then((ok) => {
      if (dead || !ok) return
      setShow(true)
      setOn(bioLockEnabled())
    })
    return () => { dead = true }
  }, [])

  if (!show) return null

  async function toggle() {
    setBusy(true)
    try {
      if (on) {
        // Выключение проверки не требует: человек уже внутри кабинета,
        // а требовать палец, чтобы снять замок, — это запирать дверь
        // ключом, который лежит за дверью.
        setBioLockEnabled(false)
        setOn(false)
      } else {
        // Включение — только после успешной проверки. Иначе замок
        // встанет на устройстве, которое не умеет его открывать.
        if (await rawVerify()) { setBioLockEnabled(true); setOn(true) }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card-flat mb-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="t-md">Вхід за біометрією</p>
        <p className="t-sm mt-0.5 prose-muted">
          {on
            ? 'Кабінет відкривається після Face ID або відбитка'
            : 'Захистити кабінет на випадок, якщо телефон потрапить у чужі руки'}
        </p>
      </div>
      <button type="button" className={on ? 'btn-secondary t-sm' : 'btn-primary t-sm'}
              disabled={busy} onClick={() => void toggle()}>
        {busy ? '…' : on ? 'Вимкнути' : 'Увімкнути'}
      </button>
    </div>
  )
}
