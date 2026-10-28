import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Жизнь светлого неба (daycity, шаг 3; DESIGN.md п. 12.1). Только на рассвете и днём (монтирует CityV2).
 * - CityGlint — редкий солнечный блик проходит по стеклу башни (клип по силуэту).
 * - CitySky — изредка через небо летит стайка птиц или курьерский дрон с посылкой.
 * Ни одной бесконечной анимации: редкие конечные WAAPI-проходы по таймеру. Скрытое приложение, слабое
 * устройство, «уменьшить движение», экран здания — ничего не запускается.
 * `?sky=now` — частые проходы для проверки.
 */

export function blocked(): boolean {
  const c = document.documentElement.classList;
  if (document.hidden || c.contains("app-hidden") || c.contains("low-end") || c.contains("in-bld")) return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const testing = () => new URLSearchParams(location.search).get("sky") === "now";

/** Цикл редких событий: первое через first, дальше через every; пропускает ход, если сейчас нельзя. */
export function useRare(first: [number, number], every: [number, number], fire: () => void) {
  const f = useRef(fire);
  f.current = fire;
  useEffect(() => {
    const now = testing();
    let t = 0;
    const plan = (ms: number) => {
      t = window.setTimeout(() => {
        if (!blocked()) f.current();
        plan(now ? 6000 : rnd(every[0], every[1]));
      }, ms);
    };
    plan(now ? 1200 : rnd(first[0], first[1]));
    return () => window.clearTimeout(t);
  }, []);
}

export function CityGlint({ clip }: { clip: string }) {
  const band = useRef<HTMLElement>(null);
  useRare([5000, 11000], [18000, 34000], () => {
    const b = band.current;
    const stage = b?.parentElement;
    if (!b || !stage) return;
    const w = stage.clientWidth;
    b.animate(
      [
        { transform: `translate3d(${w * 0.22}px,0,0) skewX(-14deg)`, opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { opacity: 1, offset: 0.65 },
        { transform: `translate3d(${w * 0.64}px,0,0) skewX(-14deg)`, opacity: 0 },
      ],
      { duration: rnd(1300, 1800), easing: "cubic-bezier(.45,0,.35,1)" },
    );
  });
  return (
    <i className="glint" style={{ clipPath: clip }}>
      <b ref={band} />
    </i>
  );
}

type Flight = { id: number; kind: "birds" | "drone"; y: number; ltr: boolean; dur: number; n: number };

// стайка: «галочки» разной величины, клином
const BIRDS: [number, number, number][] = [
  [0, 10, 1], [14, 4, 0.85], [15, 17, 0.9], [29, 0, 0.75], [30, 22, 0.8], [44, 9, 0.7], [46, 27, 0.65],
];

export function CitySky() {
  const host = useRef<HTMLDivElement>(null);
  const [fl, setFl] = useState<Flight | null>(null);
  const seq = useRef(0);

  useRare([7000, 15000], [28000, 55000], () => {
    if (fl) return;
    const drone = Math.random() < 0.3;
    setFl({
      id: ++seq.current,
      kind: drone ? "drone" : "birds",
      y: drone ? rnd(14, 24) : rnd(10, 28),
      ltr: Math.random() < 0.6,
      dur: drone ? rnd(11000, 15000) : rnd(13000, 19000),
      n: drone ? 1 : 4 + Math.floor(Math.random() * 4),
    });
  });

  useEffect(() => {
    const el = host.current?.querySelector<HTMLElement>(".fly");
    const stage = host.current?.parentElement;
    if (!fl || !el || !stage) return;
    const w = stage.clientWidth;
    const from = fl.ltr ? -0.16 * w : 1.06 * w;
    const to = fl.ltr ? 1.06 * w : -0.16 * w;
    const sx = fl.ltr ? 1 : -1;
    const lift = rnd(-0.05, 0.03) * stage.clientHeight;
    const a = el.animate(
      [
        { transform: `translate3d(${from}px,0,0) scaleX(${sx})` },
        { transform: `translate3d(${(from + to) / 2}px,${lift * 0.6}px,0) scaleX(${sx})` },
        { transform: `translate3d(${to}px,${lift}px,0) scaleX(${sx})` },
      ],
      { duration: fl.dur, easing: "linear" },
    );
    // взмахи крыльев — конечное число повторов на время пролёта, у каждой птицы свой сдвиг
    const flaps = Array.from(el.querySelectorAll<SVGGElement>("g")).map((g, i) =>
      g.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(-.35)" }, { transform: "scaleY(1)" }], {
        duration: 420 + i * 23,
        delay: i * 90,
        iterations: Math.floor(fl.dur / 450),
        easing: "ease-in-out",
      }),
    );
    // дрон чуть покачивается — тоже конечное число раз
    const bob =
      fl.kind === "drone"
        ? el.querySelector<HTMLElement>("i")?.animate(
            [{ transform: "translateY(0)" }, { transform: "translateY(-30%)" }, { transform: "translateY(0)" }],
            { duration: 1800, iterations: Math.floor(fl.dur / 1800), easing: "ease-in-out" },
          )
        : undefined;
    a.onfinish = () => setFl(null);
    return () => {
      a.cancel();
      flaps.forEach((f) => f.cancel());
      bob?.cancel();
    };
  }, [fl]);

  return (
    <div ref={host} className="sky" aria-hidden>
      {fl && (
        <div key={fl.id} className={`fly ${fl.kind}`} style={{ top: `${fl.y}%` } as CSSProperties}>
          {fl.kind === "drone" ? (
            <i />
          ) : (
            <svg viewBox="-2 -6 64 40">
              {BIRDS.slice(0, fl.n).map(([x, y, s], i) => (
                <g key={i} style={{ transformOrigin: `${x + 6 * s}px ${y}px`, transformBox: "view-box" } as CSSProperties}>
                  <path
                    d={`M${x} ${y - 2 * s} Q${x + 3 * s} ${y - 4 * s} ${x + 6 * s} ${y} Q${x + 9 * s} ${y - 4 * s} ${x + 12 * s} ${y - 2 * s}`}
                    strokeWidth={1.5 * s}
                  />
                </g>
              ))}
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
