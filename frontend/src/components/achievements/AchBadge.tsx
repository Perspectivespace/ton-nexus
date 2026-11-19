import { useId } from "react";
import type { AchBranch, AchMetal } from "@/api/achievements";

/**
 * Значок достижения — «Luxury Metal»: шестигранная медаль с металлическим ободом, тёмным полем и гравировкой ветки.
 * Металл — по месту ступени в ветке (бронза → серебро → золото → платина, последняя — неон). Без анимаций и backdrop-filter.
 */
const METAL: Record<AchMetal, [string, string, string]> = {
  bronze: ["#F6CDA4", "#C07A45", "#6B3818"],
  silver: ["#FFFFFF", "#BCC6D6", "#5A6476"],
  gold: ["#FFF3C2", "#E9B746", "#865410"],
  platinum: ["#F2FCFF", "#A8DCEE", "#41677C"],
  neon: ["#9AFBFF", "#19D3FF", "#FF2E7E"],
};

/* гравировка 24×24 (по центру медали) */
const GLYPH: Record<AchBranch, string> = {
  tasks: "M5 4h14v16H5z M8.5 12.5l2.5 2.5 4.5-5",
  miner: "M13 3L6 13.5h5L10 21l8-11h-5.2z",
  games: "M12 3l8 9-8 9-8-9z M10.5 9v6l4.5-3z",
  level: "M5 11l7-5 7 5 M5 16l7-5 7 5 M5 21l7-5 7 5",
  ambassador: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
};

const HEX = "M32 2l26 15v30L32 62 6 47V17z";
const HEX_IN = "M32 8.5l20.4 11.75v23.5L32 55.5 11.6 43.75v-23.5z";

export function AchBadge({
  metal,
  branch,
  size = 48,
  locked,
  label,
  className,
}: {
  metal: AchMetal;
  branch: AchBranch;
  size?: number;
  /** ступень не открыта — тусклая гравировка без металла */
  locked?: boolean;
  /** подпись для чтения с экрана; без неё значок декоративный */
  label?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [hi, mid, lo] = METAL[metal];
  const rim = `ab-r${id}`;
  const face = `ab-f${id}`;
  const eng = `ab-e${id}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`ach-badge m-${metal}${locked ? " locked" : ""}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={rim} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.45" stopColor={mid} />
          <stop offset="0.62" stopColor={lo} />
          <stop offset="0.8" stopColor={mid} />
          <stop offset="1" stopColor={hi} />
        </linearGradient>
        <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A2232" />
          <stop offset="1" stopColor="#070A12" />
        </linearGradient>
        <linearGradient id={eng} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="1" stopColor={metal === "neon" ? lo : mid} />
        </linearGradient>
      </defs>
      <path d={HEX} fill={locked ? "#2A3242" : `url(#${rim})`} />
      <path d={HEX_IN} fill={`url(#${face})`} stroke={locked ? "#3A4458" : lo} strokeWidth="1" />
      {/* блик по верхней грани */}
      {!locked && <path d="M32 3.6l24.6 14.2v3.2L32 7 7.4 21v-3.2z" fill="#fff" opacity=".35" />}
      <g transform="translate(20 20)">
        <path
          d={GLYPH[branch]}
          fill="none"
          stroke={locked ? "#4A5568" : `url(#${eng})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
