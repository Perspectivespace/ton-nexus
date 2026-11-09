/**
 * Реклама в городе — покупка (PR 5): даты, суммы, статусы, подсказки по ссылке.
 * Всё авторитетное (цена, занятость, проверка текста и ссылки) считает сервер; здесь — только отображение и
 * мгновенные подсказки до ответа сервера.
 */
import type { CityAdMine, CityAdOwner } from "@/api/hooks";

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(t(d) + n * DAY);
/** b − a в сутках */
export const diffDays = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
export const dayRange = (start: string, days: number) => Array.from({ length: Math.max(0, days) }, (_, i) => addDays(start, i));
export const monthOf = (d: string) => d.slice(0, 7);
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_TITLE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export const monthTitle = (ym: string) => `${MONTHS_TITLE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** «12 ноября» */
export const fmtDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** «12 ноя» */
export const fmtDayShort = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`;
/** «12–18 ноя», «28 ноя – 3 дек», один день — «12 ноя» */
export function fmtRange(a: string, b: string): string {
  if (a === b) return fmtDayShort(a);
  if (monthOf(a) === monthOf(b)) return `${Number(a.slice(8, 10))}–${fmtDayShort(b)}`;
  return `${fmtDayShort(a)} – ${fmtDayShort(b)}`;
}

/** Сетка месяца с понедельника: недели по 7 ячеек, вне месяца — null */
export function monthGrid(ym: string): (string | null)[][] {
  const first = `${ym}-01`;
  const lead = (new Date(t(first)).getUTCDay() + 6) % 7;
  const len = diffDays(first, `${addMonths(ym, 1)}-01`);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...dayRange(first, len)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const daysWord = (n: number) => `${n} ${plural(n, "сутки", "суток", "суток")}`;

/** нанотоны → «1.25» (до 4 знаков, без хвостовых нулей) */
export function tonStr(nano: number): string {
  const v = Math.round(nano / 1e5) / 1e4;
  return v.toFixed(4).replace(/\.?0+$/, "");
}
export const ton = (nano: number) => `${tonStr(nano)} TON`;
/** строка TON с сервера («12.5») → нанотоны */
export function tonToNano(s: string | number | null | undefined): number {
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 1e9) : 0;
}

export const FORMAT_RU: Record<string, string> = { line: "Бегущая строка", banner: "Голо-баннер", neon: "Неоновая вывеска" };
export const SPOT_SHORT: Record<string, string> = {
  tower_line: "Строка на башне",
  banner_sky: "Баннер над площадью",
  banner_street: "Баннер у мостовой",
  neon_left: "Вывеска слева",
  neon_right: "Вывеска справа",
};
export const COLOR_RU: Record<string, string> = { cyan: "Циан", magenta: "Маджента", amber: "Янтарь", mint: "Мята", violet: "Фиалка" };

export type ContentField = "title" | "subtitle" | "body" | "link" | "color";
/** К какому полю относится ошибка проверки текста с сервера (по началу сообщения) */
export function contentField(detail: string): ContentField | null {
  if (/^Ссылка/.test(detail)) return "link";
  if (/^Подпись/.test(detail)) return "subtitle";
  if (/^Текст в городе/.test(detail)) return "title";
  if (/^Текст|^Описание/.test(detail)) return "body";
  if (/^Цвет/.test(detail)) return "color";
  return null;
}

// мгновенная подсказка до проверки сервером (сервер — главный; список совпадает с city_ads.SHORTENERS)
const SHORTENERS = new Set(
  ("bit.ly bitly.com tinyurl.com t.co goo.gl ow.ly is.gd v.gd buff.ly cutt.ly rb.gy shorturl.at tiny.cc bit.do clck.ru vk.cc " +
    "u.to rebrand.ly s.id t.ly lnkd.in adf.ly shorte.st qps.ru surl.li goo.su tinyurl.ru short.io bl.ink soo.gd trib.al dlvr.it " +
    "cli.re kutt.it shrtco.de x.gd urlz.fr l.ead.me").split(" "),
);
const TG = new Set(["t.me", "telegram.me"]);
const SHORT_MSG = "Ссылка: сокращатели запрещены — укажите полный адрес";
const isShortener = (host: string) => [...SHORTENERS].some((d) => host === d || host.endsWith(`.${d}`));

/** null — подсказки нет (пусто или похоже на правильную ссылку) */
export function linkHint(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/\s/.test(s)) return "Ссылка: без пробелов";
  let url = s;
  if (/^(t\.me|telegram\.me)\//i.test(s)) url = `https://${s}`;
  if (/^http:\/\//i.test(url)) return "Ссылка: нужен защищённый адрес https://";
  if (!/^https:\/\//i.test(url)) {
    // голый адрес без схемы: сокращатель узнаём сразу, остальное — подсказка про https://
    const bare = /^([a-z0-9-]+(\.[a-z0-9-]+)+)(\/|$)/i.exec(url);
    if (bare && isShortener(bare[1].toLowerCase())) return SHORT_MSG;
    return bare ? "Ссылка: начните с https://" : "Ссылка: только https:// или t.me/…";
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Ссылка: неверный адрес сайта";
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.username || u.password) return "Ссылка: логин и пароль в адресе запрещены";
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) return "Ссылка: адрес по IP запрещён — нужен домен";
  if (!host.includes(".")) return "Ссылка: неверный адрес сайта";
  if (isShortener(host)) return SHORT_MSG;
  if (TG.has(host) && u.pathname.replace(/\/+/g, "") === "") return "Ссылка t.me: укажите канал, бота или чат";
  return null;
}

// ── статусы ──
export type AdTimeline = "upcoming" | "live" | "ended";
export function adTimeline(ad: Pick<CityAdMine, "start" | "end">, today: string): AdTimeline {
  if (ad.start > today) return "upcoming";
  if (ad.end < today) return "ended";
  return "live";
}
export type AdTone = "ok" | "warn" | "danger" | "neon" | "neutral" | "amber";
export function statusView(ad: CityAdMine, today: string): { label: string; tone: AdTone } {
  switch (ad.status) {
    case "pending":
      return { label: ad.moderated ? "Снова на проверке" : "На проверке", tone: "amber" };
    case "approved": {
      const tl = adTimeline(ad, today);
      if (tl === "live") return { label: "В эфире", tone: "ok" };
      if (tl === "upcoming") return { label: "Одобрено", tone: "neon" };
      return { label: "Завершено", tone: "neutral" };
    }
    case "rejected":
      return ad.refunded_nano < ad.paid_nano ? { label: "Снято", tone: "danger" } : { label: "Отклонено", tone: "danger" };
    case "cancelled":
      return { label: "Отменено", tone: "neutral" };
    case "expired":
      return { label: "Завершено", tone: "neutral" };
    default:
      return { label: ad.status, tone: "neutral" };
  }
}
export const canCancel = (ad: CityAdMine) => ad.status === "pending" && !ad.moderated;
export const canEditLink = (ad: CityAdMine, today: string) =>
  (ad.status === "pending" || ad.status === "approved") && ad.end >= today;

/** Непоказанные сутки, начиная с сегодняшних (как city_ads.unshown_days) */
export const unshownDays = (ad: Pick<CityAdMine, "start" | "end">, today: string) =>
  Math.max(diffDays(ad.start > today ? ad.start : today, ad.end) + 1, 0);

/** Сколько вернётся рекламодателю при снятии/отклонении (как city_ads.reject): удержанное + непоказанные сутки из дохода */
export function refundOnReject(ad: CityAdOwner, today: string): number {
  const perDay = ad.days > 0 ? Math.round(ad.total_nano / ad.days) : 0;
  return ad.held_nano + Math.min(ad.revenue_nano, perDay * unshownDays(ad, today));
}
