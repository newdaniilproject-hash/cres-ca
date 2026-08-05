import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:app/theme.dart';

// Тесты каркаса. Продуктовых сценариев здесь пока нет намеренно:
// экраны строятся по спецификации, а тест на несуществующий экран —
// это тест на воображение автора.
//
// Проверяется то, что уже есть и что молча сломать легче всего:
// дизайн-система. Расхождение с `app/globals.css` не даст ни ошибки
// сборки, ни падения в рантайме — приложение просто начнёт выглядеть
// чужим, и заметят это на телефоне клиента.
void main() {
  test('токены совпадают с app/globals.css', () {
    // Мягкий чёрный, а не #000.
    expect(T.bg, const Color(0xFF141417));
    expect(T.surface, const Color(0xFF1A1A1D));
    // Акцент тёмной темы: в светлой он темнеет до #2563EB.
    expect(T.accent, const Color(0xFF60A5FA));

    // Скругления — три ступени, смешивать нельзя.
    expect([T.rControl, T.rCard, T.rHero], [12.0, 16.0, 24.0]);

    // Зона нажатия Apple HIG. Меньше — правило нарушено.
    expect(T.tapMin, 44.0);
  });

  test('трекинг заголовка считается от кегля, а не фиксирован', () {
    // В CSS это -0.02em, то есть доля размера. Фиксированное значение
    // в пикселях разъезжается на крупных заголовках и слипается на мелких.
    expect(T.tracking(28), closeTo(-0.56, 0.001));
    expect(T.tracking(14), closeTo(-0.28, 0.001));
  });

  test('тёмная тема — основной вид', () {
    expect(T.dark.scaffoldBackgroundColor, T.bg);
    expect(T.dark.colorScheme.primary, T.accent);
  });
}
