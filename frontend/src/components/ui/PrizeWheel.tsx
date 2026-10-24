import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
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
  /** выпал пустой сектор — подсветка нейтральная, без натрия */
  miss?: boolean;
  /** табло слева сверху: бесплатные вращения */
  spins?: { left: number; max: number };
  /** табло справа снизу: режим прибора («ГОТОВ», «ВРАЩЕНИЕ»…) */
  mode?: string;
  className?: string;
};

const C = 160;
const R = 118; // диск
const R_IN = 31; // под ступицей
const R_T = 84; // название сектора
const R_S = 71; // подстрочник
const TURNS = 5;
const DUR = 3000;
/** шкала: риска каждые 3°, средняя — 15°, крупная с цифрами — 30° */
const TICKS = Array.from({ length: 120 }, (_, i) => i * 3);
const NUMS = Array.from({ length: 12 }, (_, i) => i * 30).filter((d) => d !== 0);

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
const pad2 = (v: number) => String(v).padStart(2, "0");
const norm = (a: number) => ((a % 360) + 360) % 360;

/**
 * Колесо удачи — прибор на приборной панели волнолёта (DESIGN.md, п. 8.3).
 * Тонкий хромовый обод, градуированная шкала с цифрами курса и тонкое внутреннее кольцо — неподвижны;
 * крутится только карта-диск: тёмные стеклянные сектора с волосяными неоновыми кромками по ролям цвета,
 * подписи Tektur с широкой разрядкой. Указатель — тонкая игла-шеврон. По углам — табло: вращения, сектор под иглой, курс диска, режим.
 * Вращение — только transform: одно вращение с торможением, щелчок (selection) на каждом секторе, игла отскакивает на кромках.
 * Тап — сразу к концу, «уменьшить движение» — результат без вращения.
 * Простой «жизни» — блик, медленно идущий по ободу (transform), на паузе при скрытом приложении и во время вращения.
 */
export const PrizeWheel = forwardRef<PrizeWheelHandle, Props>(function PrizeWheel(
  { sectors, winIndex = null, spinning, miss, spins, mode, className },
  ref,
) {
  const u = useId().replace(/:/g, "");
  const n = sectors.length;
  const seg = 360 / n;
  const disc = useRef<HTMLDivElement>(null);
  const flap = useRef<SVGGElement>(null);
  const secNo = useRef<HTMLElement>(null);
  const secOut = useRef<HTMLElement>(null);
  const hdgOut = useRef<HTMLSpanElement>(null);
  const angle = useRef(0);
  const skipFlag = useRef(false);
  const raf = useRef(0);
  // угол покоя: по нему подписи нижней половины разворачиваются «головой вверх»
  const [rest, setRest] = useState(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const underPtr = (a: number) => ((Math.round(-a / seg) % n) + n) % n;
  // табло меняем напрямую (без перерисовки React): сектор под иглой и курс диска
  const readout = (a: number) => {
    const i = underPtr(a);
    if (secNo.current) secNo.current.textContent = `Сектор ${pad2(i + 1)}`;
    if (secOut.current) secOut.current.textContent = sectors[i]?.title ?? "";
    if (hdgOut.current) hdgOut.current.textContent = `${String(Math.round(norm(-a)) % 360).padStart(3, "0")}°`;
  };
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
        // сектор index встаёт под иглу, с небольшим случайным смещением внутри сектора
        const jitter = (Math.random() - 0.5) * seg * 0.5;
        const want = norm(-(index * seg + jitter));
        const delta = norm(want - norm(from));
        const to = from + 360 * TURNS + delta;
        if (opts?.instant || prefersReducedMotion()) {
          angle.current = to;
          paint(to);
          readout(to);
          setRest(norm(to));
          return Promise.resolve();
        }
        return new Promise<void>((done) => {
          const t0 = performance.now();
          let edge = Math.floor((from + seg / 2) / seg);
          let deg = Math.round(from);
          const step = (now: number) => {
            const p = skipFlag.current ? 1 : Math.min(1, (now - t0) / DUR);
            const a = from + (to - from) * ease(p);
            angle.current = a;
            const e = Math.floor((a + seg / 2) / seg);
            if (e !== edge) {
              edge = e;
              if (p < 1) haptic.select();
            }
            if (Math.round(a) !== deg) {
              deg = Math.round(a);
              readout(a);
            }
            const past = (((a + seg / 2) % seg) + seg) % seg; // градусов после последней кромки
            paint(a, p < 1 ? -10 * Math.exp(-past / 5) : 0);
            if (p < 1) raf.current = requestAnimationFrame(step);
            else {
              readout(to);
              setRest(norm(to));
              done();
            }
          };
          raf.current = requestAnimationFrame(step);
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seg, n, sectors],
  );

  const won = winIndex != null && winIndex >= 0;

  return (
    <div className={cx("pw", spinning && "is-spinning", won && "is-won", won && miss && "is-miss", className)}>
      {/* 1. корпус прибора: тонкий хромовый обод, шкала курса, внутреннее кольцо */}
      <svg className="pw-l" viewBox="0 0 320 320" aria-hidden>
        <defs>
          <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--pw-b0)" }} />
            <stop offset=".5" style={{ stopColor: "var(--pw-b1)" }} />
            <stop offset="1" style={{ stopColor: "var(--pw-b2)" }} />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r="149" style={{ fill: "var(--pw-plate)" }} />
        <circle cx={C} cy={C} r="150" fill="none" strokeWidth="2.4" stroke={`url(#${u}b)`} />
        <circle cx={C} cy={C} r="152.2" fill="none" strokeWidth=".6" style={{ stroke: "var(--pw-edge)" }} />
        <circle cx={C} cy={C} r="147.6" fill="none" strokeWidth=".6" style={{ stroke: "var(--pw-inner)" }} />
        {TICKS.map((d) => {
          const maj = d % 30 === 0;
          const mid = !maj && d % 15 === 0;
          const [x0, y0] = pt(maj ? 137 : mid ? 140 : 142.5, d);
          const [x1, y1] = pt(145.5, d);
          return (
            <line key={d} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={maj ? 0.9 : 0.55} className={maj ? "pw-tk maj" : "pw-tk"} />
          );
        })}
        {NUMS.map((d) => {
          const [x, y] = pt(130.5, d);
          return (
            <text key={d} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="pw-deg" transform={`rotate(${d} ${x} ${y})`}>
              {String(d / 10).padStart(2, "0")}
            </text>
          );
        })}
        <circle cx={C} cy={C} r={R + 4.5} fill="none" strokeWidth=".7" className="pw-ring" />
      </svg>

      {/* 2. блик по ободу — единственная постоянная анимация экрана */}
      <div className="pw-shine" aria-hidden />

      {/* 3. карта-диск — крутится только она */}
      <div ref={disc} className="pw-disc" aria-hidden>
        <svg className="pw-l" viewBox="0 0 320 320">
          <defs>
            {(["hot", "amber", "neon", "magenta", "steel", "void"] as const).map((r) => (
              <radialGradient key={r} id={`${u}${r}`} gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R}>
                <stop offset=".3" stopOpacity="0" style={{ stopColor: `var(--pw-${r})` }} />
                <stop offset="1" style={{ stopColor: `var(--pw-${r}-glass)` }} />
              </radialGradient>
            ))}
            <filter id={`${u}g`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="1.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={C} cy={C} r={R} style={{ fill: "var(--pw-face)" }} />
          {sectors.map((s, i) => {
            const a0 = i * seg - seg / 2;
            const a1 = i * seg + seg / 2;
            return (
              <g key={s.id} className={cx("pw-sec", won && (i === winIndex ? "win" : "dim"))}>
                <path d={wedge(R_IN, R, a0, a1)} fill={`url(#${u}${s.role})`} />
                <path d={arc(R - 2.5, a0 + 1.2, a1 - 1.2)} fill="none" strokeWidth="1.1" className="pw-tube" filter={`url(#${u}g)`} style={{ stroke: `var(--pw-${s.role})` }} />
                {s.role === "hot" && (
                  <path transform={`rotate(${i * seg} ${C} ${C})`} d={`M${C} ${C - R + 8} l2.6 3.6 -2.6 3.6 -2.6 -3.6z`} className="pw-gem" style={{ fill: "var(--pw-hot)" }} />
                )}
              </g>
            );
          })}
          {won && (
            <path key={`w${winIndex}`} className="pw-win ui-ignite" d={wedge(R_IN, R, winIndex * seg - seg / 2, winIndex * seg + seg / 2)} />
          )}
          {sectors.map((_, i) => {
            const [x0, y0] = pt(R_IN + 6, i * seg - seg / 2);
            const [x1, y1] = pt(R, i * seg - seg / 2);
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth=".6" className="pw-div" />;
          })}
          <circle cx={C} cy={C} r={(R_S + R_IN) / 2 + 4} fill="none" strokeWidth=".5" strokeDasharray="1 3" className="pw-div" />
          {sectors.map((s, i) => {
            // в нижней половине (в покое) подписи разворачиваются «головой вверх»: название ближе к центру, подстрочник — к краю
            const flip = (() => {
              const at = norm(i * seg + rest);
              return at > 90 && at < 270;
            })();
            const piv = s.sub ? (R_T + R_S) / 2 : R_T - 4;
            const rt = s.sub ? R_T : R_T - 4;
            return (
              <g key={`t${s.id}`} transform={`rotate(${i * seg} ${C} ${C})`} className={cx("pw-txt", won && (i === winIndex ? "win" : "dim"))}>
                <g transform={flip ? `rotate(180 ${C} ${C - piv})` : undefined}>
                  <text x={C} y={C - rt} textAnchor="middle" dominantBaseline="central" className="pw-t1" style={{ fill: `var(--pw-${s.role}-ink)` }}>
                    {s.title}
                  </text>
                  {s.sub && (
                    <text x={C} y={C - R_S} textAnchor="middle" dominantBaseline="central" className="pw-t2">
                      {s.sub}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 4. стекло, ступица, игла — неподвижны */}
      <svg className="pw-l" viewBox="0 0 320 320" aria-hidden>
        <defs>
          <linearGradient id={`${u}gl`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".07" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${u}p`} x="-80%" y="-20%" width="260%" height="140%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="pw-glass" d={`M${C - 112} ${C - 14} A${R} ${R} 0 0 1 ${C + 92} ${C - 74} Q${C} ${C - 58} ${C - 112} ${C - 14} Z`} fill={`url(#${u}gl)`} />
        <circle cx={C} cy={C} r="26" style={{ fill: "var(--pw-face)" }} />
        <circle cx={C} cy={C} r="26" fill="none" strokeWidth="1.6" stroke={`url(#${u}b)`} />
        <circle cx={C} cy={C} r="29.5" fill="none" strokeWidth=".5" className="pw-ring" />
        <g ref={flap} className="pw-flap" style={{ transformOrigin: `${C}px 10px` }}>
          {/* метка на ободе и игла-шеврон: тонкие линии циана */}
          <path d={`M${C - 5} 5 L${C + 5} 5 L${C} 12 Z`} className="pw-ptr-cap" />
          <g className="pw-ptr" filter={`url(#${u}p)`}>
            <path d={`M${C - 7} 30 L${C} 41 L${C + 7} 30`} fill="none" strokeWidth="1.4" strokeLinejoin="miter" />
            <path d={`M${C} 13 L${C} 50`} fill="none" strokeWidth="1" />
          </g>
        </g>
      </svg>
      <span className="pw-hub" aria-hidden>
        <BrandMark size={30} />
      </span>

      {/* 5. табло по углам прибора */}
      <span className="pw-hud tl" aria-hidden>
        <i>Вращения</i>
        <b>{spins ? `${spins.left}/${spins.max}` : "—"}</b>
      </span>
      <span className="pw-hud tr" aria-hidden>
        <i ref={secNo}>Сектор 01</i>
        <b ref={secOut}>{sectors[0]?.title}</b>
      </span>
      <span className="pw-hud bl" aria-hidden>
        <i>Курс</i>
        <b ref={hdgOut}>000°</b>
      </span>
      <span className="pw-hud br" aria-hidden>
        <i>Режим</i>
        <b>{mode ?? "—"}</b>
      </span>
    </div>
  );
});
