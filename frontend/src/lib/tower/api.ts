import { ApiError } from "@/api/client";
import { serverNow } from "@/lib/cityPhase";
import { t } from "@/i18n";

/** Ошибка API «Башни»: сервер отдаёт detail = {code, message[, next_reset_at]} */
export interface TowerErr {
  status: number;
  code: string;
  message: string;
  nextResetAt?: string;
}

export function parseTowerError(e: unknown): TowerErr {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.message);
      if (d && typeof d === "object" && typeof d.code === "string") {
        return { status: e.status, code: d.code, message: String(d.message ?? ""), nextResetAt: d.next_reset_at };
      }
    } catch {
      /* detail — обычная строка */
    }
    return { status: e.status, code: "http_" + e.status, message: e.message };
  }
  return { status: 0, code: "network", message: t("tower.noServer") };
}

/** ошибка, после которой повтор отправки того же журнала не поможет */
export function isFinal(e: TowerErr): boolean {
  return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/** «через 5 ч 12 мин» до сброса попыток; меньше минуты — «меньше минуты» */
export function untilReset(iso: string | undefined, now = serverNow()): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return t("tower.atMidnight");
  const min = Math.max(0, Math.ceil((at - now) / 60000));
  if (min < 1) return t("tower.lessMinute");
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return t("tower.inMin", { m });
  return m === 0 ? t("tower.inH", { h }) : t("tower.inHMin", { h, m });
}
