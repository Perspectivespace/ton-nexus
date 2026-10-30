/**
 * Месяц топа «Башни» по Москве (UTC+3 без летнего времени, как `gameday.py` на сервере)
 * и обратный отсчёт до 00:00 МСК 1-го числа — когда топ закрывается.
 * «Сейчас» — по часам сервера (`serverNow`): у телефона с неверными часами отсчёт и месяц не съезжают.
 */
import { serverNow } from "@/lib/cityPhase";

const MSK_MS = 3 * 3600_000;

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const pad = (n: number) => String(n).padStart(2, "0");

function parse(key: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? [y, mo] : null;
}

/** «2026-10» — месяц по Москве для момента `now` */
export function mskMonth(now = serverNow()): string {
  const d = new Date(now + MSK_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** предыдущий месяц: «2026-01» → «2025-12» */
export function prevMonth(key: string): string {
  const p = parse(key);
  if (!p) return key;
  const [y, m] = p;
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** конец месяца — 00:00 МСК 1-го числа следующего (мс, UTC) */
export function monthEnd(key: string): number {
  const p = parse(key);
  if (!p) return NaN;
  const [y, m] = p;
  return Date.UTC(y, m, 1) - MSK_MS; // Date.UTC: месяц с нуля, поэтому `m` — уже следующий
}

/** «Октябрь» (или «Октябрь 2025», если год не текущий) */
export function monthTitle(key: string, now = serverNow()): string {
  const p = parse(key);
  if (!p) return key;
  const [y, m] = p;
  return y === Number(mskMonth(now).slice(0, 4)) ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

/** «октября» — для «Итоги октября», «1 ноября» */
export function monthGenitive(key: string): string {
  const p = parse(key);
  return p ? MONTHS_GEN[p[1] - 1] : key;
}

/** «октябре» — для «В октябре никто не играл» */
export function monthPrepositional(key: string): string {
  return monthGenitive(key).replace(/[яа]$/, "е");
}

/** «1 ноября» — день, когда закрывается топ месяца `key` */
export function closesOn(key: string): string {
  const p = parse(key);
  return p ? `1 ${MONTHS_GEN[p[1] % 12]}` : "";
}

export type Countdown = { days: number; h: number; m: number; s: number; over: boolean };

/** Сколько осталось до `endsAt` (ISO или мс). Неверная дата или прошедшая — нули и `over`. */
export function countdown(endsAt: string | number | undefined, now = serverNow()): Countdown {
  const t = typeof endsAt === "number" ? endsAt : endsAt ? Date.parse(endsAt) : NaN;
  const left = Number.isFinite(t) ? Math.max(0, Math.floor((t - now) / 1000)) : 0;
  return {
    days: Math.floor(left / 86400),
    h: Math.floor((left % 86400) / 3600),
    m: Math.floor((left % 3600) / 60),
    s: left % 60,
    over: left === 0,
  };
}

/** «12 д 04:05:09», в последние сутки — «04:05:09» */
export function formatCountdown(c: Countdown): string {
  const hms = `${pad(c.h)}:${pad(c.m)}:${pad(c.s)}`;
  return c.days > 0 ? `${c.days} д ${hms}` : hms;
}

/** «12 дней 4 часа» — для чтения с экрана (раз в минуту, не каждую секунду) */
export function spokenCountdown(c: Countdown): string {
  const plural = (n: number, one: string, few: string, many: string) => {
    const a = n % 10;
    const b = n % 100;
    return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
  };
  const parts: string[] = [];
  if (c.days) parts.push(`${c.days} ${plural(c.days, "день", "дня", "дней")}`);
  if (c.h) parts.push(`${c.h} ${plural(c.h, "час", "часа", "часов")}`);
  if (!c.days) parts.push(`${c.m} ${plural(c.m, "минута", "минуты", "минут")}`);
  return parts.join(" ");
}
