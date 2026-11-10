import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { adVars } from "@/lib/cityAdPalette";
import { IDLE_COLOR, IDLE_IN, IDLE_OUT, idleDelay, idleSlogans, idleTickerMs, priceLine, type IdleKind } from "@/lib/districtIdle";

/**
 * Самореклама свободного места (PR 4 районов, Центр — отдельный PR): слоганы по очереди в стиле типа места —
 * экран фасада (янтарная рамка, развёртка), LED-строка, голо-баннер и голо-вывеска. Общая для районов и Центра.
 * Смена — разовые WAAPI-прогоны по JS-таймеру, бесконечных CSS-анимаций нет; still — первый слоган неподвижно.
 * compact — маленькие места Центра (вывеска в одну строку, баннер крупнее), см. idleSlogans.
 * Положение задаёт style (проценты кадра); касание обрабатывает обёртка (в Центре — кнопка покупки места).
 */
type IdleProps = {
  spot: string;
  kind: IdleKind;
  i: number;
  price: string | null;
  still: boolean;
  style?: CSSProperties;
  compact?: boolean;
};
const can = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === "function";

export function IdleSurface({ spot, kind, i, price, still, style, compact = false }: IdleProps) {
  const slogans = idleSlogans(kind, price, compact);
  const [n, setN] = useState(0);
  const text = useRef<HTMLSpanElement>(null);
  const win = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const count = slogans.length;

  // layout-эффект: проявление нового слогана стартует до первой отрисовки — без вспышки текста
  useLayoutEffect(() => {
    if (still) return;
    let alive = true;
    let t = 0;
    let raf = 0;
    let anim: Animation | null = null;
    const next = () => alive && setN((v) => (v + 1) % count);
    const wasFirst = first.current;
    first.current = false;
    if (kind === "line") {
      // LED-строка: слоган проезжает окно один раз, пауза — следующий
      const run = () => {
        const w = win.current;
        const tr = text.current;
        if (!alive || !w || !can(tr)) return;
        if (document.hidden) {
          t = window.setTimeout(run, 2000);
          return;
        }
        const from = w.clientWidth;
        const to = -tr.scrollWidth;
        anim = tr.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
          duration: idleTickerMs(from, to, w.clientWidth),
          easing: "linear",
          fill: "both",
        });
        anim.finished.then(() => (t = window.setTimeout(next, 700))).catch(() => {});
      };
      t = window.setTimeout(() => (raf = requestAnimationFrame(run)), wasFirst ? 600 + i * 1300 : 0);
    } else {
      // голо/экран: новый слоган проявляется развёрткой; через 7–10 с — гаснет и сменяется
      if (!wasFirst && can(text.current)) text.current.animate(IDLE_IN, { duration: 260, easing: "cubic-bezier(.2,.9,.2,1)" });
      const swap = () => {
        if (!alive) return;
        if (document.hidden || !can(text.current)) {
          t = window.setTimeout(swap, 3000);
          return;
        }
        anim = text.current.animate(IDLE_OUT, { duration: 200, easing: "steps(3, end)", fill: "forwards" });
        anim.finished.then(next).catch(() => {});
      };
      t = window.setTimeout(swap, idleDelay(wasFirst ? i : 0));
    }
    return () => {
      alive = false;
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      anim?.cancel();
    };
  }, [n, still, count, kind, i]);

  const slogan = still && kind === "line" ? slogans[0].split(" · ")[0] : slogans[n];
  const p = priceLine(price);
  const look = { ...style, ...adVars(IDLE_COLOR[kind]) } as CSSProperties;
  return (
    <div className={`dz-idle k-${kind}${still ? " still" : ""}${compact ? " compact" : ""}`} style={look} data-spot={spot} data-n={n}>
      {/* поля — у внутреннего блока: единицы cq* считаются от места, а не от поля самого места */}
      <span className="in">
      {kind === "facade_screen" && (
        <>
          <span className="tag">Свободный экран</span>
          <span className="t" ref={text}>
            {slogan}
          </span>
          <span className="p">{p ?? "Неон-ряды"}</span>
        </>
      )}
      {kind === "line" && (
        <span className="win" ref={win}>
          <span className="t" ref={text}>
            {slogan}
          </span>
        </span>
      )}
      {(kind === "banner" || kind === "neon") && (
        <span className="t" ref={text}>
          {slogan}
        </span>
      )}
      </span>
    </div>
  );
}

