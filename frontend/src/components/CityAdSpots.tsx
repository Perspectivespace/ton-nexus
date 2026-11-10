import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useCityAds, type CityAdOnBoard, type CityAdSpotOnBoard } from "@/api/hooks";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { adVars } from "@/lib/cityAdPalette";
import type { CityPhase } from "@/lib/cityPhase";
import { blocked, rnd } from "./CityDaySky";
import { IdleSurface } from "./IdleSpot";
import { priceLine } from "@/lib/districtIdle";
import { lowEnd, reducedMotion } from "@/lib/walkPrefs";

/**
 * Реклама в городе — утверждённый облик (дизайн «F»): голо-баннеры и вывески — проекция (HUD-уголки, развёртка, луч
 * от эмиттера, чистая подпись Onest на тёмной плашке), строка на башне — LED-матрица, чередуется с «МАЙНЕР».
 * Координаты — в пикселях кадра 720×1280, место подобрано так, чтобы стоять на всех обликах T1–T4.
 * Вне «Прогулки» — только картинка (pointer-events: none, вне фокуса). В «Прогулке» — кнопки: касание открывает карточку.
 * Бесконечных анимаций нет (бюджет улицы занят): проявление, редкий короткий глитч заголовка и проезд строки —
 * разовые WAAPI-прогоны по JS-таймеру; на слабых устройствах и при «меньше движения» — без движения.
 */
export const AD_SPOT_BOX: Record<string, [number, number, number, number]> = {
  tower_line: [334, 573, 154, 26],
  banner_sky: [196, 728, 124, 56],
  banner_street: [92, 866, 126, 56],
  neon_left: [236, 934, 112, 30],
  neon_right: [542, 868, 106, 34],
};
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const box = ([x, y, w, h]: [number, number, number, number]): CSSProperties => ({ left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(h, H) });

/** кегль (px кадра), средняя ширина знака в em с разрядкой и поля (px кадра): заголовок баннера, подпись баннера, вывеска.
 * Ширины сверены с утверждённым макетом: названия из образца идут базовым кеглем. */
const FONT = { banner: [14.5, 0.6, 10], sub: [10.5, 0.5, 14], neon: [17.5, 0.64, 6] } as const;
/** кегль, при котором текст помещается в место (px кадра): длинные названия мельчают, а не обрезаются */
export function fitFont(kind: keyof typeof FONT, text: string, w: number): number {
  const [base, em, pad] = FONT[kind];
  const fit = (w - pad) / (Math.max(1, [...text].length) * em);
  return Math.max(7, Math.min(base, Math.floor(fit * 10) / 10));
}

/** места с объявлением на сегодня, которые умеем нарисовать */
export function liveSpots(spots: CityAdSpotOnBoard[] | undefined): CityAdSpotOnBoard[] {
  return (spots ?? []).filter((s) => s.ad && AD_SPOT_BOX[s.key]);
}

/**
 * Свободная строка на башне, которую можно купить: экран «МАЙНЕР» чередуется с саморекламой места
 * («Место для рекламы · от X TON/сутки») — и на главной, и в «Прогулке» (это одна строка, а не новые рамки).
 */
export function idleTower(spots: CityAdSpotOnBoard[] | undefined): CityAdSpotOnBoard | null {
  return (spots ?? []).find((s) => s.key === "tower_line" && s.on_sale && !s.ad) ?? null;
}
/** объявление-самореклама для строки на башне (рисуется тем же AdTicker, что и купленная строка) */
export function towerPromo(price: string | null): CityAdOnBoard {
  return { id: 0, title: "Место для рекламы", subtitle: priceLine(price), body: null, link_url: null, link_kind: null, color: "cyan", until: "" };
}

const lit = (p: CityPhase) => p === "night" || p === "dusk";
const devQ = (k: string) => (import.meta.env.DEV ? new URLSearchParams(location.search).get(k) : null);

function once(el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions) {
  if (!el || blocked() || devQ("adsT") != null || typeof el.animate !== "function") return;
  el.animate(k, o);
}
const GLITCH: Keyframe[] = [
  { transform: "none", opacity: 1 },
  { transform: "translateX(-2.5%) skewX(-6deg)", opacity: 0.7, offset: 0.15 },
  { transform: "translateX(2%)", opacity: 1, offset: 0.3 },
  { transform: "translateX(-1%) scaleY(.92)", opacity: 0.55, offset: 0.45 },
  { transform: "none", opacity: 1, offset: 0.6 },
  { transform: "none", opacity: 1 },
];

/** проявление проекции вечером/ночью и редкий короткий (0.26 с) глитч только заголовка — раз в 18–34 с */
function useHoloLife(host: React.RefObject<HTMLDivElement | null>, phase: CityPhase, count: number) {
  useEffect(() => {
    const el = host.current;
    if (!el || !count) return;
    if (lit(phase))
      el.querySelectorAll(".cad-holo").forEach((n, i) =>
        once(n, [{ opacity: 0, transform: "scaleY(.06)" }, { opacity: 1, transform: "none" }], {
          duration: 520,
          delay: 200 + i * 180,
          easing: "cubic-bezier(.2,.9,.2,1)",
          fill: "backwards",
        }),
      );
    let t = 0;
    const plan = (ms: number) => {
      t = window.setTimeout(() => {
        const all = el.querySelectorAll<HTMLElement>(".cad-holo");
        const n = all[Math.floor(Math.random() * all.length)];
        if (n && !n.getAnimations?.({ subtree: true }).length) once(n.querySelector(".t"), GLITCH, { duration: 260, easing: "steps(1, end)" });
        plan(rnd(18000, 34000));
      }, ms);
    };
    plan(rnd(9000, 16000));
    return () => window.clearTimeout(t);
  }, [host, phase, count]);
}

export function CityAdSpots({ phase }: { phase: CityPhase }) {
  const { data } = useCityAds();
  const walk = useCityWalk();
  const host = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const live = liveSpots(data?.spots);
  const holo = live.filter((s) => s.format !== "line");
  // в «Прогулке» свободные места рекламируют сами себя (слоганы по очереди): касание — покупка этого места.
  // Строка на башне — отдельно (idleTower), на главной вне «Прогулки» свободные места пустые.
  const free = walk.active ? (data?.spots ?? []).filter((s) => s.on_sale && !s.ad && AD_SPOT_BOX[s.key] && s.format !== "line") : [];
  const tower = idleTower(data?.spots);
  const still = lowEnd() || reducedMotion();
  useHoloLife(host, phase, holo.length);
  if (!live.length && !free.length && !tower) return null;
  const spotProps = (s: CityAdSpotOnBoard) => {
    const ad = s.ad!;
    return {
      type: "button" as const,
      "data-spot": s.key,
      tabIndex: walk.active ? 0 : -1,
      "aria-hidden": walk.active ? undefined : true,
      "aria-label": `Реклама: ${ad.title}${ad.subtitle ? `, ${ad.subtitle}` : ""}`,
      onClick: () => cityWalk.pick(s.key),
    };
  };
  return (
    <div ref={host} className={`cads-live ${lit(phase) ? "is-lit" : "is-unlit"}`}>
      {holo.map((s) => (
        <i key={`h-${s.key}`} className="cad-halo" style={{ ...box(AD_SPOT_BOX[s.key]), ...adVars(s.ad!.color) }} />
      ))}
      {holo.map((s) => {
        const ad = s.ad!;
        const w = AD_SPOT_BOX[s.key][2];
        const banner = s.format === "banner";
        const style = {
          ...box(AD_SPOT_BOX[s.key]),
          ...adVars(ad.color),
          "--fs": fitFont(banner ? "banner" : "neon", ad.title, w),
          "--fs2": banner && ad.subtitle ? fitFont("sub", ad.subtitle, w) : undefined,
        } as CSSProperties;
        return (
          <button key={s.key} {...spotProps(s)} className={`cad-spot cad-holo f-${banner ? "banner" : "neon"}${walk.picked === s.key ? " picked" : ""}`} style={style}>
            {banner && <i className="emit" />}
            <span className="t">{ad.title}</span>
            {banner && ad.subtitle && <small>{ad.subtitle}</small>}
          </button>
        );
      })}
      {free.map((s, i) => (
        <button
          key={`f-${s.key}`}
          type="button"
          data-free={s.key}
          className={`cad-free f-${s.format}`}
          style={box(AD_SPOT_BOX[s.key])}
          aria-label={`Свободное место: ${s.title}. Разместить рекламу`}
          onClick={() => navigate(`/ads?spot=${s.key}`)}
        >
          <IdleSurface spot={s.key} kind={s.format === "banner" ? "banner" : "neon"} i={i} price={s.price_day} still={still} compact />
        </button>
      ))}
      {tower && (
        <button
          key="idle-tower"
          type="button"
          data-free={tower.key}
          className="cad-spot cad-tick cad-idle-tick"
          style={{ ...box(AD_SPOT_BOX.tower_line), ...adVars("cyan") }}
          tabIndex={walk.active ? 0 : -1}
          aria-hidden={walk.active ? undefined : true}
          aria-label={`Свободное место: ${tower.title}. Разместить рекламу`}
          onClick={() => walk.active && navigate(`/ads?spot=${tower.key}`)}
        >
          <AdTicker ad={towerPromo(tower.price_day)} />
        </button>
      )}
      {live
        .filter((s) => s.format === "line")
        .map((s) => (
          <button key={s.key} {...spotProps(s)} className={`cad-spot cad-tick${walk.picked === s.key ? " picked" : ""}`} style={{ ...box(AD_SPOT_BOX[s.key]), ...adVars(s.ad!.color) }}>
            <AdTicker ad={s.ad!} />
          </button>
        ))}
    </div>
  );
}

/** текст строки на башне */
export const tickerText = (ad: CityAdOnBoard) => (ad.subtitle ? `${ad.title} · ${ad.subtitle}` : ad.title);
/** скорость проезда: ~3.6 с на ширину окна (читается на ходу и не мельтешит) */
export const tickerDuration = (from: number, to: number, win: number) => ((from - to) / Math.max(win, 1)) * 3600;

/**
 * Строка на башне вместо экрана «МАЙНЕР»: «МАЙНЕР» 7–9 с → строка рекламы проезжает один раз (разовый WAAPI) → снова «МАЙНЕР».
 * Без движения (слабое устройство, «меньше движения»): строка показывается неподвижно на 5 с и уступает «МАЙНЕР».
 * Буквы «перескакивают» по неподвижной сетке светодиодов (маска на окне), бесконечных анимаций нет.
 */
function AdTicker({ ad }: { ad: CityAdOnBoard }) {
  const win = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const frozen = devQ("adsT"); // только dev: заморозить строку на доле пути (для снимков)
  const [mode, setMode] = useState<"m-own" | "m-ad" | "m-still">(frozen ? "m-ad" : "m-own");
  const text = tickerText(ad);
  useEffect(() => {
    const run = () => {
      const wv = win.current;
      const tr = track.current;
      if (!wv || !tr || typeof tr.animate !== "function") return null;
      const from = wv.clientWidth;
      const to = -tr.scrollWidth;
      return tr.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
        duration: tickerDuration(from, to, wv.clientWidth),
        easing: "linear",
        fill: "both",
      });
    };
    if (frozen != null) {
      const a = run();
      if (a) {
        a.pause();
        a.currentTime = Number(frozen) * Number(a.effect?.getTiming().duration ?? 0);
      }
      return () => a?.cancel();
    }
    let t = 0;
    let alive = true;
    let anim: Animation | null = null;
    const back = (ms: number) => {
      t = window.setTimeout(() => {
        if (!alive) return;
        setMode("m-own");
        cycle();
      }, ms);
    };
    const cycle = () => {
      t = window.setTimeout(() => {
        if (!alive) return;
        if (document.hidden) return cycle();
        if (blocked()) {
          setMode("m-still");
          return back(5000);
        }
        setMode("m-ad");
        requestAnimationFrame(() => {
          if (!alive) return;
          anim = run();
          if (!anim) return back(5000);
          anim.finished.then(() => alive && back(0)).catch(() => {});
        });
      }, rnd(7000, 9000));
    };
    cycle();
    return () => {
      alive = false;
      window.clearTimeout(t);
      anim?.cancel();
    };
  }, [frozen, text]);
  return (
    <span className={`tk ${mode}`}>
      <span className="own">МАЙНЕР</span>
      <span className="tw-win" ref={win}>
        <span className="trk" ref={track}>
          {mode === "m-still" ? ad.title : text}
        </span>
      </span>
    </span>
  );
}
