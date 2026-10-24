import { useId } from "react";
import { cx } from "./press";

const CX = 160;
const CY = 165;
const P = (r: number, f: number) => [CX + r * Math.cos(Math.PI * (1 - f)), CY - r * Math.sin(Math.PI * (1 - f))] as const;
const arc = (r: number, f0: number, f1: number) => {
  const a = P(r, f0);
  const b = P(r, f1);
  return `M${a[0].toFixed(2)} ${a[1].toFixed(2)} A${r} ${r} 0 0 1 ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
};
const TICKS = Array.from({ length: 51 }, (_, i) => i);
const NEEDLE = `${CX - 3.2},${CY} ${CX - 0.9},${CY - 106} ${CX + 0.9},${CY - 106} ${CX + 3.2},${CY} ${CX + 2},${CY + 16} ${CX - 2},${CY + 16}`;

type Props = {
  /** шанс успеха 0…1; null — шанс ещё неизвестен (стрелка на нуле, шкала нейтральная) */
  chance: number | null;
  className?: string;
};

/**
 * Циферблат шанса — герой экрана «Усиление» (docs/DESIGN.md, п. 8.2).
 * Полукруг 320×186, металлический обод 16 px, циан — зона успеха от 0 до шанса, маджента — зона сгорания,
 * 51 деление, подписи 0/50/100, стрелка с тенью, ступица, блик стекла.
 * Ничего не крутится само: стрелка один раз переходит к новому шансу (transform), при «уменьшить движение» — сразу.
 */
export function DialGauge({ chance, className }: Props) {
  const u = useId().replace(/:/g, "");
  const known = chance != null && Number.isFinite(chance);
  const pct = known ? Math.max(0, Math.min(1, chance as number)) : 0;
  const rot = pct * 180 - 90;
  return (
    <svg className={cx("dial", !known && "is-unknown", className)} viewBox="0 0 320 186" role="img" aria-label={known ? `Шанс успеха ${Math.round(pct * 100)}%` : "Шанс успеха станет известен после прогона"}>
      <defs>
        <linearGradient id={`${u}m`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--dl-m0)" }} />
          <stop offset=".4" style={{ stopColor: "var(--dl-m1)" }} />
          <stop offset="1" style={{ stopColor: "var(--dl-m2)" }} />
        </linearGradient>
        <linearGradient id={`${u}c`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--dl-c0)" }} />
          <stop offset=".6" style={{ stopColor: "var(--dl-c1)" }} />
          <stop offset="1" style={{ stopColor: "var(--dl-c2)" }} />
        </linearGradient>
        <radialGradient id={`${u}h`} cx=".4" cy=".3" r=".7">
          <stop offset="0" style={{ stopColor: "var(--dl-h0)" }} />
          <stop offset=".5" style={{ stopColor: "var(--dl-h1)" }} />
          <stop offset="1" style={{ stopColor: "var(--dl-h2)" }} />
        </radialGradient>
        <linearGradient id={`${u}gl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".10" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${u}g`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${u}s`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>
      <path d={arc(143, 0, 1)} fill="none" strokeWidth="1" style={{ stroke: "var(--dl-outer)" }} />
      <path d={arc(134, 0, 1)} fill="none" strokeWidth="16" stroke={`url(#${u}m)`} />
      <path d={arc(125.5, 0, 1)} fill="none" strokeWidth="1" style={{ stroke: "var(--dl-inner)" }} />
      <path d={`${arc(124, 0, 1)} L${CX - 124} ${CY} Z`} style={{ fill: "var(--dl-face)" }} />
      <path d={arc(112, 0, 1)} fill="none" strokeWidth="14" style={{ stroke: "var(--dl-track)" }} />
      {known && pct < 1 && (
        <>
          <path d={arc(112, pct, 1)} fill="none" strokeWidth="14" style={{ stroke: "var(--dl-burn)" }} />
          <path d={arc(121, Math.min(1, pct + 0.01), 1)} fill="none" strokeWidth="2" opacity=".85" style={{ stroke: "var(--magenta)" }} />
        </>
      )}
      {known && pct > 0 && <path className="dl-ok" d={arc(112, 0, pct)} fill="none" strokeWidth="14" stroke={`url(#${u}c)`} filter={`url(#${u}g)`} />}
      {TICKS.map((i) => {
        const f = i / 50;
        const maj = i % 5 === 0;
        const a = P(98, f);
        const b = P(maj ? 90 : 94, f);
        return (
          <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={maj ? 1.8 : 1} style={{ stroke: known && f <= pct ? "var(--dl-tick-on)" : "var(--dl-tick)" }} />
        );
      })}
      {([[0, "0"], [0.5, "50"], [1, "100"]] as const).map(([f, t]) => {
        const p = P(78, f);
        return (
          <text key={t} className="dl-lab" x={p[0]} y={p[1] + (f === 0.5 ? 4 : -2)} textAnchor="middle">
            {t}
          </text>
        );
      })}
      <g className="dl-needle" style={{ transform: `rotate(${rot}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <polygon points={NEEDLE} fill="#000" opacity=".6" filter={`url(#${u}s)`} transform="translate(4 5)" className="dl-shadow" />
        <polygon points={NEEDLE} style={{ fill: "var(--dl-n0)" }} />
        <polygon points={`${CX},${CY} ${CX - 0.9},${CY - 106} ${CX + 0.9},${CY - 106} ${CX + 3.2},${CY}`} style={{ fill: "var(--dl-n1)" }} />
        <line className="dl-tip" x1={CX} y1={CY - 60} x2={CX} y2={CY - 104} strokeWidth="1.6" filter={`url(#${u}g)`} style={{ stroke: "var(--neon)" }} />
      </g>
      <circle cx={CX} cy={CY} r="14" fill={`url(#${u}h)`} strokeWidth="1" style={{ stroke: "var(--dl-inner)" }} />
      <circle cx={CX} cy={CY} r="5" strokeWidth=".8" style={{ fill: "var(--dl-m2)", stroke: "var(--dl-outer)" }} />
      <line x1={CX - 3.5} y1={CY + 1.5} x2={CX + 3.5} y2={CY - 1.5} stroke="rgba(255,255,255,.35)" strokeWidth="1" />
      <path className="dl-glass" d={`M${CX - 120} ${CY - 20} A124 124 0 0 1 ${CX + 90} ${CY - 86} Q${CX} ${CY - 70} ${CX - 120} ${CY - 20} Z`} fill={`url(#${u}gl)`} />
    </svg>
  );
}
