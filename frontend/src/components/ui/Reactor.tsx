import { useId } from "react";
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
  className?: string;
};

const TICKS = Array.from({ length: 60 }, (_, i) => i);
const PARTICLES: [number, number][] = [[38, 30], [66, 22], [72, 64], [28, 70], [56, 78]];
const C1 = 2 * Math.PI * 78;
const C2 = 2 * Math.PI * 59;

/**
 * Реактор — герой экрана «Майнер» (docs/DESIGN.md, п. 8.1).
 * Слои: корпус, 60 делений (каждое пятое длиннее), дуга хранилища, кольцо A (40 с/оборот),
 * кольцо B (22 с, обратно), стекло, ядро, нити, 5 статичных частиц, табличка.
 * Вращаются только кольца — и только когда state = running, вкладка видна и движение не уменьшено (это в CSS).
 * Полное хранилище — янтарь, кольца стоят. Остановлен — ядро на 30 %, дуга серая.
 * Цвета — переменные темы (--rx-*), светлая тема: светлый металл, без ореола и частиц.
 */
export function Reactor({ fill, state, size = 204, plate = true, className }: Props) {
  const u = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const pctLabel = Math.round(pct * 100);
  return (
    <div
      className={cx("rx", `is-${state}`, className)}
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
        {pct > 0 && (
          <circle
            className="rx-arc"
            cx="105"
            cy="105"
            r="78"
            fill="none"
            strokeWidth="6"
            stroke={`url(#${u}c)`}
            strokeDasharray={`${C1 * pct} ${C1}`}
            transform="rotate(-90 105 105)"
            filter={`url(#${u}g)`}
          />
        )}
      </svg>
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
      <i className="rx-core" aria-hidden />
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
