import type { WheelStatus } from "@/api/hooks";

/**
 * Подписи и признаки для кнопки «Игры» и шторки игр (DESIGN.md п. 14.2).
 * Чистые функции — проверяются в games.test.ts.
 */

/** Янтарная точка на «Играх»: есть бесплатное вращение колеса сегодня */
export function hasFreeSpin(w: Pick<WheelStatus, "left_today"> | null | undefined): boolean {
  return !!w && Number(w.left_today) > 0;
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Строка состояния карточки «Колесо удачи» */
export function wheelLine(w: Pick<WheelStatus, "left_today"> | null | undefined): { text: string; hot: boolean } {
  if (!w) return { text: "Ежедневные вращения", hot: false };
  const n = Math.max(0, Number(w.left_today) || 0);
  if (n > 0) return { text: `${n} ${plural(n, "бесплатное вращение", "бесплатных вращения", "бесплатных вращений")}`, hot: true };
  return { text: "Новые вращения в 00:00 мск", hot: false };
}

/** Строка состояния карточки «Башня»: рекорд месяца — очки (как на экране Башни), не этажи */
export function towerLine(best: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(best) || 0));
  return n > 0 ? `Рекорд месяца · ${n}` : "Сложи башню без промаха";
}
