'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'

// ── Сканер кода. Один на весь продукт ───────────────────────────────────────
//
// ЧТО БЫЛО СЛОМАНО. Три экрана склада читали код своей копией функции
// `scanCamera()`, и все три были написаны на двух браузерных возможностях:
// `BarcodeDetector` и `ImageCapture`. Ни одной из них НЕТ в Safari — ни
// в браузере на айфоне, ни в веб-вью приложения. То есть на iPhone сканер
// не работал вовсе: код доходил до первой проверки и показывал
// предупреждение, а человек видел, что «нажал — и ничего не произошло».
// Найдено владельцем на живом телефоне 18.08.2026.
//
// Второй дефект был у ВСЕХ платформ и в глаза не бросался: превью камеры
// не показывалось. `ImageCapture` берёт кадры из потока, не рисуя его,
// поэтому мастер наводил телефон вслепую и ждал, пока сработает.
//
// ── РЕШЕНИЕ: ОДИН ПУТЬ, А НЕ ДВА ────────────────────────────────────────────
//
// Декодер один — `@zxing/library`, чистый JS, и он читает и QR (наклейки
// на ёмкостях), и заводские EAN-13/Code-128. Соблазн оставить
// `BarcodeDetector` там, где он есть, и zxing на iOS — это две ветки
// с разным поведением, которые проверяются по отдельности и расходятся
// на третьей правке. Здесь один путь и одно поведение на обоих телефонах
// (CLAUDE.md → «Общий слой вместо паритета»).
//
// Плата — вес библиотеки. Он не платится, пока сканер не открыли:
// импорт динамический, и до первого нажатия на значок в шапке в бандл
// экрана не попадает ничего.
//
// ── ЧТО ЗДЕСЬ ОБЯЗАТЕЛЬНО ───────────────────────────────────────────────────
//
//  • ПОТОК ГЛУШИТСЯ ВСЕГДА. Не остановленный `MediaStreamTrack` оставляет
//    камеру включённой: на телефоне горит индикатор, батарея садится,
//    а следующий вызов `getUserMedia` может не получить устройство вовсе.
//    Поэтому остановка стоит и в размонтировании, и в закрытии, и в ветке
//    ошибки — три места, и ни одно не лишнее.
//  • `playsInline` У ВИДЕО. Без него Safari на iPhone открывает поток
//    в полноэкранном системном плеере поверх страницы, и шторка со сканером
//    оказывается под ним.
//  • Отказ в доступе отличается от отсутствия камеры. Человеку надо
//    сказать РАЗНОЕ: в первом случае идти в настройки, во втором —
//    вводить код руками.

type Props = {
  open: boolean
  onClose: () => void
  /** Код распознан. Шторка закрывается сама — экрану остаётся только поиск. */
  onResult: (code: string) => void
  /**
   * Ручной ввод кода. Три подписи об ошибке здесь ЗОВУТ вводить код руками
   * («дозвольте доступ… або введіть код вручну»), а пути к этому вводу
   * в самой шторке не было: человек упирался в отказ камеры и в «Скасувати».
   * Пока рядом на экране склада стояло второе поле ввода, дефект не был
   * виден; после его удаления 18.08.2026 он стал тупиком, и выход из него
   * обязан жить там же, где отказ.
   *
   * Необязательный: экрану штрихкодов ручной ввод не нужен — он и так
   * состоит из поля.
   */
  onManual?: () => void
}

type Phase = 'starting' | 'scanning' | 'denied' | 'nocamera' | 'failed'

export function Scanner({ open, onClose, onResult, onManual }: Props) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [torch, setTorch] = useState<boolean | null>(null)
  // Подсказка «введіть код вручну», когда код долго не читается:
  // стёртая наклейка или блик иначе выглядят как вечное молчание.
  const [slow, setSlow] = useState(false)

  // Колбэки — в ref, а не в зависимостях эффекта. Все экраны передают
  // инлайн-стрелки, новые на каждом рендере, и с ними в зависимостях
  // ЛЮБОЕ обновление родителя (приход офлайн-очереди, refresh) глушило
  // поток и запрашивало камеру заново — а повторный getUserMedia может
  // устройство и не получить (см. шапку файла). Камера обязана жить,
  // пока open === true, и не дольше.
  const cbRef = useRef({ onClose, onResult })
  cbRef.current = { onClose, onResult }

  // Глушение потока вынесено отдельно и зовётся из трёх мест: иначе камера
  // остаётся включённой после закрытия шторки.
  const stopAll = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!open) { stopAll(); return }

    let alive = true
    setPhase('starting')
    setTorch(null)

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setPhase('nocamera'); return }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `environment` — задняя камера. `ideal`, а не `exact`: на ноутбуке
          // задней камеры нет, и `exact` уронил бы запрос вместо того, чтобы
          // взять единственную имеющуюся.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch (e) {
        if (!alive) return
        const name = e instanceof Error ? e.name : ''
        setPhase(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera'
          : 'failed')
        return
      }
      if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return }
      streamRef.current = stream

      const video = videoRef.current
      // Видео может не быть в DOM (шторка порталится эффектом): молчаливый
      // выход оставлял «Вмикаємо камеру…» навсегда. Отказ обязан быть виден.
      if (!video) { stopAll(); setPhase('failed'); return }
      video.srcObject = stream
      try { await video.play() } catch { /* автовоспроизведение может отказать — не смертельно */ }

      // Фонарик есть не у всех камер и не во всех браузерах. Спрашиваем
      // возможности трека, а не платформу: признак устройства честнее
      // разбора строки браузера.
      const track = stream.getVideoTracks()[0]
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
      if (caps?.torch) setTorch(false)

      setPhase('scanning')

      // Динамический импорт: до открытия сканера библиотека в бандл
      // экрана не попадает.
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } =
        await import('@zxing/library')
      if (!alive) return

      const hints = new Map()
      // Список форматов сужен намеренно: чем меньше форматов, тем быстрее
      // разбор кадра. QR — наши наклейки, EAN/UPC и Code-128 — заводские
      // штрихкоды на упаковке.
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ])
      const reader = new BrowserMultiFormatReader(hints, 250)
      stopRef.current = () => { try { reader.reset() } catch { /* уже остановлен */ } }

      reader.decodeFromStream(stream, video, (result) => {
        if (!alive || !result) return
        const text = result.getText()
        if (!text) return
        alive = false
        stopAll()
        cbRef.current.onResult(text)
        cbRef.current.onClose()
      }).catch(() => { if (alive) setPhase('failed') })
    })()

    // Пятнадцать секунд без распознавания — показываем подсказку про
    // ручной ввод. Сканер продолжает работать: подсказка — не отказ.
    const slowTimer = setTimeout(() => { if (alive) setSlow(true) }, 15000)
    setSlow(false)

    return () => { alive = false; clearTimeout(slowTimer); stopAll() }
  }, [open, stopAll])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || torch === null) return
    const next = !torch
    try {
      // `torch` нет в типах MediaTrackConstraintSet — это расширение,
      // поддержанное браузерами, но не описанное в стандарте.
      await track.applyConstraints({ advanced: [{ torch: next }] } as MediaTrackConstraints)
      setTorch(next)
    } catch { /* камера отказала — кнопка просто не сработает */ }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('scan.title')}>
      <div className="flex flex-col gap-3">
        <div className="relative overflow-hidden"
             style={{
               borderRadius: 'var(--radius-card)',
               background: 'var(--color-surface-2)',
               aspectRatio: '3 / 4',
             }}>
          {/* `playsInline` обязателен: без него Safari на iPhone открывает
              поток в системном плеере поверх страницы. `muted` — условие
              автовоспроизведения в обоих браузерах. */}
          <video ref={videoRef} playsInline muted autoPlay
                 className="h-full w-full object-cover" />

          {phase === 'scanning' && (
            // Рамка прицела: человек должен понимать, куда наводить.
            // Пунктиром и по центру, без затемнения по краям — затемнение
            // мешает разглядеть мелкий код на банке.
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div style={{
                width: '68%', aspectRatio: '1 / 1',
                border: '2px dashed var(--color-accent)',
                borderRadius: 'var(--radius-card)',
              }} />
            </div>
          )}

          {phase === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="t-sm prose-muted">{t('scan.starting')}</span>
            </div>
          )}
        </div>

        {phase === 'scanning' && (
          <p className="t-sm text-center prose-muted">
            {slow ? t('scan.slow') : t('scan.hint')}
          </p>
        )}
        {phase === 'denied' && <p className="field-error">{t('scan.denied')}</p>}
        {phase === 'nocamera' && <p className="field-error">{t('scan.nocamera')}</p>}
        {phase === 'failed' && <p className="field-error">{t('scan.failed')}</p>}

        <div className="flex items-center justify-between gap-2">
          {torch !== null ? (
            <button type="button" className="btn-secondary" onClick={() => void toggleTorch()}>
              {torch ? t('scan.torch.off') : t('scan.torch.on')}
            </button>
          ) : <span />}
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>

        {/* Ручной ввод — запасной путь, и он стоит НИЖЕ отмены намеренно:
            основной путь здесь камера, а это то, к чему обращаются, когда
            наклейка стёрта или камера отказала. Шторка закрывается сама —
            две шторки одна поверх другой на телефоне не читаются. */}
        {onManual && (
          <button type="button" className="btn-ghost w-full"
                  onClick={() => { onClose(); onManual() }}>
            {t('scan.manual')}
          </button>
        )}
      </div>
    </Sheet>
  )
}
