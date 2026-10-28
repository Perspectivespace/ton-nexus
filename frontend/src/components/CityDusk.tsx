import { useEffect, useLayoutEffect, useRef } from "react";
import { blocked, rnd, useRare } from "./CityDaySky";
import sky1 from "../assets/city/v2/dusk-sky-t1.webp";
import sky2 from "../assets/city/v2/dusk-sky-t2.webp";
import sky3 from "../assets/city/v2/dusk-sky-t3.webp";
import sky4 from "../assets/city/v2/dusk-sky-t4.webp";

/**
 * Вечер (dusk, шаг 1; DESIGN.md п. 12.1).
 * - CityDuskSun — низкое солнце садится за линию крыш: диск и тёплое зарево только по небу
 *   (маска неба для облика, 180×320), тёплая кромка и отсвет на стекле башни. Всё статично.
 * - CityDuskLights — город зажигается волной по районам (с запада к закату): тёплые окна, вывески и неон
 *   района включаются разом с небольшим разбросом. Только таймеры и CSS-переходы, бесконечных анимаций нет.
 *   Скрытое приложение, слабое устройство, «уменьшить движение» — сразу всё горит, без волны.
 * Шаг 3 (dusk): CityDuskStars — первые звёзды и тонкий серп луны (медленное разовое проявление, редкие мерцания);
 *   CityDuskTraffic — час пик: потоки белых фар и красных стоп-огней по дальним эстакадам. Каждая машина —
 *   разовая WAAPI-анимация, следующую запускает таймер; бесконечных анимаций нет. Слабое устройство и
 *   «уменьшить движение» — огни стоят на месте; скрытое приложение — новые машины не выезжают.
 * Шаг 4 (dusk): CityDuskWet — мокрая площадь отражает закат, вывески и окна (статично, редкое разовое «дрожание»).
 */

const SKY: Record<number, string> = { 1: sky1, 2: sky2, 3: sky3, 4: sky4 };

/** район по x в кадре 720×1280: 0 — запад … 4 — восток (к солнцу) */
export const district = (x: number) => (x < 150 ? 0 : x < 300 ? 1 : x < 440 ? 2 : x < 580 ? 3 : 4);
const DISTRICTS = 5;
const STEP = 1300; // мс между районами
const TAIL = 2600; // после последнего района: дождаться переходов и снять разметку волны

/** окна вечера: "x,y,w,h" в кадре 720×1280 — только тёмные фасады, вне неба (сняты с кадров вечера) */
const WINS: Record<number, string> = {
  1: "410,343,3,4 418,343,3,4 452,730,4,5 462,730,4,5 102,860,4,5 112,860,4,5 594,706,3,4 602,706,3,4 152,847,4,5 162,847,4,5 322,873,4,5 386,398,3,4 72,873,4,5 82,873,4,5 212,808,4,5 442,618,3,4 474,662,3,4 482,662,3,4 90,607,3,4 352,756,4,5 362,756,4,5 162,795,4,5 172,795,4,5 354,651,3,4 602,769,4,5 612,769,4,5 98,574,3,4 66,618,3,4 32,769,4,5 42,769,4,5 138,552,3,4 146,552,3,4 412,860,4,5 422,860,4,5 142,730,4,5 370,684,3,4 22,795,4,5 152,730,4,5 632,873,4,5 642,873,4,5 132,821,4,5 472,873,4,5 482,873,4,5 418,695,3,4 426,695,3,4 658,706,3,4 666,706,3,4 458,464,3,4 466,464,3,4 634,684,3,4 642,684,3,4 626,673,3,4 122,795,4,5 482,782,4,5 114,651,3,4 212,834,4,5 222,834,4,5 272,821,4,5 282,821,4,5 232,847,4,5 532,795,4,5 542,795,4,5 626,651,3,4 634,651,3,4 362,673,3,4 370,673,3,4 354,508,3,4 402,497,3,4 658,640,3,4 412,769,4,5 422,769,4,5 632,782,4,5 362,453,3,4 450,497,3,4 272,847,4,5 282,847,4,5 372,769,4,5 542,821,4,5 552,821,4,5 458,486,3,4 152,782,4,5 132,860,4,5 142,860,4,5 702,821,4,5 102,821,4,5 458,629,3,4 522,821,4,5 532,821,4,5 522,847,4,5 434,420,3,4 442,420,3,4 442,376,3,4 450,376,3,4 142,769,4,5 152,769,4,5 106,706,3,4 352,730,4,5 362,730,4,5 352,860,4,5 26,695,3,4 34,695,3,4 50,486,3,4 58,486,3,4 418,453,3,4 532,808,4,5 98,585,3,4 106,585,3,4 82,574,3,4 74,563,3,4 434,574,3,4 52,834,4,5 26,552,3,4 34,552,3,4 22,808,4,5 202,821,4,5 682,743,4,5 354,497,3,4 418,651,3,4 82,563,3,4 90,563,3,4 342,860,4,5 352,860,4,5 42,618,3,4 50,618,3,4 346,684,3,4 354,684,3,4 154,706,3,4 410,321,3,4 418,321,3,4 92,834,4,5 342,808,4,5 352,808,4,5 52,821,4,5 542,808,4,5 26,530,3,4 34,530,3,4 658,662,3,4 392,756,4,5 642,834,4,5 12,769,4,5 102,834,4,5 112,834,4,5 242,769,4,5 394,376,3,4 50,497,3,4 58,497,3,4 72,795,4,5 82,795,4,5 232,795,4,5 242,795,4,5",
  2: "482,769,4,5 122,860,4,5 132,860,4,5 92,782,4,5 102,782,4,5 522,756,4,5 402,508,3,4 152,834,4,5 162,834,4,5 378,431,3,4 652,821,4,5 662,821,4,5 122,673,3,4 130,673,3,4 12,795,4,5 418,607,3,4 434,651,3,4 442,651,3,4 130,640,3,4 138,640,3,4 354,706,3,4 362,706,3,4 386,365,3,4 394,365,3,4 372,730,4,5 58,585,3,4 66,585,3,4 392,730,4,5 650,706,3,4 58,717,3,4 146,585,3,4 418,541,3,4 426,541,3,4 522,808,4,5 466,640,3,4 462,730,4,5 472,730,4,5 352,860,4,5 362,860,4,5 22,717,4,5 32,717,4,5 394,574,3,4 402,574,3,4 72,808,4,5 82,808,4,5 378,420,3,4 98,574,3,4 402,706,3,4 450,618,3,4 42,730,4,5 492,795,4,5 502,795,4,5 402,834,4,5 466,552,3,4 672,769,4,5 682,769,4,5 138,530,3,4 42,607,3,4 542,743,4,5 402,563,3,4 410,563,3,4 492,834,4,5 502,834,4,5 426,607,3,4 434,607,3,4 692,730,4,5 702,730,4,5 242,730,4,5 42,640,3,4 378,706,3,4 386,706,3,4 642,808,4,5 434,354,3,4 154,695,3,4 162,695,3,4 412,756,4,5 346,497,3,4 354,497,3,4 542,769,4,5 552,769,4,5 690,684,3,4 342,743,4,5 352,743,4,5 362,730,4,5 132,873,4,5 370,618,3,4 450,387,3,4 458,387,3,4 382,847,4,5 382,782,4,5 392,782,4,5 426,552,3,4 418,343,3,4 426,343,3,4 66,563,3,4 74,563,3,4 378,574,3,4 386,574,3,4 34,541,3,4 42,541,3,4 482,695,3,4 442,795,4,5 452,795,4,5 18,607,3,4 474,662,3,4 410,464,3,4 418,464,3,4 502,860,4,5 432,808,4,5 466,475,3,4 432,769,4,5 386,552,3,4 212,743,4,5 222,743,4,5 410,552,3,4 12,782,4,5 242,756,4,5 50,596,3,4 58,596,3,4 466,563,3,4",
  3: "114,651,3,4 122,651,3,4 42,508,3,4 338,717,3,4 42,808,4,5 74,717,3,4 82,717,3,4 412,860,4,5 422,860,4,5 410,574,3,4 418,574,3,4 434,354,3,4 442,354,3,4 432,717,4,5 442,717,4,5 410,706,3,4 418,706,3,4 12,743,4,5 442,409,3,4 418,673,3,4 666,706,3,4 674,706,3,4 642,673,3,4 362,585,3,4 370,585,3,4 114,684,3,4 58,695,3,4 66,695,3,4 642,706,3,4 202,782,4,5 212,782,4,5 412,821,4,5 422,821,4,5 370,420,3,4 130,695,3,4 672,730,4,5 682,730,4,5 462,808,4,5 472,808,4,5 642,795,4,5 462,769,4,5 490,706,3,4 498,706,3,4 138,662,3,4 146,662,3,4 102,743,4,5 90,618,3,4 62,808,4,5 74,651,3,4 632,808,4,5 642,808,4,5 386,332,3,4 394,332,3,4 418,464,3,4 658,662,3,4 472,860,4,5 114,552,3,4 650,695,3,4 92,743,4,5 102,743,4,5 312,821,4,5 322,821,4,5 432,821,4,5 442,821,4,5 10,662,3,4 18,662,3,4 426,607,3,4 642,782,4,5 652,782,4,5 18,541,3,4 418,563,3,4 62,873,4,5 612,756,4,5 532,795,4,5 542,795,4,5 72,834,4,5 82,834,4,5 152,717,4,5 162,717,4,5 74,607,3,4 492,847,4,5 502,847,4,5 452,769,4,5 462,769,4,5 672,756,4,5 682,756,4,5 114,563,3,4 122,563,3,4 346,563,3,4 282,860,4,5 712,834,4,5 92,821,4,5 102,821,4,5 482,782,4,5 450,541,3,4 410,376,3,4 362,442,3,4 74,673,3,4 82,673,3,4 352,730,4,5 362,730,4,5 362,563,3,4 58,673,3,4 622,808,4,5 426,332,3,4",
  4: "552,873,4,5 562,873,4,5 102,795,4,5 610,651,3,4 512,873,4,5 650,629,3,4 658,629,3,4 418,706,3,4 482,743,4,5 138,640,3,4 450,574,3,4 458,574,3,4 434,541,3,4 502,756,4,5 18,695,3,4 26,673,3,4 130,662,3,4 434,662,3,4 114,530,3,4 122,530,3,4 362,717,4,5 490,662,3,4 442,486,3,4 682,673,3,4 152,834,4,5 692,860,4,5 458,420,3,4 492,795,4,5 152,795,4,5 162,795,4,5 102,821,4,5 542,860,4,5 450,651,3,4 458,651,3,4 418,640,3,4 672,795,4,5 50,706,3,4 418,607,3,4 426,607,3,4 50,486,3,4 634,684,3,4 42,730,4,5 42,618,3,4 50,618,3,4 434,706,3,4 442,706,3,4 492,717,4,5 92,782,4,5 102,782,4,5 466,486,3,4 652,860,4,5 474,552,3,4 66,640,3,4 466,585,3,4 702,808,4,5 712,808,4,5 698,706,3,4 74,530,3,4 82,530,3,4 370,706,3,4 52,795,4,5 62,795,4,5 362,585,3,4 42,508,3,4 442,398,3,4 472,795,4,5 692,808,4,5 702,808,4,5 466,464,3,4 62,860,4,5 58,563,3,4 154,618,3,4 642,684,3,4 650,673,3,4 658,673,3,4 458,453,3,4 466,453,3,4 426,552,3,4 434,552,3,4 434,464,3,4 442,464,3,4 50,717,3,4 58,717,3,4 426,354,3,4 146,574,3,4 154,574,3,4 370,552,3,4 552,847,4,5 562,847,4,5 458,398,3,4 466,398,3,4 50,574,3,4 58,574,3,4 26,695,3,4 42,706,3,4",
};

type Win = { x: number; y: number; w: number; h: number; c: number };
const TONES = ["#FFB347", "#FFD27A", "#FF9E5E", "#FFC266", "#CFEFFF"];
const parsed: Record<number, Win[][][]> = {};
function windows(tier: number): Win[][][] {
  if (parsed[tier]) return parsed[tier];
  // [район][подшаг 0..2] — подшаг даёт небольшой разброс внутри района
  const out: Win[][][] = Array.from({ length: DISTRICTS }, () => [[], [], []]);
  (WINS[tier] ?? WINS[1]).split(" ").forEach((s, i) => {
    const [x, y, w, h] = s.split(",").map(Number);
    const c = i % 11 === 5 ? 4 : (i * 7) % 4;
    out[district(x)][(i * 5) % 3].push({ x, y, w, h, c });
  });
  return (parsed[tier] = out);
}

export function CityDuskSun({ tier, clip }: { tier: number; clip: string }) {
  const m = `url(${SKY[tier] ?? SKY[1]})`;
  return (
    <>
      <i className="dk-sun" style={{ maskImage: m, WebkitMaskImage: m }} />
      <i className="dk-rim" style={{ clipPath: clip }} />
    </>
  );
}

export function CityDuskGlass({ clip }: { clip: string }) {
  return <i className="dk-face" style={{ clipPath: clip }} />;
}

export function CityDuskLights({ tier }: { tier: number }) {
  const host = useRef<SVGSVGElement>(null);
  // до первой отрисовки: район 0 ещё тёмный, дальше — по таймеру; разметка снимается в конце и при выходе
  useLayoutEffect(() => {
    const root = host.current?.closest<HTMLElement>(".cv2");
    if (!root || blocked()) return;
    const timers: number[] = [];
    root.dataset.lit = "0";
    for (let k = 1; k <= DISTRICTS; k++) {
      timers.push(
        window.setTimeout(() => {
          // свернули приложение посреди волны — просто зажигаем всё
          root.dataset.lit = blocked() ? String(DISTRICTS) : String(k);
        }, 500 + (k - 1) * STEP),
      );
    }
    timers.push(window.setTimeout(() => delete root.dataset.lit, 500 + (DISTRICTS - 1) * STEP + TAIL));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      delete root.dataset.lit;
    };
  }, [tier]);

  const groups = windows(tier);
  return (
    <svg ref={host} className="dk-win" viewBox="0 0 720 1280" preserveAspectRatio="none" aria-hidden>
      {groups.map((subs, d) =>
        subs.map((ws, s) => (
          <g key={`${d}-${s}`} data-d={d} className={`s${s}`}>
            {ws.map((w, i) => (
              <g key={i} fill={TONES[w.c]}>
                <rect className="hl" x={w.x - 2} y={w.y - 2} width={w.w + 4} height={w.h + 4} rx={2} />
                <rect x={w.x} y={w.y} width={w.w} height={w.h} />
              </g>
            ))}
          </g>
        )),
      )}
    </svg>
  );
}

const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
const still = () =>
  document.documentElement.classList.contains("low-end") ||
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** звёзды: "x,y,размер" в кадре 720×1280 — только верх неба (у всех обликов там небо), за облаками и башней */
const STARS = "327,139,2 327,204,1 143,129,3 438,58,2 225,38,3 453,147,2 680,160,2 588,32,1 37,119,2 19,36,3 207,234,1 503,86,1 369,24,2 97,71,1 16,206,2 85,233,1 420,199,1 663,61,2 306,41,1 655,230,1 156,22,1 262,86,1"
  .split(" ")
  .map((t) => t.split(",").map(Number));
const MOON = { x: 600, y: 140, d: 22 };

export function CityDuskStars() {
  const host = useRef<HTMLDivElement>(null);
  // вечер наступил / приложение открыли вечером: звёзды проступают за ~10 с (разово)
  useEffect(() => {
    const h = host.current;
    if (!h || blocked()) return;
    const a = h.animate([{ opacity: 0 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }], { duration: 10000, easing: "ease-in" });
    return () => a.cancel();
  }, []);
  // редкое мерцание одной звезды (разовое)
  useRare([5000, 10000], [6000, 14000], () => {
    const st = host.current?.querySelectorAll<HTMLElement>(".st");
    if (!st?.length) return;
    const e = st[Math.floor(Math.random() * st.length)];
    e.animate(
      [{ transform: "scale(1)" }, { transform: "scale(2.1)", opacity: 1, offset: 0.35 }, { transform: "scale(1)" }],
      { duration: 1100, easing: "ease-in-out" },
    );
  });
  return (
    <div ref={host} className="dk-stars" aria-hidden>
      {STARS.map(([x, y, k], i) => (
        <i key={i} className={`st s${k}`} style={{ left: pc(x, W), top: pc(y, H) }} />
      ))}
      <i className="moon" style={{ left: pc(MOON.x - MOON.d / 2, W), top: pc(MOON.y - MOON.d / 2, H), width: pc(MOON.d, W) }}>
        <b />
      </i>
    </div>
  );
}

/** дальние эстакады: [x1, y1, x2, y2] в кадре 720×1280 — в просвете между левым кварталом и башней */
const DECKS: [number, number, number, number][] = [
  [178, 842, 314, 827],
  [212, 914, 304, 905],
];
const POOL = 8; // машин на полосу
type Lane = "hd" | "tl";

export function CityDuskTraffic() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const timers: number[] = [];
    const anims = new Set<Animation>();
    let frozen = false;
    const cars = (d: number, l: Lane) => Array.from(h.querySelectorAll<HTMLElement>(`.dk-road[data-k="${d}"] .car.${l}`));
    // статичная картинка: машины расставлены по полосе
    const freeze = (on: boolean) => {
      if (frozen === on) return;
      frozen = on;
      h.classList.toggle("still", on);
      DECKS.forEach((_, d) =>
        (["hd", "tl"] as Lane[]).forEach((l, li) =>
          cars(d, l).forEach((c, i) => {
            c.style.transform = on ? `translate3d(${(((i + li * 0.5) / POOL) * 100 - 4).toFixed(1)}%,0,0)` : "";
          }),
        ),
      );
    };
    const lane = (d: number, l: Lane) => {
      const len = Math.hypot(DECKS[d][2] - DECKS[d][0], DECKS[d][3] - DECKS[d][1]);
      const tick = () => {
        if (still()) {
          freeze(true);
          return void timers.push(window.setTimeout(tick, 3000));
        }
        freeze(false);
        if (blocked()) return void timers.push(window.setTimeout(tick, 2000)); // скрыто — новые не выезжают
        const c = cars(d, l).find((e) => !e.getAnimations().length);
        if (c) {
          const [a, b] = l === "hd" ? ["100%", "-12%"] : ["-12%", "100%"];
          const an = c.animate(
            [
              { transform: `translate3d(${a},0,0)`, opacity: 0 },
              { opacity: 1, offset: 0.08 },
              { opacity: 1, offset: 0.92 },
              { transform: `translate3d(${b},0,0)`, opacity: 0 },
            ],
            { duration: (len / rnd(30, 44)) * 1000, easing: "linear" },
          );
          anims.add(an);
          an.onfinish = () => anims.delete(an);
        }
        timers.push(window.setTimeout(tick, rnd(300, 850)));
      };
      timers.push(window.setTimeout(tick, rnd(200, 900)));
    };
    DECKS.forEach((_, d) => (["hd", "tl"] as Lane[]).forEach((l) => lane(d, l)));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      anims.forEach((a) => a.cancel());
    };
  }, []);
  return (
    <div ref={host} className="dk-traffic" aria-hidden>
      {DECKS.map(([x1, y1, x2, y2], d) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        return (
          <div
            key={d}
            className="dk-road"
            data-k={d}
            style={{ left: pc(x1, W), top: pc(y1 - 5, H), width: pc(len, W), transform: `rotate(${ang.toFixed(2)}deg)`, ["--a" as string]: `${ang.toFixed(2)}deg` }}
          >
            <i className="pil" style={{ left: "26%" }} />
            <i className="pil" style={{ left: "70%" }} />
            <i className="deck" />
            {(["hd", "tl"] as Lane[]).flatMap((l) => Array.from({ length: POOL }, (_, i) => <i key={l + i} className={`car ${l}`} />))}
          </div>
        );
      })}
    </div>
  );
}

/** отражения на мокрой площади: x центра, ширина (кадр 720×1280), цвет, с какого облика */
type Refl = { x: number; w: number; c: "sun" | "cy" | "mg" | "am"; from: number };
const REFL: Refl[] = [
  { x: 545, w: 96, c: "sun", from: 1 }, // дорожка заходящего солнца
  { x: 150, w: 26, c: "am", from: 1 }, // тёплые окна
  { x: 300, w: 22, c: "mg", from: 1 },
  { x: 655, w: 22, c: "am", from: 1 },
  { x: 92, w: 34, c: "cy", from: 2 }, // «ОБМЕН»
  { x: 466, w: 34, c: "cy", from: 2 }, // «TON»
  { x: 612, w: 46, c: "mg", from: 4 }, // «РЕАКТОР»
];
const WET_TOP = 1008;
const WET_H = 236;

/**
 * Шаг 4 (dusk): мокрая площадь отражает закат и неон. Статичные градиенты-дорожки под солнцем, вывесками и
 * окнами, разбитые на рябь маской; в дождь рябь крупнее и дорожки бледнее, в ясный вечер (без дождя) —
 * ровнее и ярче. Редко одна дорожка разово «дрожит» (WAAPI, 1.8 с, таймер); бесконечных анимаций нет.
 * Слабое устройство, «уменьшить движение», скрытое приложение — только статичные отражения.
 */
export function CityDuskWet({ tier }: { tier: number }) {
  const host = useRef<HTMLDivElement>(null);
  useRare([4000, 8000], [5000, 11000], () => {
    const all = host.current?.querySelectorAll<HTMLElement>(".rf");
    if (!all?.length) return;
    const el = all[Math.floor(Math.random() * all.length)];
    if (el.getAnimations().length) return;
    el.animate(
      [
        { transform: "scaleX(1)", opacity: 1 },
        { transform: "scaleX(1.18) translateX(1%)", opacity: 0.72, offset: 0.35 },
        { transform: "scaleX(.94)", opacity: 0.9, offset: 0.7 },
        { transform: "scaleX(1)", opacity: 1 },
      ],
      { duration: 1800, easing: "ease-in-out" },
    );
  });
  return (
    <div ref={host} className="dk-wet" aria-hidden>
      {REFL.filter((r) => tier >= r.from).map((r, i) => (
        <i
          key={i}
          className={`rf ${r.c}`}
          style={{ left: pc(r.x - r.w / 2, W), top: pc(WET_TOP, H), width: pc(r.w, W), height: pc(WET_H, H) }}
        />
      ))}
    </div>
  );
}
