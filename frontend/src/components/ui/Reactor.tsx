import { useId, type CSSProperties } from "react";
import { cx } from "./press";

export type ReactorState = "running" | "ready" | "idle";

type Props = {
  /** заполнение хранилища 0…1 */
  fill: number;
  state: ReactorState;
  /** диаметр, px (п. 8.1: 196–210) */
  size?: number;
  /** табличка «41% ХРАНИЛИЩЕ» под реактором */
  plate?: boolean;
  /** момент B: дуга стекает к нулю за 600 мс, ядро один раз приглушается */
  draining?: boolean;
  /** момент A: ядро и дуга «зажигаются» (380 мс) */
  ignite?: boolean;
  className?: string;
  /** КОНЦЕПТ: облик по уровню реактора (0 — база, 1 — ур. 5, 2 — ур. 10, 3 — ур. 20) */
  tier?: 0 | 1 | 2 | 3;
  /** КОНЦЕПТ: разовое раскрытие нового облика */
  reveal?: boolean;
};

const TICKS = Array.from({ length: 60 }, (_, i) => i);
const PARTICLES: [number, number][] = [[38, 30], [66, 22], [72, 64], [28, 70], [56, 78]];
const C1 = 2 * Math.PI * 78;
const C2 = 2 * Math.PI * 59;
const PLATES = Array.from({ length: 8 }, (_, i) => i);
const HUD = Array.from({ length: 120 }, (_, i) => i);
const COILS = Array.from({ length: 10 }, (_, i) => i);
/** дуга-сегмент кольца: центр 105,105, радиус r, от a0 до a1 (градусы, 0 — сверху) */
function arcPath(r: number, a0: number, a1: number) {
  const p = (a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(105 + r * Math.cos(t)).toFixed(2)} ${(105 + r * Math.sin(t)).toFixed(2)}`;
  };
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
}

/**
 * Реактор — герой экрана «Майнер» (docs/DESIGN.md, п. 8.1).
 * Слои: корпус, 60 делений (каждое пятое длиннее), дуга хранилища, кольцо A (40 с/оборот),
 * кольцо B (22 с, обратно), стекло, ядро, нити, 5 статичных частиц, табличка.
 * Вращаются только кольца — и только когда state = running, вкладка видна и движение не уменьшено (это в CSS).
 * Полное хранилище — янтарь, кольца стоят. Остановлен — ядро на 30 %, дуга серая.
 * Цвета — переменные темы (--rx-*), светлая тема: светлый металл, без ореола и частиц.
 */
export function Reactor({ fill, state, size = 204, plate = true, draining, ignite, className, tier = 0, reveal }: Props) {
  const u = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const pctLabel = Math.round(pct * 100);
  return (
    <div
      className={cx("rx", `is-${state}`, `t${tier}`, draining && "is-draining", ignite && "is-ignite", reveal && "is-reveal", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Реактор: ${state === "running" ? "работает" : state === "ready" ? "хранилище полное" : "остановлен"}, хранилище ${pctLabel}%`}
    >
      <svg className="rx-house" viewBox="0 0 210 210" aria-hidden>
        <defs>
          <linearGradient id={`${u}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--rx-m0)" }} />
            <stop offset=".35" style={{ stopColor: "var(--rx-m1)" }} />
            <stop offset=".7" style={{ stopColor: "var(--rx-m2)" }} />
            <stop offset="1" style={{ stopColor: "var(--rx-m3)" }} />
          </linearGradient>
          <radialGradient id={`${u}d`} cx=".5" cy=".42" r=".55">
            <stop offset="0" style={{ stopColor: "var(--rx-d0)" }} />
            <stop offset=".7" style={{ stopColor: "var(--rx-d1)" }} />
            <stop offset="1" style={{ stopColor: "var(--rx-d2)" }} />
          </radialGradient>
          <linearGradient id={`${u}c`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--rx-arc0)" }} />
            <stop offset="1" style={{ stopColor: "var(--rx-arc1)" }} />
          </linearGradient>
          <filter id={`${u}g`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="105" cy="105" r="104" fill="none" strokeWidth="1" style={{ stroke: "var(--rx-outer)" }} />
        <circle cx="105" cy="105" r="99" strokeWidth="8" fill={`url(#${u}d)`} stroke={`url(#${u}m)`} />
        <circle cx="105" cy="105" r="94.5" fill="none" strokeWidth="1" style={{ stroke: "var(--rx-inner)" }} />
        {TICKS.map((i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const r2 = i % 5 ? 87 : 84;
          const on = i / 60 < pct;
          return (
            <line
              key={i}
              x1={105 + 90 * Math.cos(a)}
              y1={105 + 90 * Math.sin(a)}
              x2={105 + r2 * Math.cos(a)}
              y2={105 + r2 * Math.sin(a)}
              strokeWidth={i % 5 ? 1 : 1.8}
              style={{ stroke: on ? "var(--rx-tick-on)" : "var(--rx-tick)" }}
            />
          );
        })}
        <circle cx="105" cy="105" r="78" fill="none" strokeWidth="6" style={{ stroke: "var(--rx-track)" }} />
        {(pct > 0 || draining) && (
          <circle
            className="rx-arc"
            cx="105"
            cy="105"
            r="78"
            fill="none"
            strokeWidth="6"
            stroke={`url(#${u}c)`}
            style={{ strokeDasharray: `${C1} ${C1}`, strokeDashoffset: C1 * (1 - pct) }}
            transform="rotate(-90 105 105)"
            filter={`url(#${u}g)`}
          />
        )}
      </svg>
      {tier >= 1 && (
        <svg className="rx-armor" viewBox="0 0 210 210" aria-hidden>
          <defs>
            <linearGradient id={`${u}p`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--rx-pl0)" }} />
              <stop offset=".45" style={{ stopColor: "var(--rx-pl1)" }} />
              <stop offset=".75" style={{ stopColor: "var(--rx-pl2)" }} />
              <stop offset="1" style={{ stopColor: "var(--rx-pl3)" }} />
            </linearGradient>
          </defs>
          {PLATES.map((i) => (
            <g key={i} className="rx-plt" style={{ "--i": i } as CSSProperties}>
              <path d={arcPath(99, i * 45 + 3.2, i * 45 + 41.8)} fill="none" strokeWidth="9" stroke={`url(#${u}p)`} />
              <path d={arcPath(102.6, i * 45 + 5, i * 45 + 40)} fill="none" strokeWidth=".6" style={{ stroke: "var(--rx-engr)" }} />
              <path d={arcPath(95.6, i * 45 + 5, i * 45 + 40)} fill="none" strokeWidth=".6" style={{ stroke: "var(--rx-engr)" }} />
              {[8, 37].map((d) => {
                const t = ((i * 45 + d - 90) * Math.PI) / 180;
                return <circle key={d} cx={105 + 99 * Math.cos(t)} cy={105 + 99 * Math.sin(t)} r="1.3" style={{ fill: "var(--rx-bolt)" }} />;
              })}
            </g>
          ))}
        </svg>
      )}
      {tier >= 1 && (
        <div className="rx-ring c" aria-hidden>
          <svg viewBox="0 0 210 210">
            {HUD.map((i) => {
              const a = (i / 120) * Math.PI * 2;
              const long = i % 10 === 0;
              const r1 = 104;
              const r2 = long ? 98 : 101.5;
              return <line key={i} x1={105 + r1 * Math.cos(a)} y1={105 + r1 * Math.sin(a)} x2={105 + r2 * Math.cos(a)} y2={105 + r2 * Math.sin(a)} strokeWidth={long ? 1 : 0.5} style={{ stroke: "var(--rx-hud)" }} />;
            })}
            {[0, 120, 240].map((a) => (
              <path key={a} d={arcPath(107.5, a + 10, a + 34)} fill="none" strokeWidth="1.6" style={{ stroke: "var(--rx-hud-b)" }} />
            ))}
          </svg>
        </div>
      )}
      <div className="rx-ring a" aria-hidden>
        <svg viewBox="0 0 210 210">
          <circle cx="105" cy="105" r="67" fill="none" strokeWidth="1.4" strokeDasharray="1.5 5" style={{ stroke: "var(--rx-ringA)" }} />
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} x="103" y="35" width="4" height="6" transform={`rotate(${k * 90 + 20} 105 105)`} style={{ fill: "var(--rx-pip)" }} />
          ))}
        </svg>
      </div>
      <div className="rx-ring b" aria-hidden>
        <svg viewBox="0 0 210 210">
          <circle cx="105" cy="105" r="59" fill="none" strokeWidth="2.2" strokeDasharray={`${C2 / 6 - 4} ${C2 / 6 + 4}`} style={{ stroke: "var(--rx-ringB)" }} />
        </svg>
      </div>
      <i className="rx-shell" aria-hidden />
      <i className="rx-fil" aria-hidden />
      {tier >= 2 && (
        <svg className="rx-coils" viewBox="0 0 210 210" aria-hidden>
          {COILS.map((i) => (
            <g key={i} transform={`rotate(${i * 36} 105 105)`}>
              <rect x="99" y="49" width="12" height="9" rx="1.2" style={{ fill: "var(--rx-coil)", stroke: "var(--rx-coil-e)" }} strokeWidth=".6" />
              {[0, 1, 2, 3].map((k) => (
                <line key={k} x1={100.5 + k * 3} y1="49.6" x2={100.5 + k * 3} y2="57.4" strokeWidth=".7" style={{ stroke: "var(--rx-wire)" }} />
              ))}
            </g>
          ))}
        </svg>
      )}
      <i className="rx-core" aria-hidden />
      {tier >= 1 && <i className="rx-pulse" aria-hidden />}
      {tier >= 2 && (
        <svg className="rx-tri" viewBox="0 0 210 210" aria-hidden>
          <path d="M105 82 L125 116.5 L85 116.5 Z" fill="none" strokeWidth="2.4" strokeLinejoin="round" style={{ stroke: "var(--rx-tri)" }} />
          <path d="M105 88 L119.8 113.5 L90.2 113.5 Z" fill="none" strokeWidth=".7" style={{ stroke: "var(--rx-tri-in)" }} />
        </svg>
      )}
      {tier >= 3 &&
        [0, 1, 2].map((k) => (
          <div key={k} className={`rx-orb o${k}`} aria-hidden>
            <i />
          </div>
        ))}
      {reveal && <i className="rx-flash" aria-hidden />}
      {PARTICLES.map(([x, y]) => (
        <i key={`${x}-${y}`} className="rx-p" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden />
      ))}
      {plate && (
        <div className="rx-plate">
          <b>{pctLabel}%</b>
          <span>хранилище</span>
        </div>
      )}
    </div>
  );
}
