// Обёртка раздела: обе оси доступа, один раз на все экраны.
//
// В вебе эта пара проверок стоит в начале КАЖДОЙ страницы кабинета —
// и стоит там намеренно: меню прячет пункт, а прямой адрес его открывал
// (закрыто 16.08.2026). На телефоне то же самое: `href: null` убирает
// вкладку из панели, но глубокая ссылка `cresca://journals` работает.
//
// Здесь эти проверки собраны в один компонент, и это не только экономия
// строк. Право берётся ИЗ РЕЕСТРА (`modules.perm`), а не пишется рядом
// с каждым экраном: список «экран → право» вторым справочником разошёлся
// бы с реестром молча — ровно так же, как расходились `MODULE_LABELS`
// с `modules.title`.
//
// Отказы РАЗНЫЕ, и это принципиально: «нет права» — про человека
// («попросите владельца»), «нет модуля» — про заведение («это отдельный
// модуль»). Один общий текст на оба случая отправляет половину людей
// не туда.

import type { ReactNode } from 'react'
import { Redirect } from 'expo-router'
import { can, hasModule } from '../../shared/access'
import { Centered, Gate, Spinner } from './ui'
import { permLabel, t } from '../lib/i18n'
import { moduleByRoute, useModules } from '../lib/modules'
import { useSession } from '../lib/session'

export function ModuleScreen({
  route, children,
}: {
  /** Адрес экрана: он же связывает его со строкой реестра. */
  route: string
  children: (tenantId: string) => ReactNode
}) {
  const { loading, session, membership } = useSession()
  const rows = useModules()
  const row = moduleByRoute(rows, route)

  if (loading || rows === null) return <Centered><Spinner /></Centered>
  if (!session) return <Redirect href="/" />

  // Заведения нет вовсе — человек зарегистрировался, но магазин не завёл.
  // В вебе его отправляют на регистрацию продавца; здесь такого экрана
  // ещё нет, поэтому честный отказ вместо белого списка.
  if (!membership) {
    return <Gate title={t('mobile.gate.module.title')}
                 desc={t('mobile.gate.module.desc', { module: row?.title ?? route })}
                 m={null} />
  }

  const title = row?.title ?? route

  if (row?.perm && !can(membership, row.perm)) {
    return <Gate title={t('mobile.gate.right.title')}
                 desc={t('mobile.gate.right.desc', { module: title, perm: permLabel(row.perm) })}
                 m={membership} />
  }
  if (row && !hasModule(membership, row.code)) {
    return <Gate title={t('mobile.gate.module.title')}
                 desc={t('mobile.gate.module.desc', { module: title })}
                 m={membership} />
  }

  return <>{children(membership.tenantId)}</>
}
