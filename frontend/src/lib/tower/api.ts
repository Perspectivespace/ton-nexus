import { ApiError } from "@/api/client";
import { serverNow } from "@/lib/cityPhase";

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
  return { status: 0, code: "network", message: "Нет связи с сервером" };
}

/** ошибка, после которой повтор отправки того же журнала не поможет */
export function isFinal(e: TowerErr): boolean {
  return e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/** «через 5 ч 12 мин» до сброса попыток; меньше минуты — «меньше минуты» */
export function untilReset(iso: string | undefined, now = serverNow()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "в 00:00 по Москве";
  const min = Math.max(0, Math.ceil((t - now) / 60000));
  if (min < 1) return "меньше чем через минуту";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `через ${m} мин`;
  return m === 0 ? `через ${h} ч` : `через ${h} ч ${m} мин`;
}
