import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Редкая молния ночью (DESIGN.md п. 12.1). Раз в 25–60 с, случайно, в небе вспыхивает
 * короткий разряд, и весь город на миг освещается: яркая вспышка, одна-две вспышки послабее,
 * затем всё гаснет за ~1.3 с. Это один слой поверх кадра: свет и разряд, только `opacity`.
 * Анимация разовая (Web Animations), бесконечных циклов нет. Новая форма разряда рисуется
 * до вспышки, сам разряд не перерисовывается.
 *
 * Выключено:
 * - при «уменьшить движение» и на слабом устройстве;
 * - пока приложение скрыто;
 * - во время наезда на здание и внутри здания;
 * - в любой фазе, кроме ночи (компонент рисуется только ночью).
 *
 * ?lightning=now — первый разряд через ~1.5 с (для проверки; потом обычный ритм).
 */
const W = 720;
const H = 1280;
const MIN_GAP = 25_000;
const MAX_GAP = 60_000;
const DUR = 1400;

// свет: резкая вспышка → провал → вторая вспышка → отсвет → затухание
const FLASH: Keyframe[] = [
  { opacity: 0, offset: 0 },
  { opacity: 1, offset: 0.03 },
  { opacity: 0.22, offset: 0.08 },
  { opacity: 0.8, offset: 0.12 },
  { opacity: 0.3, offset: 0.19 },
  { opacity: 0.5, offset: 0.25, easing: "cubic-bezier(.3,0,.2,1)" },
  { opacity: 0, offset: 1 },
];
// разряд: виден только в пиках вспышки
const BOLT: Keyframe[] = [
  { opacity: 0, offset: 0 },
  { opacity: 1, offset: 0.025 },
  { opacity: 0.1, offset: 0.075 },
  { opacity: 1, offset: 0.115 },
  { opacity: 0.15, offset: 0.18 },
  { opacity: 0.7, offset: 0.24 },
  { opacity: 0, offset: 0.42 },
  { opacity: 0, offset: 1 },
];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** ломаная от (x, y) вниз до глубины y1; отклонение тянет к x1 */
function zig(x: number, y: number, x1: number, y1: number, step: [number, number], jag: number): string {
  let d = `M${x.toFixed(0)} ${y.toFixed(0)}`;
  while (y < y1) {
    y = Math.min(y1, y + rnd(step[0], step[1]));
    x += (x1 - x) * 0.18 + rnd(-jag, jag);
    d += `L${x.toFixed(0)} ${y.toFixed(0)}`;
  }
  return d;
}

type Strike = { d: string; cx: number; cy: number };

/** новый разряд: левая полоса неба (между левыми башнями и реактором) или правая */
function newStrike(): Strike {
  const left = Math.random() < 0.45;
  const x0 = left ? rnd(190, 290) : rnd(545, 680);
  const x1 = left ? rnd(180, 300) : rnd(530, 700);
  const y1 = rnd(530, 610);
  let d = zig(x0, -20, x1, y1, [14, 30], 13);
  // одна-две ветки из середины ствола
  const pts = d.match(/L(\d+) (\d+)/g)?.map((s) => s.slice(1).split(" ").map(Number)) ?? [];
  const n = Math.random() < 0.5 ? 1 : 2;
  for (let i = 0; i < n && pts.length > 6; i++) {
    const [bx, by] = pts[Math.floor(rnd(0.3, 0.65) * pts.length)];
    const dir = Math.random() < 0.5 ? -1 : 1;
    d += zig(bx, by, bx + dir * rnd(50, 90), by + rnd(70, 130), [10, 22], 8);
  }
  return { d, cx: (x0 + x1) / 2, cy: y1 * 0.62 };
}

function blocked(): boolean {
  const c = document.documentElement.classList;
  if (document.hidden || c.contains("app-hidden") || c.contains("low-end") || c.contains("in-bld")) return true;
  if (["bz-hide", "bz-in", "bz-fade", "bz-back", "bz-snap"].some((k) => c.contains(k))) return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function CityLightning() {
  const [strike, setStrike] = useState<Strike>(newStrike);
  const flashRef = useRef<HTMLDivElement>(null);
  const boltRef = useRef<SVGSVGElement>(null);
  const fire = useRef(false);

  useEffect(() => {
    let t = 0;
    const now = new URLSearchParams(location.search).get("lightning") === "now";
    const plan = (ms: number) => {
      t = window.setTimeout(() => {
        if (!blocked()) {
          fire.current = true;
          setStrike(newStrike()); // форма и центр света — до вспышки; вспышка — после отрисовки
        }
        plan(rnd(MIN_GAP, MAX_GAP));
      }, ms);
    };
    plan(now ? 1500 : rnd(MIN_GAP, MAX_GAP));
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!fire.current) return;
    fire.current = false;
    flashRef.current?.animate(FLASH, { duration: DUR, easing: "linear" });
    boltRef.current?.animate(BOLT, { duration: DUR, easing: "linear" });
  }, [strike]);

  const vars = { "--lx": `${((strike.cx / W) * 100).toFixed(1)}%`, "--ly": `${((strike.cy / H) * 100).toFixed(1)}%` } as CSSProperties;
  return (
    <div className="ltn" aria-hidden style={vars}>
      <div className="ltn-flash" ref={flashRef} />
      <svg className="ltn-bolt" ref={boltRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="ltn-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".38" stopColor="#fff" />
            <stop offset=".48" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="ltn-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
            <rect width={W} height={H} fill="url(#ltn-fade)" />
          </mask>
        </defs>
        <g mask="url(#ltn-mask)" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d={strike.d} className="g2" />
          <path d={strike.d} className="g1" />
          <path d={strike.d} className="core" />
        </g>
      </svg>
    </div>
  );
}
