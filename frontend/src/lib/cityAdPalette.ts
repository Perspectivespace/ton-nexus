import type { CSSProperties } from "react";

/** Палитра рекламы в городе (те же ключи, что city_ads.PALETTE на сервере). */
export const AD_PALETTE: Record<string, string> = {
  cyan: "#2BF5FF",
  magenta: "#FF2E7E",
  amber: "#FFB547",
  mint: "#5DFFB0",
  violet: "#B084FF",
};

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v * (1 - t) + B[i] * t)).join(",")})`;
};

/** CSS-переменные цвета объявления: --ac, --ac-rgb, --ac-core (светлая сердцевина), --ac-ink (буквы на светлом). */
export function adVars(color: string): CSSProperties {
  const h = AD_PALETTE[color] ?? AD_PALETTE.cyan;
  return {
    "--ac": h,
    "--ac-rgb": rgb(h).join(","),
    "--ac-core": mix(h, "#FFFFFF", 0.62),
    "--ac-ink": mix(h, "#0B1830", 0.55),
  } as CSSProperties;
}
