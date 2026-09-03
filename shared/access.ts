// ── Доступ: разбор токена, права, модули. ОБЩИЙ СЛОЙ ────────────────────────
//
// Этот файл читают ОБА приложения: веб (`lib/tenant.ts`) и мобильное
// (`mobile/`). Поэтому здесь нет ни Next, ни React Native, ни единого
// импорта вообще — только разбор строки токена и три проверки над ним.
//
// ЗАЧЕМ ВЫНЕСЕНО. CLAUDE.md, «Общий слой вместо паритета»: «Правило „не
// забудь продублировать изменение в мобильную версию“ — признак
// отсутствующей архитектуры, а не дисциплины». Права — это последнее
// место, где такое дублирование допустимо: разойдись `can()` в двух
// приложениях, и одно из них покажет человеку раздел, который база ему
// не отдаст, либо спрячет тот, что оплачен.
//
// ЧТО СЮДА НЕ ПЕРЕЕХАЛО И ПОЧЕМУ. Всё, что ходит в сеть: получение
// сессии у Supabase. У веба это серверный клиент с куками, у мобильного —
// клиент с AsyncStorage; это разные вещи, и общими они быть не могут.
// Общее — то, что делают ПОСЛЕ получения токена, и оно здесь целиком.

// ⚠️ СПИСОК МОДУЛЕЙ ЖИВЁТ В БАЗЕ (`public.modules`, миграция 0110), а не
// здесь. Тип ниже — подсказка редактору, а не источник правды: известные
// коды подставляются автодополнением, но принимается ЛЮБАЯ строка, потому
// что новый модуль заводится строкой реестра и выката кода не требует.
export type KnownModule =
  | 'inventory' | 'compliance' | 'bookings' | 'catalog'
  | 'orders' | 'finance' | 'customers' | 'storefront' | 'marketing'

/**
 * Код модуля. Известные подсказываются, но допустима любая строка:
 * реестр в базе может знать модуль, о котором этот файл ещё не слышал.
 */
export type TenantModule = KnownModule | (string & {})

export type Membership = {
  tenantId: string
  role: string
  perms: string[]
  /**
   * Действующий набор модулей. При отсутствии клейма в токене — пустой,
   * а признак подмены уезжает в `modulesFromToken`.
   */
  modules: TenantModule[]
  /**
   * Модули приехали из токена (true) или клейма в токене нет (false).
   * Второе означает устаревший токен, а не заведение без модулей,
   * и лечится повторным входом.
   */
  modulesFromToken: boolean
}

// Членства, права и модули читаются из JWT — ни одного запроса к базе
// (правило 3). Разворачивает их хук при выдаче токена.
//
// ГРАБЛИ, из-за которых кабинет НИКОГДА не видел заведений и гонял
// человека по кругу «създай заклад → створи ещё раз» до лимита в три
// черновика: данные читались из session.user.app_metadata. Хук кладёт
// членства ВНУТРЬ самого access token — в его полезную нагрузку.
// А session.user — это запись из базы (raw_app_meta_data), какой она
// была при входе: provider, providers и всё. Хук её не трогает вовсе.
//
// Единственное место, где членства существуют, — сам JWT. Поэтому
// расшифровываем его полезную нагрузку руками. Подписи не проверяем
// сознательно: токен уже проверен Supabase на каждом запросе к базе,
// здесь мы только читаем то, что в нём написано, для раскладки меню.
// Граница доверия — RLS, а не эта функция.
export function jwtPayload(accessToken: string): Record<string, unknown> {
  try {
    const part = accessToken.split('.')[1] ?? ''
    // base64url. У Node есть родная раскодировка; `atob` — запасной путь
    // для браузера И для React Native, где Buffer отсутствует вовсе.
    // `Buffer` берём через globalThis, а не по имени: в React Native его
    // нет ВООБЩЕ, и упоминание идентификатора роняет проверку типов
    // мобильного проекта. Тянуть туда @types/node ради одной ветки нельзя —
    // он подменит типы браузерных API, которые RN реализует по-своему.
    const g = globalThis as {
      Buffer?: { from(s: string, enc: string): { toString(enc: string): string } }
    }
    const json = g.Buffer
      ? g.Buffer.from(part, 'base64url').toString('utf8')
      : decodeURIComponent(
        atob(part.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Идентификатор вошедшего из УЖЕ РАЗОБРАННОГО токена, без обращения к сети. */
export function userIdFromToken(accessToken: string): string | null {
  const sub = jwtPayload(accessToken).sub
  return typeof sub === 'string' ? sub : null
}

/** Признак сотрудника платформы. Ничего не открывает — см. `isPlatformStaff`. */
export function isStaffFromToken(accessToken: string): boolean {
  const meta = (jwtPayload(accessToken).app_metadata ?? {}) as { is_staff?: boolean }
  return meta.is_staff === true
}

/**
 * Членства, права и модули из токена. Чистая функция: на вход строка,
 * на выход список. Ровно её зовут и `lib/tenant.ts`, и мобильное.
 */
export function parseMemberships(accessToken: string): Membership[] {
  const meta = (jwtPayload(accessToken).app_metadata ?? {}) as {
    memberships?: Record<string, string>
    perms?: Record<string, string[]>
    modules?: Record<string, TenantModule[]>
  }
  return Object.entries(meta.memberships ?? {}).map(([tenantId, role]) => {
    // «Модулей нет» и «клейма нет» — РАЗНЫЕ вещи, и раньше обе давали
    // пустой массив. Отличить их можно точно, и вот чем.
    //
    // Хук (0020, переопределён в 0051) собирает `modules` тем же запросом
    // и по тому же набору заведений, что и `memberships`. Колонка
    // `tenants.modules` объявлена `not null`. Значит:
    //
    //   ключ есть → в нём массив, пусть даже пустой. Пустой массив —
    //               честный ответ базы «заведение не купило ничего»;
    //   ключа нет → членство в токене есть, а модулей рядом с ним нет.
    //               Хук такого не выдаёт НИКОГДА. Это токен, выданный
    //               до 0020, либо снятый при выключенном хуке — то есть
    //               сломан токен, а не набор модулей заведения.
    //
    // Копии умолчания в коде больше нет и заводить её снова незачем
    // (0110). Пустой массив честен: `modulesFromToken: false` говорит
    // экрану отказа, что дело в токене, и тот предлагает повторный вход.
    // Показать при этом лишний раздел хуже, чем показать понятный отказ.
    const claim = meta.modules?.[tenantId]
    const fromToken = Array.isArray(claim)
    return {
      tenantId,
      role,
      perms: meta.perms?.[tenantId] ?? [],
      modules: fromToken ? claim : [],
      modulesFromToken: fromToken,
    }
  })
}

/** Право сотрудника. `"*"` — владелец: всё, что есть у заведения. */
export function can(m: Membership | null | undefined, permission: string): boolean {
  if (!m) return false
  return m.perms.includes('*') || m.perms.includes(permission)
}

// Вторая ось доступа — что заведение КУПИЛО. Не путать с правами: право
// отвечает «что этому человеку можно», модуль — «что этот бизнес взял».
// Владелец с полными правами всё равно не увидит каталог, если заведение
// подключило только склад.
//
// Отказ по модулю рисуется экраном, а не молчаливым возвратом на главную:
// «нажал — и меня выкинуло» человек читает как поломку, а не как «мне
// сюда нельзя». В вебе это `<ModuleOff>`, в мобильном — свой экран,
// текст один и тот же из словаря.
export function hasModule(m: Membership | null | undefined, module: TenantModule): boolean {
  if (!m) return false
  return m.modules.includes(module)
}
