import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { adVars } from "@/lib/cityAdPalette";
import { IDLE_COLOR, IDLE_IN, IDLE_OUT, idleDelay, idleSlogans, idleTickerMs, priceLine, type IdleKind } from "@/lib/districtIdle";
import { t } from "@/i18n";

/**
 * Самореклама свободного места (PR 4 районов, Центр — отдельный PR): слоганы по очереди в стиле типа места —
 * экран фасада (янтарная рамка, развёртка), LED-строка, голо-баннер и голо-вывеска. Общая для районов и Центра.
 * Смена — разовые WAAPI-прогоны по JS-таймеру, бесконечных CSS-анимаций нет; still — первый слоган неподвижно.
 * compact — маленькие места Центра (вывеска в одну строку, баннер крупнее), см. idleSlogans.
 * Положение задаёт style (проценты кадра); касание обрабатывает обёртка (в Центре — кнопка покупки места).
 * ad — купленное место района (PR 6): тот же облик места, но текст и цвет покупателя (заголовок, подпись у баннера
 * и экрана); LED-строка проезжает заголовок по кругу, остальные стоят без смены (класс dz-ad).
 * Экран на фасаде с картинкой (ad.image — полный адрес): картинка во весь экран, под ней — заголовок и подпись
 * на тёмной плашке (контраст ≥ 4,5 : 1 при любой картинке). Картинка не загрузилась — экран как без неё, только текст.
 */
export type SurfaceAd = { title: string; subtitle?: string | null; color: string; image?: string | null };
type IdleProps = {
  spot: string;
  kind: IdleKind;
  i: number;
  price: string | null;
  still: boolean;
  style?: CSSProperties;
  compact?: boolean;
  ad?: SurfaceAd | null;
};
const can = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === "function";

export function IdleSurface({ spot, kind, i, price, still, style, compact = false, ad = null }: IdleProps) {
  const slogans = ad ? [ad.title] : idleSlogans(kind, price, compact);
  const [n, setN] = useState(0);
  const [broken, setBroken] = useState<string | null>(null);
  const text = useRef<HTMLSpanElement>(null);
  const win = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const count = slogans.length;

  // layout-эффект: проявление нового слогана стартует до первой отрисовки — без вспышки текста
  useLayoutEffect(() => {
    if (still || (count < 2 && kind !== "line")) return; // один текст (купленное место) — без смены
    let alive = true;
    let timer = 0;
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
          timer = window.setTimeout(run, 2000);
          return;
        }
        const from = w.clientWidth;
        const to = -tr.scrollWidth;
        anim = tr.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
          duration: idleTickerMs(from, to, w.clientWidth),
          easing: "linear",
          fill: "both",
        });
        // один текст (купленная строка) — снова тот же заголовок после паузы; иначе — следующий слоган
        anim.finished.then(() => (timer = window.setTimeout(count < 2 ? run : next, count < 2 ? 1600 : 700))).catch(() => {});
      };
      timer = window.setTimeout(() => (raf = requestAnimationFrame(run)), wasFirst ? 600 + i * 1300 : 0);
    } else {
      // голо/экран: новый слоган проявляется развёрткой; через 7–10 с — гаснет и сменяется
      if (!wasFirst && can(text.current)) text.current.animate(IDLE_IN, { duration: 260, easing: "cubic-bezier(.2,.9,.2,1)" });
      const swap = () => {
        if (!alive) return;
        if (document.hidden || !can(text.current)) {
          timer = window.setTimeout(swap, 3000);
          return;
        }
        anim = text.current.animate(IDLE_OUT, { duration: 200, easing: "steps(3, end)", fill: "forwards" });
        anim.finished.then(next).catch(() => {});
      };
      timer = window.setTimeout(swap, idleDelay(wasFirst ? i : 0));
    }
    return () => {
      alive = false;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      anim?.cancel();
    };
  }, [n, still, count, kind, i]);

  const slogan = ad ? ad.title : still && kind === "line" ? slogans[0].split(" · ")[0] : slogans[n % count];
  const p = priceLine(price);
  const sub = ad?.subtitle || null;
  const pic = kind === "facade_screen" && ad?.image && broken !== ad.image ? ad.image : null;
  const look = { ...style, ...adVars(ad?.color ?? IDLE_COLOR[kind]) } as CSSProperties;
  return (
    <div
      className={`dz-idle k-${kind}${still ? " still" : ""}${compact ? " compact" : ""}${ad ? " dz-ad" : ""}${pic ? " has-pic" : ""}`}
      style={look}
      data-spot={spot}
      data-n={n}
    >
      {/* поля — у внутреннего блока: единицы cq* считаются от места, а не от поля самого места */}
      <span className="in">
      {kind === "facade_screen" && !ad && (
        <>
          <span className="tag">{t("idle.freeScreen")}</span>
          <span className="t" ref={text}>
            {slogan}
          </span>
          <span className="p">{p ?? t("district.rows")}</span>
        </>
      )}
      {pic && (
        <>
          <img className="pic" src={pic} alt="" decoding="async" draggable={false} onError={() => setBroken(pic)} />
          <span className="cap">
            <span className="t" ref={text}>
              {slogan}
            </span>
            {sub && <span className="p">{sub}</span>}
          </span>
        </>
      )}
      {kind === "facade_screen" && ad && !pic && (
        <>
          <span className="t" ref={text}>
            {slogan}
          </span>
          {sub && <span className="p">{sub}</span>}
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
      {kind === "banner" && sub && <small className="s">{sub}</small>}
      </span>
    </div>
  );
}

