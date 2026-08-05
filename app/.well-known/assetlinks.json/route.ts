// App Links для Android: ссылка на cres-ca.com открывает приложение.
//
// Android проверяет этот файл сам, при установке. Отпечаток здесь —
// SHA-256 того ключа, которым ПОДПИСАН установленный бинарь, и это
// главная ловушка: у debug-APK и у релиза из Google Play отпечатки
// РАЗНЫЕ, а у Play появляется ещё и третий — ключ подписи приложения
// Google Play (Play App Signing). Поэтому список, а не одна строка.
//
// Отпечатки берём из переменных окружения Vercel, а не из кода:
// ключ подписи меняется, а деплой из-за этого пересобирать не надо.
//   ANDROID_CERT_SHA256      — релизный ключ (или ключ Google Play)
//   ANDROID_CERT_SHA256_DEBUG — отладочный, чтобы проверить на своём
//                               телефоне до публикации
//
// Пока ни одна не задана, отдаём пустой список: Android просто
// не подтвердит связь и откроет ссылку в браузере. Это ровно то
// поведение, что и сейчас, — ничего не ломается.
export const dynamic = 'force-dynamic'

const PACKAGE = 'com.cresca.app'

function fingerprints(): string[] {
  const raw = [
    process.env.ANDROID_CERT_SHA256,
    process.env.ANDROID_CERT_SHA256_DEBUG,
  ]
    .filter(Boolean)
    .join(',')

  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    // Отпечаток — 32 байта через двоеточие. Кривую строку лучше
    // выбросить, чем отдать: с мусором Android молча перестаёт
    // проверять весь файл целиком.
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))
}

export function GET() {
  const certs = fingerprints()
  const body = certs.length
    ? [
        {
          relation: [
            'delegate_permission/common.handle_all_urls',
            'delegate_permission/common.get_login_creds',
          ],
          target: {
            namespace: 'android_app',
            package_name: PACKAGE,
            sha256_cert_fingerprints: certs,
          },
        },
      ]
    : []

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=600',
    },
  })
}
