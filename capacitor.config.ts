// Тип CapacitorConfig НЕ импортируем из @capacitor/cli — иначе веб-сборка
// и tsc требуют пакет, который нужен только нативной сборке в Codemagic.
// CLI Capacitor читает экспортируемый объект и без аннотации типа.
// Приём проверен на DaKi — там это уже ловили.

/**
 * Маркет — нативная обёртка iOS/Android вокруг cres-ca.com.
 *
 * Приложение НЕ содержит наш JS-код: WebView открывает боевой сайт.
 * Поэтому новые фичи прилетают мгновенно с git push — без пересборки
 * и без ожидания ревью. Пересобирать бинарь нужно ТОЛЬКО когда меняется
 * иконка/название/бандл или добавляется нативный плагин.
 *
 * Урок DaKi, который здесь важен: на Android Capacitor НЕ инжектит
 * JS-мост в удалённый server.url (на iOS — инжектит). Поэтому всё
 * нативное для Android — пуши, биометрия, кнопка «назад» — живёт
 * в MainActivity (scripts/patch-android.sh), а веб зовёт его через
 * window.Android*-мосты.
 */
const config = {
  appId: 'com.cresca.app',
  appName: 'Маркет',

  // webDir обязателен — указываем public как заглушку,
  // реальные ресурсы грузятся с server.url.
  webDir: 'public',

  server: {
    // Вход приложения — /m, а НЕ страница сайта. Там своя раскладка:
    // без шапки, переключателя темы и ссылок «на головну». Вошедшего
    // /m сразу переносит в кабинет, невошедшему показывает экран
    // приветствия с двумя действиями.
    url: 'https://cres-ca.com/m',
    cleartext: false,
    iosScheme: 'https',
    androidScheme: 'https',
    // Куки авторизации Supabase + вход через Google.
    allowNavigation: ['cres-ca.com', '*.cres-ca.com', '*.supabase.co', 'accounts.google.com'],
  },

  ios: {
    // Совпадает с --color-bg: ровный фон вокруг safe-area, без полос.
    backgroundColor: '#141417',
    contentInset: 'never',
    scrollEnabled: true,
    // true требует WKAppBoundDomains и ломает Supabase-редиректы —
    // проверено на DaKi, не включать.
    limitsNavigationsToAppBoundDomains: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#141417',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#141417',
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
}

export default config
