'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { LEGAL_DOCS } from '@/lib/legal'
import { nativeish, setBioLockEnabled } from '@/components/native'
import { Brand, Bullet } from '@/components/auth-ui'

// Первое знакомство с приложением: карусель из четырёх экранов,
// согласие с документами и три запроса разрешений.
//
// Почему одним файлом, а не пятью: это один линейный поток, который
// человек проходит ровно один раз и никогда не возвращается. Разложить
// его по маршрутам значило бы завести пять адресов, которые нужно
// защищать от прямого входа, и разъехаться с proxy.ts и TWINS
// в components/native.tsx. Здесь же нет ни одного нового маршрута.
//
// Показывается один раз — отметка в localStorage. Приватный режим
// браузера localStorage роняет, поэтому каждое обращение под try:
// отказ хранилища гасит «показать один раз», а не приложение.

const SEEN_KEY = 'cres:onboarded'

export function onboardingSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* приватный режим */ }
}

type Phase = 'slides' | 'legal' | 'permissions'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>('slides')

  function finish() { markSeen(); onDone() }

  if (phase === 'slides') return <Slides onDone={() => setPhase('legal')} onSkip={finish} />
  if (phase === 'legal') return <LegalStep onDone={() => setPhase('permissions')} />
  return <Permissions onDone={finish} />
}

/* ── Карусель ──────────────────────────────────────────────────
   Четыре экрана: заставка и три обещания. Точки внизу показывают,
   сколько осталось, — без них человек не знает, сколько терпеть. */

const SLIDES = [
  {
    title: 'Вітаємо в CRESKO!',
    subtitle: 'Ваш надійний помічник для контролю матеріалів, термінів придатності та безпеки в салоні',
    items: [
      { icon: <ShieldIcon />, title: 'Відповідність стандартам', desc: 'Техрегламент №65 КМУ та норми Держпродспоживслужби' },
      { icon: <ClockIcon />, title: 'Повний контроль термінів', desc: 'Автоматичні нагадування та розрахунки PAO' },
      { icon: <DocIcon />, title: 'Готові звіти для перевірок', desc: 'Paperless подача даних в один клік' },
    ],
    card: false,
    action: 'Далі',
  },
  {
    title: 'Будьте в курсі важливого',
    subtitle: 'Миттєві сповіщення про замовлення, терміни придатності, події та акції',
    items: [
      { icon: <ClockIcon />, title: 'Нагадування про терміни', desc: 'За 14 та 7 днів до закінчення' },
      { icon: <BoxIcon />, title: 'Статуси замовлень', desc: 'Нічого не пропустите' },
      { icon: <BellIcon />, title: 'Акції та новини', desc: 'Тільки важливе' },
    ],
    card: true,
    action: 'Далі',
  },
  {
    title: 'Економте час і гроші',
    subtitle: 'Менше втрат, більше порядку та прозорості у вашому бізнесі',
    items: [
      { icon: <BoxIcon />, title: 'Контроль залишків', desc: 'Оптимальні закупівлі' },
      { icon: <ChartIcon />, title: 'Аналітика та звіти', desc: 'Розумні рішення на основі даних' },
      { icon: <DocIcon />, title: 'Менше паперу', desc: 'Всі журнали в цифровому вигляді' },
    ],
    card: true,
    action: 'Почати',
  },
]

function Slides({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  // 0 — заставка, дальше три экрана обещаний.
  const [i, setI] = useState(0)
  const slide = i === 0 ? null : SLIDES[i - 1]

  return (
    <main className="m-scroll onb screen-enter">
      <div className="onb-top">
        {i > 0 && (
          <button type="button" className="link-quiet" onClick={onSkip}>Пропустити</button>
        )}
      </div>

      <div className="onb-body" key={i}>
        {slide === null ? (
          <div className="tab-fade flex flex-col items-center text-center">
            <Brand tagline />
            <p className="t-md mt-6 prose-muted" style={{ lineHeight: 1.5 }}>
              Професійний облік косметики, матеріалів та санітарних процедур
              у вашому салоні
            </p>
          </div>
        ) : (
          <div className="tab-fade">
            <h1 className="display t-2xl">{slide.title}</h1>
            <p className="t-md mt-2 prose-muted" style={{ lineHeight: 1.5 }}>{slide.subtitle}</p>
            <div className="mt-7">
              {slide.items.map((it) => (
                slide.card ? (
                  <div key={it.title} className="bullet-card">
                    <Bullet icon={it.icon} title={it.title} desc={it.desc} />
                  </div>
                ) : (
                  <Bullet key={it.title} icon={it.icon} title={it.title} desc={it.desc} />
                )
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="dots" aria-hidden>
        {[0, 1, 2, 3].map((n) => <i key={n} data-active={n === i} />)}
      </div>

      <div className="onb-foot">
        <button type="button" className="btn-primary btn-tall"
                onClick={() => (i === 3 ? onDone() : setI(i + 1))}>
          {i === 0 ? 'Далі' : SLIDES[i - 1].action}
        </button>
      </div>
    </main>
  )
}

/* ── Условия и политика ────────────────────────────────────────
   Отдельный экран, а не строка мелким шрифтом: галочка под текстом,
   который негде прочитать, — повод для отказа и в App Store,
   и у Meta при верификации бизнеса. Сама запись в журнал согласий
   уходит при регистрации вместе с LEGAL_VERSION — здесь человек
   только читает и подтверждает, что прочитал. */

function LegalStep({ onDone }: { onDone: () => void }) {
  const [agree, setAgree] = useState(false)
  return (
    <main className="m-scroll onb screen-enter">
      <div className="onb-top" />
      <div className="onb-body">
        <h1 className="display t-2xl">Умови та політика</h1>
        <p className="t-md mt-2 prose-muted" style={{ lineHeight: 1.5 }}>
          Будь ласка, ознайомтесь та підтвердіть згоду для продовження
        </p>

        <div className="mt-7">
          {LEGAL_DOCS.slice(0, 2).map((d) => (
            // Без target="_blank": в приложении новое окно веб-вью
            // открывается пустой белой страницей без кнопки назад.
            <Link key={d.href} href={d.href} className="doc-row">
              <span>{d.label}</span>
              <ArrowIcon />
            </Link>
          ))}
        </div>

        <label className="checkline mt-7">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            Я ознайомився(-лась) та погоджуюсь з умовами використання
            і політикою конфіденційності
          </span>
        </label>
      </div>

      <div className="onb-foot">
        <button type="button" className="btn-primary btn-tall" disabled={!agree} onClick={onDone}>
          Продовжити
        </button>
      </div>
    </main>
  )
}

/* ── Разрешения ────────────────────────────────────────────────
   ПРАВИЛО МОСТА, ради которого весь этот файл под try/catch:
   мост Capacitor СИНХРОНЕН, а npm-обёртки того же плагина
   асинхронны. Один и тот же вызов может вернуть значение, а может
   промис — поэтому каждый результат прогоняется через
   Promise.resolve(...) перед await. Отказ нативного слоя гасит
   возможность, а не приложение: любая ветка ловится и уходит
   в 'unavailable', экран просто пропускается.

   Экран показывается только если решение ещё не принято: спрашивать
   второй раз бессмысленно — система второе окно уже не покажет,
   и человек упрётся в кнопку, которая ничего не делает. */

type PermState = 'granted' | 'denied' | 'unavailable'

type Bridge = {
  Capacitor?: { Plugins?: Record<string, unknown> }
  AndroidOneSignal?: { requestPermission?: () => void }
  AndroidCamera?: { request?: () => void }
  AndroidBiometric?: { available?: () => boolean }
}
function bridge(): Bridge {
  return window as unknown as Bridge
}

async function askPush(): Promise<PermState> {
  try {
    const plugin = bridge().Capacitor?.Plugins?.PushNotifications as
      | { requestPermissions?: () => unknown } | undefined
    if (plugin?.requestPermissions) {
      const r = await Promise.resolve(plugin.requestPermissions())
      const receive = (r as { receive?: string } | undefined)?.receive
      return receive === 'granted' ? 'granted' : 'denied'
    }
    const android = bridge().AndroidOneSignal
    if (android?.requestPermission) {
      await Promise.resolve(android.requestPermission())
      return 'granted'
    }
    if (typeof Notification === 'undefined') return 'unavailable'
    const res = await Promise.resolve(Notification.requestPermission())
    return res === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unavailable'
  }
}

function pushDecided(): boolean {
  try {
    if (typeof Notification === 'undefined') return false
    return Notification.permission !== 'default'
  } catch { return false }
}

async function askCamera(): Promise<PermState> {
  try {
    const plugin = bridge().Capacitor?.Plugins?.Camera as
      | { requestPermissions?: () => unknown } | undefined
    if (plugin?.requestPermissions) {
      const r = await Promise.resolve(plugin.requestPermissions())
      const cam = (r as { camera?: string } | undefined)?.camera
      return cam === 'granted' || cam === 'limited' ? 'granted' : 'denied'
    }
    const android = bridge().AndroidCamera
    if (android?.request) {
      await Promise.resolve(android.request())
      return 'granted'
    }
    if (!navigator.mediaDevices?.getUserMedia) return 'unavailable'
    // Поток нужен ровно на то, чтобы система показала своё окно.
    // Дорожки гасим сразу — иначе на телефоне горит индикатор камеры.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch {
    return 'denied'
  }
}

const PUSH_KEY = 'cres:perm:push'
const CAM_KEY = 'cres:perm:camera'
const BIO_KEY = 'cres:biolock'

function decided(key: string): boolean {
  try { return localStorage.getItem(key) !== null } catch { return true }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* приватный режим */ }
}

function Permissions({ onDone }: { onDone: () => void }) {
  const [screens, setScreens] = useState<string[] | null>(null)
  const [i, setI] = useState(0)

  // Какие экраны вообще показывать, решается один раз при входе
  // в шаг: спрашивать про то, что уже решено, — значит показывать
  // кнопку, за которой ничего не произойдёт.
  useEffect(() => {
    const list: string[] = []
    if (!pushDecided() && !decided(PUSH_KEY)) list.push('push')
    if (!decided(CAM_KEY)) list.push('camera')
    // Face ID в браузере невозможен: экран показываем только внутри
    // приложения и только если человек ещё не решал.
    let native = false
    try { native = nativeish() } catch { /* веб */ }
    if (native && !decided(BIO_KEY)) list.push('faceid')
    setScreens(list)
  }, [])

  // Все три разрешения уже решены — шага нет вовсе. Через ref,
  // потому что onDone приходит новой функцией на каждый рендер
  // родителя, и без защёлки эффект позвал бы его дважды.
  const closed = useRef(false)
  useEffect(() => {
    if (screens && screens.length === 0 && !closed.current) {
      closed.current = true
      onDone()
    }
  }, [screens, onDone])

  if (!screens || screens.length === 0) return null

  function next() {
    if (i + 1 >= screens!.length) onDone(); else setI(i + 1)
  }

  const kind = screens[i]

  if (kind === 'push') {
    return (
      <PermScreen
        icon={<BellIcon size={34} />}
        title="Дозвіл на сповіщення"
        subtitle="Ми надсилатимемо вам важливі нагадування та оновлення"
        items={[
          { icon: <ClockIcon />, title: 'Нагадування про терміни', desc: 'За 14 та 7 днів до закінчення' },
          { icon: <BoxIcon />, title: 'Статуси замовлень', desc: 'Нічого не пропустите' },
          { icon: <BellIcon />, title: 'Важливі новини та акції', desc: 'Тільки те, що справді важливо' },
        ]}
        dialogText="«CRESKO» хоче надсилати вам сповіщення"
        allowLabel="Дозволити"
        denyLabel="Не дозволяти"
        onAllow={async () => { const r = await askPush(); remember(PUSH_KEY, r === 'granted' ? '1' : '0'); next() }}
        onDeny={() => { remember(PUSH_KEY, '0'); next() }}
      />
    )
  }

  if (kind === 'camera') {
    return (
      <PermScreen
        icon={<CameraIcon size={34} />}
        title="Дозвіл на камеру"
        subtitle="Потрібен для сканування QR- та штрихкодів товарів"
        items={[
          { icon: <BoxIcon />, title: 'Швидке додавання товарів', desc: 'Сканування замість ручного вводу' },
          { icon: <DocIcon />, title: 'Інвентаризація без помилок', desc: 'Кожна позиція звіряється кодом' },
          { icon: <ChartIcon />, title: 'Списання та приймання', desc: 'Одним рухом, прямо зі складу' },
        ]}
        dialogText="«CRESKO» хоче отримати доступ до камери"
        allowLabel="Дозволити"
        denyLabel="Не дозволяти"
        onAllow={async () => { const r = await askCamera(); remember(CAM_KEY, r === 'granted' ? '1' : '0'); next() }}
        onDeny={() => { remember(CAM_KEY, '0'); next() }}
      />
    )
  }

  return (
    <PermScreen
      icon={<FaceIcon size={34} />}
      title="Швидкий доступ за Face ID"
      subtitle="Увімкніть Face ID для швидкого та безпечного входу в додаток"
      items={[
        { icon: <ShieldIcon />, title: 'Безпечно', desc: 'Дані складу відкриваються тільки вам' },
        { icon: <ClockIcon />, title: 'Швидко', desc: 'Без пароля на кожному відкритті' },
        { icon: <FaceIcon />, title: 'Зручно', desc: 'Один погляд замість набору на телефоні' },
      ]}
      dialogText="«CRESKO» хоче використовувати Face ID"
      allowLabel="Увімкнути Face ID"
      denyLabel="Не зараз"
      onAllow={async () => {
        // Сам замок ставит components/native.tsx при следующем запуске:
        // здесь только записываем решение, чтобы он больше не спрашивал.
        try { setBioLockEnabled(true) } catch { /* хранилище недоступно */ }
        next()
      }}
      onDeny={() => { try { setBioLockEnabled(false) } catch { /* ignore */ } ; next() }}
    />
  )
}

function PermScreen({
  icon, title, subtitle, items, dialogText, allowLabel, denyLabel, onAllow, onDeny,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  items: { icon: React.ReactNode; title: string; desc: string }[]
  dialogText: string
  allowLabel: string
  denyLabel: string
  onAllow: () => void | Promise<void>
  onDeny: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <main className="m-scroll onb screen-enter">
      <div className="onb-top" />
      <div className="onb-body">
        <div className="flex flex-col items-center text-center">
          <span className="hero-circle" aria-hidden>{icon}</span>
          <h1 className="display t-2xl mt-5">{title}</h1>
          <p className="t-md mt-2 prose-muted" style={{ lineHeight: 1.5 }}>{subtitle}</p>
        </div>

        <div className="mt-7">
          {items.map((it) => (
            <Bullet key={it.title} icon={it.icon} title={it.title} desc={it.desc} />
          ))}
        </div>

        {/* Показываем, что именно спросит система, ДО того как она
            спросит: чужое окно без предупреждения человек закрывает
            рефлекторно, а вернуть отказ можно только в настройках
            телефона. Это не кнопки системы — это её изображение,
            но нажимаются они по-настоящему. */}
        <div className="sysdlg">
          <p className="sysdlg-text">{dialogText}</p>
          <div className="sysdlg-actions">
            <button type="button" disabled={busy} onClick={onDeny}>{denyLabel}</button>
            <button type="button" disabled={busy}
                    onClick={() => void (async () => { setBusy(true); await onAllow(); setBusy(false) })()}>
              {allowLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="onb-foot">
        <button type="button" className="link-quiet" onClick={onDeny}>Пропустити</button>
      </div>
    </main>
  )
}

/* ── Знаки ──────────────────────────────────────────────────────
   Путями, а не картинками: файл — это ещё один запрос и ещё одно
   место, где что-то может не загрузиться. */

function icon(size: number, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}
function ShieldIcon({ size = 22 }: { size?: number }) {
  return icon(size, <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z" />)
}
function ClockIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>)
}
function DocIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /><path d="M9 13h6M9 17h4" /></>)
}
function BoxIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>)
}
function BellIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></>)
}
function ChartIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>)
}
function CameraIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M3 8.5h3.5L8 6h8l1.5 2.5H21v11H3z" /><circle cx="12" cy="14" r="3.5" /></>)
}
function FaceIcon({ size = 22 }: { size?: number }) {
  return icon(size, <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M9 10v1.5M15 10v1.5M9.5 15c.7.8 1.5 1.2 2.5 1.2s1.8-.4 2.5-1.2" /></>)
}
function ArrowIcon() {
  return icon(18, <path d="M9 6l6 6-6 6" />)
}
