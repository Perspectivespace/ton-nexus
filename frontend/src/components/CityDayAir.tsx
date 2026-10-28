import { useEffect, useRef } from "react";
import { blocked, rnd, useRare } from "./CityDaySky";

/**
 * Воздух светлого неба (daycity, шаг 4; DESIGN.md п. 12.1). Монтирует CityV2 только на рассвете и днём.
 * - CityClouds — 3 мягких облака (градиенты, без картинок) медленно плывут по небу за башней. Каждый проход —
 *   конечная WAAPI-анимация на 2,5–4 мин; следующий запускает onfinish. Бесконечных анимаций нет.
 * - CityCloudShade — изредка (раз в 30–60 с) по кварталам проходит мягкая тень облака (разовый проход).
 * - CityMorningFog — утренний туман у земли: на рассвете за первые ~10 с редеет до лёгкой дымки,
 *   с переходом рассвета в день тает совсем (CSS transition).
 * Слабое устройство и «уменьшить движение»: облака и туман статичны, тени не ходят.
 */

// облака: [top %, ширина %, стартовая позиция 0..1 по проходу, длительность прохода, с]
const CLOUDS: [number, number, number, number][] = [
  [9, 46, 0.42, 230],
  [17, 34, 0.62, 180],
  [27, 26, 0.4, 150],
];

export function CityClouds() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = Array.from(host.current?.querySelectorAll<HTMLElement>(".cloud") ?? []);
    const stage = host.current;
    if (!stage || blocked()) return;
    const anims: Animation[] = [];
    const timers: number[] = [];
    const run = (el: HTMLElement, i: number, start: number) => {
      const w = stage.clientWidth;
      const [, cw, , dur] = CLOUDS[i];
      el.style.left = "0"; // дальше положение ведёт transform
      const from = -(cw / 100) * w;
      const to = w;
      const a = el.animate([{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }], {
        duration: dur * 1000 * rnd(0.9, 1.1),
        easing: "linear",
        fill: "both",
      });
      a.currentTime = start * (a.effect?.getTiming().duration as number);
      a.onfinish = () => {
        const again = () => (blocked() ? timers.push(window.setTimeout(again, 5000)) : run(el, i, 0));
        again();
      };
      anims[i] = a;
    };
    els.forEach((el, i) => run(el, i, CLOUDS[i][2]));
    return () => {
      anims.forEach((a) => a?.cancel());
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return (
    <div ref={host} className="clouds" aria-hidden>
      {CLOUDS.map(([top, w, start], i) => (
        // статичное положение (слабое устройство / «уменьшить движение») = стартовая точка прохода
        <i key={i} className={`cloud k${i}`} style={{ top: `${top}%`, width: `${w}%`, left: `${start * (100 + w) - w}%` }} />
      ))}
    </div>
  );
}

export function CityCloudShade() {
  const el = useRef<HTMLElement>(null);
  useRare([9000, 18000], [30000, 60000], () => {
    const s = el.current;
    const stage = s?.parentElement;
    if (!s || !stage || s.getAnimations().length) return; // предыдущая тень ещё идёт
    const w = stage.clientWidth;
    const ltr = Math.random() < 0.6;
    const a = -0.9 * w;
    const b = 1.1 * w;
    s.animate(
      [
        { transform: `translate3d(${ltr ? a : b}px,0,0)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { opacity: 1, offset: 0.75 },
        { transform: `translate3d(${ltr ? b : a}px,0,0)`, opacity: 0 },
      ],
      { duration: rnd(14000, 20000), easing: "linear" },
    );
  });
  return <i ref={el} className="shade" />;
}

export function CityMorningFog({ phase }: { phase: string }) {
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    const f = el.current;
    if (!f || phase !== "dawn" || blocked()) return;
    // плотный туман при открытии экрана, за ~10 с редеет до лёгкой дымки (конечная анимация, без fill:
    // в конце совпадает со статичным CSS-состоянием)
    const a = f.animate(
      [
        { opacity: 1, transform: "translate3d(0,0,0)" },
        { opacity: 0.32, transform: "translate3d(0,3%,0)" },
      ],
      { duration: 10000, easing: "cubic-bezier(.3,0,.4,1)" },
    );
    return () => a.cancel();
  }, [phase]);
  return <i ref={el} className="mfog" />;
}
