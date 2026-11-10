import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useDistrictAds } from "@/api/hooks";
import { adVars } from "@/lib/cityAdPalette";
import { IDLE_COLOR, IDLE_IN, IDLE_OUT, idleDelay, idleSlogans, idleTickerMs, priceLine } from "@/lib/districtIdle";
import { SURFACES, type SceneDistrict, type Surface } from "@/lib/districts";

/**
 * Самореклама свободных мест района поверх рисунка улицы (внутри слоя «улица» — едет вместе с ним).
 * Пока места района не продаются (PR 6), все четыре места «Неон-рядов» показывают её; цена — из витрины района.
 * Только картинка: касание не обрабатывается (покупка в районах — PR 6).
 */
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Surface): CSSProperties => ({ left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h) });
const can = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === "function";

function IdleSurface({ s, i, price, still }: { s: Surface; i: number; price: string | null; still: boolean }) {
  const slogans = idleSlogans(s.kind, price);
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
    if (s.kind === "line") {
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
  }, [n, still, count, s.kind, i]);

  const slogan = still && s.kind === "line" ? slogans[0].split(" · ")[0] : slogans[n];
  const p = priceLine(price);
  const style = { ...boxOf(s), ...adVars(IDLE_COLOR[s.kind]) } as CSSProperties;
  return (
    <div className={`dz-idle k-${s.kind}${still ? " still" : ""}`} style={style} data-spot={s.spot} data-n={n}>
      {/* поля — у внутреннего блока: единицы cq* считаются от места, а не от поля самого места */}
      <span className="in">
      {s.kind === "facade_screen" && (
        <>
          <span className="tag">Свободный экран</span>
          <span className="t" ref={text}>
            {slogan}
          </span>
          <span className="p">{p ?? "Неон-ряды"}</span>
        </>
      )}
      {s.kind === "line" && (
        <span className="win" ref={win}>
          <span className="t" ref={text}>
            {slogan}
          </span>
        </span>
      )}
      {(s.kind === "banner" || s.kind === "neon") && (
        <span className="t" ref={text}>
          {slogan}
        </span>
      )}
      </span>
    </div>
  );
}

export function DistrictIdleAds({ district, still }: { district: SceneDistrict; still: boolean }) {
  const surfaces = SURFACES[district];
  const { data } = useDistrictAds(district, !!surfaces);
  if (!surfaces) return null;
  const spots = new Map((data?.spots ?? []).map((s) => [s.key, s]));
  return (
    <div className="dz-idles" aria-hidden="true">
      {surfaces.map((s, i) => {
        const spot = spots.get(s.spot);
        if (spot?.ad) return null; // купленное место рисует реклама (PR 6)
        // цена места, иначе — цена его типа
        const price = spot?.price_day ?? data?.prices?.[s.kind] ?? null;
        return <IdleSurface key={s.spot} s={s} i={i} price={price} still={still} />;
      })}
    </div>
  );
}
