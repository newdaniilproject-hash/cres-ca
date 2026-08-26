import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, currentUserId } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
// Реестр модулей — источник правды о разделах кабинета (0110). Читается
// ЗДЕСЬ, один раз на весь кабинет: макет не перерисовывается при переходах
// внутри сегмента, и справочник из девяти строк стоит дешевле копии
// в коде, которая устареет молча.
import { listModules } from '@/lib/modules'
// Из `lib/theme-script`, а НЕ из `components/theme`: тот файл клиентский,
// и вызов его экспорта на сервере роняет весь кабинет в 500
// («Attempted to call themeServerScript() from the server»). Оплачено
// падением боя 19.08.2026 — разбор в шапке `lib/theme-script.ts`.
import { themeServerScript, type Choice } from '@/lib/theme-script'
import { getLang } from '@/lib/i18n/server'
import { LangProvider } from '@/lib/i18n/client'
// Живі дані (0133). Стоїть ОДИН раз на весь кабінет, а не на екранах:
// база тримає один лічильник на заклад, і будь-яка зміна будь-де його
// підіймає. Новому екрану для миттєвості не треба нічого дописувати —
// розбір у шапці `components/live.tsx`.
import { Live } from '@/components/live'

export const dynamic = 'force-dynamic'

// Оболочка кабинета — здесь и только здесь.
//
// Раньше её рисовала каждая страница, и при переходе Next подставлял
// `loading.tsx` сегмента, который рисовал ВТОРУЮ оболочку: две нижние
// панели друг на друге и скелетон дашборда под заголовком «Профіль».
// Владелец увидел это первым же нажатием.
//
// Теперь панель, шапка и заголовок живут в layout, а страницы отдают
// только содержимое. Скелетоны загрузки рисуют содержимое и ничего
// больше — накладываться нечему.
//
// ЯЗЫК КАБИНЕТА тоже входит сюда, и по той же причине: он один на все
// двадцать шесть экранов. Кука читается один раз на кабинет, а не на
// странице (layout не перерисовывается при переходах внутри сегмента),
// и раздаётся вниз контекстом — клиентские экраны берут его хуком
// `useT()`, серверные могут звать `getT()` сами. Отдельного запроса
// и отдельного состояния это не стоит.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  // Имя заведения — заголовок экрана «Сьогодні». Один запрос на кабинет,
  // а не на каждую страницу: layout не перерисовывается при переходах
  // внутри сегмента.
  const supabase = await createClient()
  // Имя заведения и тема человека — одним заходом, параллельно.
  //
  // ТЕМА ЧИТАЕТСЯ ЗДЕСЬ, А НЕ В КОРНЕВОМ МАКЕТЕ, и это решение: корневой
  // макет обслуживает и витрину, а поход в базу оттуда сделал бы
  // динамическими все публичные страницы разом (правило 6 — скорость
  // критерий приёмки). Кабинет и так `force-dynamic`, и этот запрос
  // уходит вместе с запросом имени заведения.
  // `currentUserId` разбирает уже полученный токен и в сеть не ходит
  // (правило 3): идентификатор человека там же, где его права.
  const userId = await currentUserId()
  const [{ data: tenant }, { data: profile }, registry, { data: brand }] = await Promise.all([
    supabase.from('tenants').select('name').eq('id', m.tenantId).maybeSingle(),
    userId
      ? supabase.from('profiles').select('theme, full_name, avatar_url').eq('id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
    listModules(),
    // Колір бренду закладу (0123). Тим же одним походом, що й імʼя закладу:
    // окремий запит заради одного рядка — це зайва секунда на кожне
    // відкриття кабінету, а він і так ходить у базу в Ірландію.
    supabase.from('tenant_branding').select('brand_color')
      .eq('tenant_id', m.tenantId).maybeSingle(),
  ])
  const theme = (profile?.theme === 'dark' ? 'dark' : 'light') as Choice

  // Своё фото (0130) — В ОБОЛОЧКУ, а не только на экран профиля.
  // Отзыв владельца 25.08.2026: «фото обновилось но не везде». Аватар
  // в шапке и в шторке под ним рисовал первую букву имени, потому что
  // `avatar_url` в этот запрос не входил вовсе.
  //
  // Адрес собирается ЗДЕСЬ, на сервере, и приезжает готовой строкой:
  // оболочка клиентская, и заставить её строить его самой значило бы
  // завести в ней ещё одного клиента Supabase ради склейки строки.
  // Лишнего запроса это не стоит — колонка едет тем же `select`.
  const avatarUrl = profile?.avatar_url
    ? supabase.storage.from('media').getPublicUrl(profile.avatar_url).data.publicUrl
    : ''

  const lang = await getLang()

  return (
    <LangProvider lang={lang}>
      {/* Тема из профиля — одна на все устройства человека (0109).
          Скриптом, а не эффектом: эффект случается после отрисовки,
          и переключившийся на телефоне увидел бы на вебе белую вспышку
          и перекраску. Разбор — `components/theme.tsx`. */}
      <script dangerouslySetInnerHTML={{ __html: themeServerScript(theme) }} />
      <Live tenantId={m.tenantId} />
      {/* Бренд закладу (0123) — РОЗМІТКОЮ, а не скриптом і не ефектом.
          Значення приходить із сервера разом зі сторінкою, тому кадру
          з кобальтовим акцентом перед перефарбуванням не існує в принципі:
          нема чого перефарбовувати. З кольору береться тільки відтінок —
          виводить його `[data-brand]` у globals.css, і саме там, а не тут:
          значення стилю живуть в одному місці (правило проекту).
          Немає рядка — немає атрибута, і акцент лишається продуктовим. */}
      <div {...(brand?.brand_color
        ? { 'data-brand': '', style: { '--brand': brand.brand_color } as React.CSSProperties }
        : {})}>
        <AppShell modules={m.modules} registry={registry}
                  perms={m.perms} tenantId={m.tenantId} shopName={tenant?.name ?? ''}
                  userName={profile?.full_name ?? ''} avatarUrl={avatarUrl} role={m.role}>
          {children}
        </AppShell>
      </div>
    </LangProvider>
  )
}
