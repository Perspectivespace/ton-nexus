import type { WheelStatus } from "@/api/hooks";
import { t, tp } from "@/i18n";

/**
 * Подписи и признаки для кнопки «Игры» и шторки игр (DESIGN.md п. 14.2).
 * Чистые функции — проверяются в games.test.ts.
 */

/** Янтарная точка на «Играх»: есть бесплатное вращение колеса сегодня */
export function hasFreeSpin(w: Pick<WheelStatus, "left_today"> | null | undefined): boolean {
  return !!w && Number(w.left_today) > 0;
}


/** Строка состояния карточки «Колесо удачи» */
export function wheelLine(w: Pick<WheelStatus, "left_today"> | null | undefined): { text: string; hot: boolean } {
  if (!w) return { text: t("games.dailySpins"), hot: false };
  const n = Math.max(0, Number(w.left_today) || 0);
  if (n > 0) return { text: `${n} ${tp("games.freeSpins", n)}`, hot: true };
  return { text: t("games.newSpinsAt"), hot: false };
}

/** Строка состояния карточки «Башня»: рекорд месяца — очки (как на экране Башни), не этажи */
export function towerLine(best: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(best) || 0));
  return n > 0 ? t("games.monthBest", { n }) : t("games.towerHint");
}
