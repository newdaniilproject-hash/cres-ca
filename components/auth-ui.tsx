'use client'

import Link from 'next/link'
import { useState } from 'react'

// Общие детали экранов входа для веба и приложения.
//
// Один файл, а не два набора компонентов: правило проекта — «общий слой
// вместо паритета». Веб и /m различаются раскладкой (AuthShell против
// AppScreen), но знак успеха, поле пароля и мера его надёжности у них
// обязаны совпадать до пикселя — иначе два экрана одного продукта
// выглядят собранными разными людьми.
//
// Ни одного цвета, радиуса и отступа здесь нет: всё либо из готовых
// классов globals.css, либо через var(--…).

// Обратный отсчёт в виде 00:45. Так его показывает макет, и так он
// читается как время, а не как «осталось 45 чего-то».
export function mmss(total: number): string {
  const t = Math.max(0, total)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Марка ──────────────────────────────────────────────────────
// CRESKO — «склад для майстрів». Подпись включается там, где человек
// видит продукт впервые (приветствие), и молчит там, где он уже
// внутри потока входа.
export function Brand({ tagline = false }: { tagline?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-word">CRESKO</span>
      {tagline && <span className="brand-tagline">Склад для майстрів</span>}
    </div>
  )
}

// ── Успех ──────────────────────────────────────────────────────
// Один экран на три случая: почта подтверждена, вход выполнен,
// пароль изменён. Разные тексты, одна картинка — так человек
// с первого взгляда понимает «всё получилось», не читая.
export function SuccessScreen({
  title,
  subtitle,
  actionLabel,
  onAction,
  actionHref,
  secondaryLabel,
  onSecondary,
  secondaryHref,
}: {
  title: string
  subtitle: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  secondaryLabel?: string
  onSecondary?: () => void
  secondaryHref?: string
}) {
  return (
    <div className="auth-result">
      <div className="success-mark rise">
        <span className="confetti" aria-hidden>
          <i /><i /><i /><i /><i /><i />
        </span>
        <span className="success-circle">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 12.5l5.2 5.2L20 7" />
          </svg>
        </span>
      </div>

      <h1 className="display rise-1 t-2xl mt-6 text-center">{title}</h1>
      <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
        {subtitle}
      </p>

      {(actionLabel || secondaryLabel) && (
        <div className="rise-3 auth-result-actions">
          {actionLabel && (actionHref ? (
            <Link href={actionHref} className="btn-primary btn-tall">{actionLabel}</Link>
          ) : (
            <button type="button" className="btn-primary btn-tall" onClick={onAction}>
              {actionLabel}
            </button>
          ))}
          {secondaryLabel && (secondaryHref ? (
            <Link href={secondaryHref} className="link-quiet">{secondaryLabel}</Link>
          ) : (
            <button type="button" className="link-quiet" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Акаунт заблокирован ────────────────────────────────────────
// Показывается только когда Supabase действительно ответил перебором
// попыток (см. lockoutSeconds). Отдельный экран, а не строка ошибки:
// человек, которого не пускают, должен получить и объяснение,
// и оба выхода — сбросить пароль либо подождать.
export function BlockedScreen({
  waitText,
  onReset,
  onBack,
}: {
  waitText: string
  onReset: () => void
  onBack: () => void
}) {
  return (
    <div className="auth-result">
      <span className="hero-circle hero-circle-danger rise" aria-hidden>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="10" width="16" height="10" rx="2.5" />
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
          <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </span>

      <h1 className="display rise-1 t-2xl mt-6 text-center">Акаунт заблоковано</h1>
      <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
        Забагато невдалих спроб входу. Для вашої безпеки акаунт тимчасово заблоковано.
      </p>

      <div className="rise-3 note note-danger">
        Спробуйте повторити через {waitText}. Або скиньте пароль, якщо забули його.
      </div>

      <div className="rise-3 auth-result-actions">
        <button type="button" className="btn-primary btn-tall" onClick={onReset}>
          Скинути пароль
        </button>
        <button type="button" className="link-quiet" onClick={onBack}>
          Повернутися до входу
        </button>
      </div>
    </div>
  )
}

// ── Пароль ─────────────────────────────────────────────────────
// Поле с «глазиком». Единственный способ на телефоне не ошибиться
// в пароле, который набираешь вслепую большим пальцем.
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid,
  autoFocus,
  onFocus,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  placeholder?: string
  invalid?: boolean
  autoFocus?: boolean
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
}) {
  const [see, setSee] = useState(false)
  return (
    <div className="pw-wrap">
      <input
        id={id}
        required
        minLength={8}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        type={see ? 'text' : 'password'}
        className={invalid ? 'input input-error pw-input' : 'input pw-input'}
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setSee((v) => !v)}
        aria-label={see ? 'Сховати пароль' : 'Показати пароль'}
        className="pw-eye"
      >
        {see ? <EyeOff /> : <Eye />}
      </button>
    </div>
  )
}

// Надёжность пароля. Считается по тому, что человек реально может
// изменить: длина и разнообразие знаков. Библиотека для этого не
// нужна и в зависимости не добавляется.
export function passwordScore(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s += 1
  if (pw.length >= 12) s += 1
  if (/[a-zа-яїієґ]/i.test(pw) && /\d/.test(pw)) s += 1
  if (/[^\w\s]/.test(pw)) s += 1
  if (pw.length < 8) s = 0
  return Math.min(s, 4) as 0 | 1 | 2 | 3 | 4
}

const SCORE_LABEL = ['', 'Слабкий пароль', 'Так собі пароль', 'Добрий пароль', 'Надійний пароль']
const SCORE_TONE = ['none', 'weak', 'weak', 'ok', 'good'] as const

export function PasswordStrength({ value }: { value: string }) {
  const score = passwordScore(value)
  const tone = SCORE_TONE[score]
  return (
    <div className="pw-meter-wrap">
      <div className="pw-meter" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="pw-seg" data-on={score >= i ? '1' : '0'} data-tone={tone} />
        ))}
      </div>
      <p className="pw-meter-label" data-tone={tone}>
        {value.length === 0
          ? 'Мінімум 8 символів'
          : value.length < 8
            ? `Ще ${8 - value.length} символів`
            : SCORE_LABEL[score]}
      </p>
    </div>
  )
}

// ── Строка-пункт с иконкой ─────────────────────────────────────
// Три пункта под заголовком — общий приём всех экранов онбординга
// и разрешений. Один компонент, чтобы отступы не разъезжались.
export function Bullet({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="bullet">
      <span className="bullet-icon" aria-hidden>{icon}</span>
      <span className="bullet-body">
        <span className="bullet-title">{title}</span>
        <span className="bullet-desc">{desc}</span>
      </span>
    </div>
  )
}

function Eye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" />
      <path d="M6.2 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6" />
    </svg>
  )
}

// Конверт — знак «письмо ушло». Встречается на трёх экранах.
export function MailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
