// Значки. Геометрия — общая с вебом, рисование — своё.
//
// Числа берутся из `shared/icon-paths.ts`: там же их читает
// `components/icons.tsx`. Собственных координат здесь нет ни одной, и
// заводить их нельзя — иначе склад на сайте помечен коробкой, а
// в приложении чем-то похожим, и человек, ищущий глазами знакомую форму,
// её не находит.
//
// Толщина линии и сетка тоже общие: это свойства НАБОРА, а не значка.
// Цвет наследуется от подписи — значок всегда того же цвета, что текст
// под ним, и потому одинаково живёт в обеих темах.

import type { ColorValue } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { ICON_GRID, ICON_SHAPES, ICON_STROKE } from '../../shared/icon-paths'

export function Icon({
  name, size = 22, color,
}: {
  name: string | null
  size?: number
  // `ColorValue`, а не `string`: панель вкладок отдаёт цвет именно так
  // (внутри может лежать не строка, а ссылка на системный цвет).
  color: ColorValue
}) {
  // Имя без геометрии рисуется НЕЙТРАЛЬНЫМ кружком, а не пустотой:
  // молчаливое пустое место в панели читается как сломанная вкладка.
  // Тот же приём, что в вебе.
  const shapes = (name && ICON_SHAPES[name]) || ICON_SHAPES.IconGear

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`}
      fill="none"
      stroke={color}
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes.map((s, i) =>
        s.k === 'path' ? (
          <Path key={i} d={s.d} />
        ) : s.k === 'circle' ? (
          <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />
        ) : (
          <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />
        ),
      )}
    </Svg>
  )
}
