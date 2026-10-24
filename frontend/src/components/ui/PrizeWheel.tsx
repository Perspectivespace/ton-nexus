import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from "react";
import { BrandMark } from "@/components/Brand";
import { haptic } from "@/lib/haptics";
import { cx, prefersReducedMotion } from "./press";

/** Роль сектора — цвет по п. 2.1: натрий — награды (hot — редкая), циан — TON, маджента — запрет, сталь — опыт, пусто — тёмный */
export type WheelRole = "hot" | "amber" | "neon" | "magenta" | "steel" | "void";
export type WheelSector = { id: string; title: string; sub?: string; role: WheelRole };

export type PrizeWheelHandle = {
  /** докрутить до сектора index; промис — когда колесо встало. instant — без анимации */
  spinTo: (index: number, opts?: { instant?: boolean }) => Promise<void>;
  /** тап по экрану — сразу к концу */
  skip: () => void;
};

type Props = {
  sectors: readonly WheelSector[];
  /** горящий сектор-выигрыш (после остановки) */
  winIndex?: number | null;
  spinning?: boolean;
  className?: string;
};

const C = 160;
const R = 134; // диск
const R_IN = 38; // под ступицей
const TURNS = 5;
const DUR = 3000;
const TICKS = Array.from({ length: 64 }, (_, i) => i);
const OCT = (() => {
  const s = 320;
  const k = 86; // срез восьмигранника
  return `${k},2 ${s - k},2 ${s - 2},${k} ${s - 2},${s - k} ${s - k},${s - 2} ${k},${s - 2} 2,${s - k} 2,${k}`;
})();
const OCT_IN = (() => {
  const k = 82;
  return `${k},10 ${320 - k},10 310,${k} 310,${320 - k} ${320 - k},310 ${k},310 10,${320 - k} 10,${k}`;
})();
const RIVETS: [number, number][] = [[47, 47], [273, 47], [273, 273], [47, 273]];

const pt = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
function wedge(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}
function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
/** уверенное торможение: быстрый старт, длинный мягкий доезд */
const ease = (p: number) => 1 - Math.pow(1 - p, 4);

/**
 * Колесо удачи — герой экрана «Колесо» (DESIGN.md, п. 8.3).
 * Восьмигранная металлическая плита, хромовый обод с 64 рисками, диск из секторов по ролям цвета,
 * неоновая трубка по краю каждого сектора, горящий указатель, хромовая ступица со знаком «Печать».
 * Крутится только диск и только через transform: одно вращение с торможением, щелчок (selection) на каждом секторе,
 * указатель-«язычок» отскакивает на рисках. Тап — сразу к концу, «уменьшить движение» — результат без вращения.
 * Простой «жизни» — блик, медленно идущий по ободу (transform), на паузе при скрытом приложении и во время вращения.
 */
export const PrizeWheel = forwardRef<PrizeWheelHandle, Props>(function PrizeWheel({ sectors, winIndex = null, spinning, className }, ref) {
  const u = useId().replace(/:/g, "");
  const n = sectors.length;
  const seg = 360 / n;
  const disc = useRef<HTMLDivElement>(null);
  const flap = useRef<SVGGElement>(null);
  const angle = useRef(0);
  const skipFlag = useRef(false);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const paint = (a: number, kick = 0) => {
    if (disc.current) disc.current.style.transform = `rotate(${a.toFixed(3)}deg)`;
    if (flap.current) flap.current.style.transform = `rotate(${kick.toFixed(2)}deg)`;
  };

  useImperativeHandle(
    ref,
    () => ({
      skip() {
        skipFlag.current = true;
      },
      spinTo(index, opts) {
        cancelAnimationFrame(raf.current);
        skipFlag.current = false;
        const from = angle.current;
        // сектор index встаёт под указатель, с небольшим случайным смещением внутри сектора
        const jitter = (Math.random() - 0.5) * seg * 0.5;
        const want = (((-(index * seg + jitter)) % 360) + 360) % 360;
        const delta = (((want - (from % 360)) % 360) + 360) % 360;
        const to = from + 360 * TURNS + delta;
        if (opts?.instant || prefersReducedMotion()) {
          angle.current = to;
          paint(to);
          return Promise.resolve();
        }
        return new Promise<void>((done) => {
          const t0 = performance.now();
          let edge = Math.floor((from + seg / 2) / seg);
          const step = (now: number) => {
            const p = skipFlag.current ? 1 : Math.min(1, (now - t0) / DUR);
            const a = from + (to - from) * ease(p);
            angle.current = a;
            const e = Math.floor((a + seg / 2) / seg);
            if (e !== edge) {
              edge = e;
              if (p < 1) haptic.select();
            }
            const past = (((a + seg / 2) % seg) + seg) % seg; // градусов после последней риски
            paint(a, p < 1 ? -14 * Math.exp(-past / 5) : 0);
            if (p < 1) raf.current = requestAnimationFrame(step);
            else done();
          };
          raf.current = requestAnimationFrame(step);
        });
      },
    }),
    [seg],
  );

  const won = winIndex != null && winIndex >= 0;

  return (
    <div className={cx("pw", spinning && "is-spinning", won && "is-won", className)}>
      {/* 1. плита-восьмигранник, обод с рисками, заклёпки */}
      <svg className="pw-l" viewBox="0 0 320 320" aria-hidden>
        <defs>
          <linearGradient id={`${u}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--pw-m0)" }} />
            <stop offset=".45" style={{ stopColor: "var(--pw-m1)" }} />
            <stop offset="1" style={{ stopColor: "var(--pw-m2)" }} />
          </linearGradient>
          <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--pw-b0)" }} />
            <stop offset=".5" style={{ stopColor: "var(--pw-b1)" }} />
            <stop offset="1" style={{ stopColor: "var(--pw-b2)" }} />
          </linearGradient>
          <radialGradient id={`${u}r`} cx=".35" cy=".3" r=".8">
            <stop offset="0" style={{ stopColor: "var(--pw-b0)" }} />
            <stop offset="1" style={{ stopColor: "var(--pw-m2)" }} />
          </radialGradient>
        </defs>
        <polygon points={OCT} fill={`url(#${u}m)`} style={{ stroke: "var(--pw-edge)" }} strokeWidth="1" />
        <polygon points={OCT_IN} style={{ fill: "var(--pw-plate)", stroke: "var(--pw-inner)" }} strokeWidth="1" />
        {RIVETS.map(([x, y]) => (
          <g key={`${x}${y}`}>
            <circle cx={x} cy={y} r="4.2" fill={`url(#${u}r)`} style={{ stroke: "var(--pw-inner)" }} strokeWidth=".8" />
            <path d={`M${x - 2} ${y + 1} L${x + 2} ${y - 1}`} strokeWidth=".8" style={{ stroke: "var(--pw-inner)" }} />
          </g>
        ))}
        <circle cx={C} cy={C} r="147" fill="none" strokeWidth="12" stroke={`url(#${u}b)`} />
        <circle cx={C} cy={C} r="153.5" fill="none" strokeWidth="1" style={{ stroke: "var(--pw-edge)" }} />
        <circle cx={C} cy={C} r="140.5" fill="none" strokeWidth="1.5" style={{ stroke: "var(--pw-inner)" }} />
        {TICKS.map((i) => {
          const maj = i % 8 === 0;
          const [x0, y0] = pt(maj ? 142 : 144, (i * 360) / 64);
          const [x1, y1] = pt(152, (i * 360) / 64);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={maj ? 1.6 : 0.9} style={{ stroke: maj ? "var(--pw-tick-maj)" : "var(--pw-tick)" }} />;
        })}
      </svg>

      {/* 2. блик по ободу — единственная постоянная анимация экрана */}
      <div className="pw-shine" aria-hidden />

      {/* 3. диск — крутится только он */}
      <div ref={disc} className="pw-disc" aria-hidden>
        <svg className="pw-l" viewBox="0 0 320 320">
          <defs>
            {(["hot", "amber", "neon", "magenta", "steel", "void"] as const).map((r) => (
              <radialGradient key={r} id={`${u}${r}`} gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R}>
                <stop offset=".25" style={{ stopColor: "var(--pw-face)" }} />
                <stop offset=".62" style={{ stopColor: `var(--pw-${r}-mid)` }} />
                <stop offset="1" style={{ stopColor: `var(--pw-${r}-out)` }} />
              </radialGradient>
            ))}
            <filter id={`${u}g`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={C} cy={C} r={R + 1} style={{ fill: "var(--pw-face)" }} />
          {sectors.map((s, i) => {
            const a0 = i * seg - seg / 2;
            const a1 = i * seg + seg / 2;
            return (
              <g key={s.id} className={cx("pw-sec", won && i !== winIndex && "dim")}>
                <path d={wedge(R_IN, R, a0, a1)} fill={`url(#${u}${s.role})`} />
                <path d={arc(R - 5, a0 + 1.6, a1 - 1.6)} fill="none" strokeWidth="3" strokeLinecap="butt" className="pw-tube" filter={`url(#${u}g)`} style={{ stroke: `var(--pw-${s.role})` }} />
                {s.role === "hot" && (
                  <path transform={`rotate(${i * seg} ${C} ${C})`} d={`M${C} ${C - 121} l4 6 -4 6 -4 -6z`} className="pw-gem" style={{ fill: "var(--pw-hot)" }} />
                )}
              </g>
            );
          })}
          {won && (
            <path key={`w${winIndex}`} className="pw-win ui-ignite" d={wedge(R_IN, R, winIndex * seg - seg / 2, winIndex * seg + seg / 2)} filter={`url(#${u}g)`} />
          )}
          {sectors.map((_, i) => {
            const [x0, y0] = pt(R_IN, i * seg - seg / 2);
            const [x1, y1] = pt(R, i * seg - seg / 2);
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth="2" className="pw-div" />;
          })}
          {sectors.map((s, i) => (
            <g key={`t${s.id}`} transform={`rotate(${i * seg} ${C} ${C})`} className={cx("pw-txt", won && (i === winIndex ? "win" : "dim"))}>
              <text x={C} y={C - 92} textAnchor="middle" className="pw-t1" style={{ fill: `var(--pw-${s.role}-ink)` }}>
                {s.title}
              </text>
              {s.sub && (
                <text x={C} y={C - 74} textAnchor="middle" className="pw-t2">
                  {s.sub}
                </text>
              )}
            </g>
          ))}
          <circle cx={C} cy={C} r={R} fill="none" strokeWidth="1.5" style={{ stroke: "var(--pw-inner)" }} />
        </svg>
      </div>

      {/* 4. стекло, ступица, указатель — неподвижны */}
      <svg className="pw-l" viewBox="0 0 320 320" aria-hidden>
        <defs>
          <linearGradient id={`${u}gl`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".09" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${u}h`} cx=".38" cy=".3" r=".75">
            <stop offset="0" style={{ stopColor: "var(--pw-h0)" }} />
            <stop offset=".55" style={{ stopColor: "var(--pw-h1)" }} />
            <stop offset="1" style={{ stopColor: "var(--pw-h2)" }} />
          </radialGradient>
          <filter id={`${u}p`} x="-60%" y="-30%" width="220%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="pw-glass" d={`M${C - 128} ${C - 12} A${R} ${R} 0 0 1 ${C + 104} ${C - 86} Q${C} ${C - 64} ${C - 128} ${C - 12} Z`} fill={`url(#${u}gl)`} />
        <circle cx={C} cy={C} r="36" fill={`url(#${u}h)`} strokeWidth="1" style={{ stroke: "var(--pw-edge)" }} />
        <circle cx={C} cy={C} r="31" fill="none" strokeWidth="1" style={{ stroke: "var(--pw-inner)" }} />
        <g ref={flap} className="pw-flap" style={{ transformOrigin: `${C}px 8px` }}>
          <path d={`M${C - 11} 4 L${C + 11} 4 L${C + 11} 12 L${C} 34 L${C - 11} 12 Z`} style={{ fill: "var(--pw-m1)", stroke: "var(--pw-edge)" }} strokeWidth="1" />
          <path className="pw-ptr" d={`M${C - 5} 9 L${C + 5} 9 L${C} 27 Z`} filter={`url(#${u}p)`} />
          <circle cx={C} cy="7" r="2.2" style={{ fill: "var(--pw-b0)" }} />
        </g>
      </svg>
      <span className="pw-hub" aria-hidden>
        <BrandMark size={44} />
      </span>
    </div>
  );
});
