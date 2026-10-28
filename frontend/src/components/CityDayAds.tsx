import { useEffect, useRef, useState } from "react";
import { blocked, rnd } from "./CityDaySky";

/**
 * Дневная голо-реклама и ясная погода (daycity, шаг 5; DESIGN.md п. 12.1). CityAds монтируется только на рассвете и днём.
 * - CityAds — две небольшие светлые панели на фасадах со сменой слайдов по JS-таймеру (раз в 7–10 с, плавная
 *   смена прозрачности через CSS transition). Скрытое приложение, слабое устройство, «уменьшить движение» —
 *   слайд не меняется.
 * - CityPuddles — в ясный день и ясный вечер: отражения неба (вечером — заката) в лужах и редкие блики (разовые WAAPI-вспышки).
 * Бесконечных анимаций нет.
 */

type Ad = { x: number; y: number; w: number; h: number; slides: [string, string][] };
const ADS: Ad[] = [
  { x: 168, y: 656, w: 92, h: 44, slides: [["SKY TRAM", "next 4 min"], ["SOLAR GRID", "98% clean"], ["NEXUS AIR", "fresh 21°"]] },
  { x: 96, y: 872, w: 92, h: 42, slides: [["ORBIT TEA", "fresh brew"], ["SKYPORT", "gate 7 open"], ["NEXUS PAY", "tap & go"]] },
];
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;

function AdPanel({ ad, delay }: { ad: Ad; delay: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let t = 0;
    const plan = (ms: number) => {
      t = window.setTimeout(() => {
        if (!blocked()) setN((v) => (v + 1) % ad.slides.length);
        plan(rnd(7000, 10000));
      }, ms);
    };
    plan(delay);
    return () => window.clearTimeout(t);
  }, [ad, delay]);
  return (
    <b className="ad" style={{ left: pc(ad.x, W), top: pc(ad.y, H), width: pc(ad.w, W), height: pc(ad.h, H) }}>
      {ad.slides.map(([t, s], i) => (
        <span key={t} className={i === n ? "on" : undefined}>
          {t}
          <small>{s}</small>
        </span>
      ))}
    </b>
  );
}

export function CityAds() {
  return (
    <>
      {ADS.map((ad, i) => (
        <AdPanel key={i} ad={ad} delay={i ? 9500 : 6000} />
      ))}
    </>
  );
}

// блики в лужах на площади: x, y в пикселях кадра, размер
const GLINTS: [number, number, number][] = [
  [128, 1030, 1], [252, 1062, 0.8], [398, 1040, 1.1], [522, 1080, 0.9], [604, 1028, 0.8],
  [326, 1098, 1], [470, 1012, 0.7], [170, 1092, 0.9], [560, 1112, 1],
];
// лужи — мягкие отражения неба: x, y, ширина, высота
const POOLS: [number, number, number, number][] = [
  [70, 1016, 200, 32], [330, 1030, 170, 26], [470, 1064, 200, 36], [190, 1080, 220, 34],
];

export function CityPuddles() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let t = 0;
    const plan = (ms: number) => {
      t = window.setTimeout(() => {
        const gl = host.current?.querySelectorAll<HTMLElement>(".pg");
        if (gl?.length && !blocked()) {
          const g = gl[Math.floor(Math.random() * gl.length)];
          if (!g.getAnimations().length)
            g.animate(
              [
                { opacity: 0.4, transform: "scale(.7)" },
                { opacity: 1, transform: "scale(1.15)", offset: 0.4 },
                { opacity: 0.4, transform: "scale(.7)" },
              ],
              { duration: rnd(900, 1400), easing: "ease-in-out" },
            );
        }
        plan(rnd(1400, 3200));
      }, ms);
    };
    plan(1500);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={host} className="pdl" aria-hidden>
      {POOLS.map(([x, y, w, h], i) => (
        <i key={`p${i}`} className="pool" style={{ left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(h, H) }} />
      ))}
      {GLINTS.map(([x, y, s], i) => (
        <i key={`g${i}`} className="pg" style={{ left: pc(x, W), top: pc(y, H), width: pc(54 * s, W) }} />
      ))}
    </div>
  );
}
