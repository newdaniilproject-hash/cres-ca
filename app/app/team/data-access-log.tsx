'use client'

import { useState } from 'react'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

// ── Журнал доступа к данным ────────────────────────────────────────────────
//
// Третий журнал на этом экране, и он отвечает на третий вопрос. Смешивать
// их нельзя — каждый существует ровно потому, что два других на его вопрос
// не отвечают:
//
//   Журнал прав     — «кто кому что выдал». Изменения доступа.
//   Журнал безпеки  — «кто ломился и откуда». Попытки, в том числе чужие.
//   Журнал доступу  — «кто СМОТРЕЛ данные». Законные действия своих,
//                     которые не меняют ни строки и потому не попадают
//                     ни в один журнал изменений.
//
// Последний — единственный ответ на вопрос «откуда у конкурента телефоны
// моих клиентов». `audit_log` (0021) пишет только insert/update/delete;
// открытая карточка и выгруженный список не меняют ничего и до 0090
// не оставляли следа вообще. Уволенный мастер, скачавший базу перед
// уходом, — самый частый сценарий в этом сегменте, и он был невидим.
//
// Читается ПРЕДСТАВЛЕНИЕ `data_access_log` (0090), а не таблица: оно само
// решает, кому что показать — владельцу заклада все строки заклада,
// сотруднику только его собственные. Второе не менее важно первого:
// человек должен иметь возможность проверить, что журнал не приписал ему
// чужое. Запись через это представление закрыта (0095) — иначе журнал,
// который можно дополнить своей строкой, ничего не доказывает.
//
// ⚠️ ДЕЙСТВИЕ ПОКАЗЫВАЕТСЯ ПОДПИСЬЮ, А НЕ ЗНАЧЕНИЕМ. `exported` — это
// служебное значение из ограничения `audit_log_action_check`: по нему
// сверяется база. Переводится подпись, значение остаётся английским
// навсегда. Неизвестное действие показывается КАК ЕСТЬ: новое появится
// в базе раньше, чем строка в словаре, и увидеть `printed` полезнее,
// чем пустоту.

export type DataAccessRow = {
  id: number
  at: string
  actor_id: string | null
  actor_email: string | null
  action: string
  entity: string
  entity_id: string | null
  /** Подпись из базы. Уже обезличена `mask_text_pii` (0089, 0090). */
  label: string | null
}

const ACTIONS = ['viewed', 'exported', 'downloaded', 'reported'] as const
type Action = (typeof ACTIONS)[number]
const isAction = (a: string): a is Action => (ACTIONS as readonly string[]).includes(a)

const actionLabel = (t: T, a: string): string =>
  (isAction(a) ? t(`team.access.action.${a}`) : a)

// Тон бейджа — оформление, а не текст: в словаре ему делать нечего.
// Красным помечена выгрузка: одним нажатием уходит вся база контактов,
// и именно её смотрят первой, когда разбираются с утечкой.
const TONE: Record<string, string> = {
  viewed: 'badge',
  exported: 'badge-danger',
  downloaded: 'badge-warn',
  reported: 'badge',
}

// Сущность — тоже служебное значение (имя таблицы). Показывается подписью,
// если она есть, и как есть, если её нет.
const ENTITIES = ['customers', 'material_documents', 'compliance_report'] as const
type Entity = (typeof ENTITIES)[number]
const isEntity = (e: string): e is Entity => (ENTITIES as readonly string[]).includes(e)

const entityLabel = (t: T, e: string): string =>
  (isEntity(e) ? t(`team.access.entity.${e}`) : e)

export function DataAccessLog({ rows }: { rows: DataAccessRow[] }) {
  const t = useT()
  // Свёрнут по умолчанию — как журналы прав и безопасности рядом:
  // двести строк истории над экраном, где работают каждый день,
  // превращают его в ленту.
  const [open, setOpen] = useState(false)

  return (
    <section className="card rise-3 !p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
        <div>
          <h2 className="t-lg">{t('team.access.title')}</h2>
          <p className="t-sm prose-muted">{t('team.access.desc')}</p>
        </div>
        {rows.length > 0 && (
          <button type="button" className="btn-secondary t-sm"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}>
            {open
              ? t('team.access.collapse')
              : t('team.access.expand', { n: t.number(rows.length) })}
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <p className="t-md prose-muted px-5 pb-5">{t('team.access.empty')}</p>
      )}

      {open && rows.map((r) => (
        <div key={r.id} className="row items-start px-5">
          <div className="min-w-0">
            <p className="t-md">
              <b>{r.actor_email ?? t('team.access.unknownActor')}</b>
            </p>
            <p className="t-xs prose-muted">{t.dateTime(r.at)}</p>
            <p className="t-sm prose-muted">{entityLabel(t, r.entity)}</p>
            {r.label && <p className="t-sm">{r.label}</p>}
          </div>
          <span className={`${TONE[r.action] ?? 'badge'} shrink-0`}>
            {actionLabel(t, r.action)}
          </span>
        </div>
      ))}

      {open && rows.length > 0 && (
        <p className="field-hint px-5 pb-5">{t('team.access.hint')}</p>
      )}
    </section>
  )
}
