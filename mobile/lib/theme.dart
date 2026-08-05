// CupertinoPageTransitionsBuilder живёт в cupertino, а не в material:
// без этого импорта сборка падает «Method not found» уже на тестах.
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

/// Дизайн-система приложения. Единственный источник значений — этот файл,
/// ровно как `app/globals.css` в вебе: захардкоженный цвет или радиус
/// в виджете — ошибка приёмки.
///
/// Значения перенесены из `app/globals.css` один в один. Это НЕ второй
/// визуальный язык: продукт один, и выглядеть в приложении он обязан так же,
/// как в браузере. Расхождение здесь означает, что человек, открывший сайт
/// после приложения, решит, что попал не туда.
///
/// Почему копия, а не общий файл: CSS-переменные из Next.js во Flutter не
/// импортируются никак. Цена копии — при правке палитры правятся два файла;
/// это записано осознанно и дешевле, чем генератор ради двух десятков строк.
class T {
  const T._();

  // ── Поверхности ───────────────────────────────────────────────────────
  // Мягкий чёрный, а не #000: глаз не проваливается. Границы
  // полупрозрачно-белые — сплошной серый на тёмном грязнит.
  static const bg = Color(0xFF141417);
  static const surface = Color(0xFF1A1A1D);
  static const surface2 = Color(0xFF212125);

  static const border = Color(0x14FFFFFF); // rgb(255 255 255 / .08)
  static const borderStrong = Color(0x29FFFFFF); // rgb(255 255 255 / .16)

  static const text = Color(0xFFFAFAFA);
  static const muted = Color(0x9EFFFFFF); // rgb(255 255 255 / .62)
  static const faint = Color(0x57FFFFFF); // rgb(255 255 255 / .34)

  // ── Акцент ────────────────────────────────────────────────────────────
  // Кобальтовый. В тёмной теме светлее, в светлой темнее: один и тот же
  // цвет на двух фонах не читается.
  static const accent = Color(0xFF60A5FA);
  static const accentHover = Color(0xFF93C5FD);
  static const accentSoft = Color(0x2460A5FA);
  static const accentText = Color(0xFF0B1220);
  static const gold = Color(0xFFD9B262);

  static const danger = Color(0xFFFCA5A5);
  static const success = Color(0xFF86EFAC);
  static const warn = Color(0xFFFCD34D);

  // ── Скругления ────────────────────────────────────────────────────────
  // Радиус растёт вместе с размером объекта: значок — поле — карточка —
  // шторка. Смешивать ступени нельзя.
  static const rControl = 12.0;
  static const rCard = 16.0;
  static const rHero = 24.0;

  // ── Высоты ────────────────────────────────────────────────────────────
  // Поле выше кнопки на 6px намеренно: в форме поле — главное, кнопка при нём.
  static const hSm = 32.0;
  static const hMd = 40.0;
  static const hLg = 48.0;
  static const hInput = 46.0;

  /// Минимальная зона нажатия (Apple HIG). Её получает КНОПКА, а не иконка:
  /// значок 20px в зоне 44px — норма, значок 44px — уже другой макет.
  static const tapMin = 44.0;

  // ── Движение ──────────────────────────────────────────────────────────
  // Кривая «быстрый старт, долгое мягкое торможение». Выход всегда быстрее
  // входа — уходящий экран не должен задерживать.
  static const easeOutSoft = Cubic(0.23, 1, 0.32, 1);
  static const dInstant = Duration(milliseconds: 80);
  static const dFast = Duration(milliseconds: 150);
  static const dBase = Duration(milliseconds: 240);
  static const dSlow = Duration(milliseconds: 400);
  static const dExit = Duration(milliseconds: 140);

  // ── Тени ──────────────────────────────────────────────────────────────
  // Карточку от фона отделяет тень, а не жирная граница. Два слоя:
  // ближний даёт край, дальний — высоту.
  static const shadowCard = <BoxShadow>[
    BoxShadow(color: Color(0x52000000), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x47000000), blurRadius: 12, offset: Offset(0, 4)),
  ];
  static const shadowLift = <BoxShadow>[
    BoxShadow(color: Color(0x6B000000), blurRadius: 6, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x6B000000), blurRadius: 32, offset: Offset(0, 12)),
  ];

  /// Трекинг заголовков: в CSS это `-0.02em`, то есть доля от кегля.
  /// Во Flutter `letterSpacing` задаётся в пикселях, поэтому считается
  /// от размера — иначе крупный заголовок разъезжается, а мелкий слипается.
  static double tracking(double fontSize) => fontSize * -0.02;

  /// Заголовок: гротеск, вес 650, отрицательный трекинг.
  ///
  /// В CSS вес ровно 650 (переменная гарнитура Inter). У Flutter шкала
  /// ступенчатая, 650 в ней нет — берём w600, ближайшую снизу. Совпадение
  /// один в один появится, когда в приложение положим сам файл Inter;
  /// до тех пор системная гарнитура всё равно отличалась бы сильнее.
  static TextStyle heading(double size) => TextStyle(
        fontSize: size,
        fontWeight: FontWeight.w600,
        letterSpacing: tracking(size),
        color: text,
        height: 1.2,
      );

  /// Числа, которые обновляются на глазах (остатки, суммы, таймеры).
  /// Моноширинные цифры — иначе строка дёргается при каждом пересчёте.
  static const tabular = TextStyle(
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// Тёмная тема — ОСНОВНОЙ вид, а не «ночной режим». Системную тему
  /// приложение намеренно не слушает, как и веб.
  static ThemeData get dark {
    const scheme = ColorScheme.dark(
      surface: bg,
      primary: accent,
      onPrimary: accentText,
      secondary: accentSoft,
      error: danger,
      onError: accentText,
      outline: borderStrong,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      splashFactory: InkSparkle.splashFactory,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: heading(19),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, hLg),
          backgroundColor: accent,
          foregroundColor: accentText,
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(rControl),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        // Не мельче 16px: на телефоне поле мельче зумит экран, и он
        // обратно не отъезжает — правило веба, здесь оно тоже верно.
        hintStyle: const TextStyle(color: faint, fontSize: 16),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(rControl),
          borderSide: const BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(rControl),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(rControl),
          borderSide: const BorderSide(color: accent),
        ),
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(fontSize: 16, color: text, height: 1.5),
        bodyMedium: TextStyle(fontSize: 14, color: text, height: 1.5),
        bodySmall: TextStyle(fontSize: 13, color: muted, height: 1.5),
      ),
    );
  }
}
