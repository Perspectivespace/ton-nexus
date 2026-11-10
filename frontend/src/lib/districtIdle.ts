import type { Surface } from "@/lib/districts";

/**
 * Свободные рекламные места района (PR 4 районов, просьба Сергея): пока место не куплено, на нём не пустая рамка,
 * а самореклама места — короткие слоганы по очереди в утверждённых стилях (экран фасада — янтарная рамка и развёртка,
 * строка — LED-матрица A, баннер и вывеска — голо-проекция B). Смена слогана — разовый прогон по JS-таймеру,
 * бесконечных CSS-анимаций нет; на слабых устройствах и при «меньше движения» — первый слоган неподвижно.
 * Покупка мест в районах — PR 6: касание здесь пока ничего не делает.
 */
export type IdleKind = Surface["kind"];

/** «1.50» → «1,5»: цена за сутки по-русски, без лишних нулей */
export function tonRu(price: string | null | undefined): string | null {
  if (price == null || price === "") return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

/** строка цены: «от 1,5 TON/сутки» (если цена известна) */
export const priceLine = (price: string | null | undefined) => {
  const t = tonRu(price);
  return t ? `от ${t} TON/сутки` : null;
};

/**
 * Слоганы места по типу; первый — неподвижный вариант (слабое устройство, «меньше движения»).
 * compact — маленькие места Центра: вывеска в одну строку (до 9 знаков), баннер — короче.
 */
export function idleSlogans(kind: IdleKind, price?: string | null, compact = false): string[] {
  const p = priceLine(price);
  if (compact && kind === "neon") return ["Засветись", "Свободно", "Твой неон"];
  if (compact && kind === "banner") return ["Засветись тут", "Место для рекламы", "Твой баннер тут"];
  switch (kind) {
    case "facade_screen":
      return ["Место для рекламы", "Засветись тут", "Твой бренд — на весь рынок", "Этот экран ждёт тебя"];
    case "banner":
      return ["Засветись тут", "Место для рекламы", "Видно со всей улицы"];
    case "neon":
      return ["Засветись тут", "Твоя вывеска", "Свободно"];
    case "line":
      return [
        p ? `Место для рекламы · ${p}` : "Место для рекламы",
        "Засветись на Неон-рядах",
        "Бегущая строка ждёт твой текст",
      ];
  }
}

/** цвет места (палитра рекламы): экран — янтарь, строка — циан, баннер — маджента, вывеска — фиолет */
export const IDLE_COLOR: Record<IdleKind, "amber" | "cyan" | "magenta" | "violet"> = {
  facade_screen: "amber",
  line: "cyan",
  banner: "magenta",
  neon: "violet",
};

/** пауза до следующего слогана (мс): 7–10 с, места сменяются вразнобой (сдвиг по номеру) */
export const idleDelay = (i: number, r = Math.random()) => 7000 + r * 3000 + i * 1300;
/** проезд LED-строки: ~3,6 с на ширину окна, как у строки на башне */
export const idleTickerMs = (from: number, to: number, win: number) => ((from - to) / Math.max(win, 1)) * 3600;
/** смена слогана на голо/экране: короткая развёртка (гаснет, перескок, проявляется) — только transform и opacity */
export const IDLE_OUT: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 0.35, transform: "translateX(-3%) skewX(-8deg)", offset: 0.4 },
  { opacity: 0, transform: "scaleY(.08)" },
];
export const IDLE_IN: Keyframe[] = [
  { opacity: 0, transform: "scaleY(.08)" },
  { opacity: 1, transform: "none" },
];
