'use client'

import { useState } from 'react'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

// ── Журнал безопасности ────────────────────────────────────────────────────
//
// Стоит рядом с журналом доступов и по той же причине: неизменяемая запись
// о том, что происходило с входом, стоит ноль, пока её никто не видит.
// Разница между двумя журналами — в том, ЧТО они отвечают:
//
//   Журнал доступів  — «кто кому что выдал». Действия своих.
//   Журнал безпеки   — «кто ломился и откуда». Попытки, в том числе чужие.
//
// Читается `security_log(арендатор)` (0085) — она SECURITY DEFINER и сама
// сводит события ВХОДА, у которых арендатора нет вовсе (попытка войти по
// почте, которой нет ни в одном закладе, закладу не принадлежит), с составом
// команды. Изоляцию проверяет её собственный WHERE по `team.read`.
//
// ⚠️ ВИД СОБЫТИЯ ПОКАЗЫВАЕТСЯ ПОДПИСЬЮ, А НЕ ЗНАЧЕНИЕМ. `login.failed` — это
// служебное значение из ограничения таблицы: по нему сверяется база, оно
// уезжает в запросы. Переводится подпись к нему, само значение остаётся
// английским навсегда (тот же приём, что у ролей и действий журнала прав).
// Неизвестный вид показывается КАК ЕСТЬ: новый вид появится в базе раньше,
// чем строка в словаре, и увидеть `login.otp_failed` полезнее, чем пустоту.
//
// ⚠️ И ГЛАВНОЕ: каждая строка снабжена советом. Владелец, увидевший «вхід
// з нового пристрою» без объяснения, что с этим делать, закроет экран
// и не вернётся. Совет — часть события, а не украшение.

export type SecurityEvent = {
  id: number
  at: string
  kind: string
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  /** Уже текстом: `security_log` отдаёт `host(ip)`, а не сам `inet`. */
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown> | null
}

const KINDS = [
  'login.failed', 'login.locked', 'login.new_device',
  'tenant.foreign_access', 'record.immutable_attempt',
] as const
type Kind = (typeof KINDS)[number]
const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k)

const kindLabel = (t: T, k: string): string =>
  (isKind(k) ? t(`team.security.kind.${k}`) : k)
const kindHint = (t: T, k: string): string =>
  (isKind(k) ? t(`team.security.hint.${k}`) : '')

// Тон бейджа — класс оформления, а не текст: в словаре ему делать нечего.
// Красным помечено то, что уже случилось (замок, чужой заклад); жёлтым —
// то, что само по себе законно, но требует взгляда.
const TONE: Record<string, string> = {
  'login.failed': 'badge',
  'login.locked': 'badge-danger',
  'login.new_device': 'badge-warn',
  'tenant.foreign_access': 'badge-danger',
  'record.immutable_attempt': 'badge-warn',
}

/** Строка из `detail`, обрезанная базой до 200 знаков. Пусто — не показываем. */
function detailText(detail: Record<string, unknown> | null, key: string): string {
  const v = detail?.[key]
  return typeof v === 'string' && v.trim() !== '' ? v : ''
}

export function SecurityLog({ events }: { events: SecurityEvent[] }) {
  const t = useT()
  // Свёрнут по умолчанию — как и журнал доступов: двести строк истории над
  // экраном, где работают каждый день, превращают его в ленту.
  const [open, setOpen] = useState(false)

  return (
    <section className="card rise-3 !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
        <div>
          <h2 className="t-lg">{t('team.security.title')}</h2>
          <p className="t-sm prose-muted">{t('team.security.desc')}</p>
        </div>
        {events.length > 0 && (
          <button type="button" className="btn-secondary t-sm"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}>
            {open
              ? t('team.security.collapse')
              : t('team.security.expand', { n: t.number(events.length) })}
          </button>
        )}
      </div>

      {events.length === 0 && (
        <p className="t-md prose-muted px-5 pb-5">{t('team.security.empty')}</p>
      )}

      {open && events.map((e) => {
        const what = detailText(e.detail, 'what')
        const where = detailText(e.detail, 'where')
        return (
          <div key={e.id} className="row items-start px-5">
            <div className="min-w-0">
              {/* Имя, а если человека мы не знаем — та почта, которую ВВЕЛИ
                  в поле входа. Она и есть главное в переборе адресов:
                  строка без имени означает попытку по чужой почте. */}
              {/* Точки-разделители сняты решением владельца 25.08.2026:
                  почта и строка устройства длинные, и склеенные точкой
                  они переносились в середине значения. Каждая величина
                  своей строкой. */}
              <p className="t-md">
                <b>{e.actor_name ?? t('team.security.unknownActor')}</b>
              </p>
              {e.actor_email && e.actor_email !== e.actor_name && (
                <p className="t-sm prose-muted">{e.actor_email}</p>
              )}
              <p className="t-xs prose-muted">{t.dateTime(e.at)}</p>

              <p className="t-sm prose-muted">
                {e.ip ? t('team.security.ip', { ip: e.ip }) : t('team.security.ipUnknown')}
              </p>
              <p className="t-sm prose-muted">
                {e.user_agent
                  ? t('team.security.device', { device: e.user_agent })
                  : t('team.security.deviceUnknown')}
              </p>

              {what && <p className="t-sm">{t('team.security.what', { what })}</p>}
              {where && <p className="t-sm prose-muted">{t('team.security.where', { where })}</p>}

              {kindHint(t, e.kind) && (
                <p className="field-hint">{kindHint(t, e.kind)}</p>
              )}
            </div>
            <span className={`${TONE[e.kind] ?? 'badge'} shrink-0`}>
              {kindLabel(t, e.kind)}
            </span>
          </div>
        )
      })}
    </section>
  )
}
