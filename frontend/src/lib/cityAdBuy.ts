/**
 * Реклама в городе — покупка (PR 5): даты, суммы, статусы, подсказки по ссылке.
 * Всё авторитетное (цена, занятость, проверка текста и ссылки) считает сервер; здесь — только отображение и
 * мгновенные подсказки до ответа сервера.
 */
import type { CityAdMine, CityAdOwner } from "@/api/hooks";
import { getLang, t as tr, tAll, tmap, tp, type Key } from "@/i18n";

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

const mon = (d: string) => Number(d.slice(5, 7));
const dayOf = (d: string) => Number(d.slice(8, 10));
const en = () => getLang() === "en";

export const monthTitle = (ym: string) => `${tr(`month.${Number(ym.slice(5, 7))}` as Key)} ${ym.slice(0, 4)}`;
/** «12 ноября» · en «November 12» */
export const fmtDay = (d: string) => {
  const m = tr(`month.gen.${mon(d)}` as Key);
  return en() ? `${m} ${dayOf(d)}` : `${dayOf(d)} ${m}`;
};
/** «12 ноя» · en «Nov 12» */
export const fmtDayShort = (d: string) => {
  const m = tr(`monthShort.${mon(d)}` as Key);
  return en() ? `${m} ${dayOf(d)}` : `${dayOf(d)} ${m}`;
};
/** «12–18 ноя», «28 ноя – 3 дек», один день — «12 ноя» · en «Nov 12–18», «Nov 28 – Dec 3» */
export function fmtRange(a: string, b: string): string {
  if (a === b) return fmtDayShort(a);
  if (monthOf(a) === monthOf(b)) return en() ? `${fmtDayShort(a)}–${dayOf(b)}` : `${dayOf(a)}–${fmtDayShort(b)}`;
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
export const daysWord = (n: number) => tp("ad.days", n);

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

const FORMATS = ["line", "banner", "neon", "facade_screen"] as const;
const SPOTS = [
  "tower_line", "banner_sky", "banner_street", "neon_left", "neon_right",
  "rows_facade", "rows_line", "rows_neon", "rows_banner",
  "port_line", "port_banner_cargo", "port_banner_tram", "port_neon",
] as const;
/** названия форматов на языке игрока */
export const FORMAT_RU = tmap("fmt.", FORMATS);
/** короткие названия мест на языке игрока (полные — title с сервера) */
export const SPOT_SHORT = tmap("spot.", SPOTS);
export type AdDistrict = "centre" | "rows" | "port";
export const AD_DISTRICTS: AdDistrict[] = ["centre", "rows", "port"];
/** названия районов на языке игрока */
export const AD_DISTRICT_RU = tmap("district.", AD_DISTRICTS);
/** то же для админки владельца — всегда по-русски */
export const AD_DISTRICT_OWNER = tmap("district.", AD_DISTRICTS, "ru");
export const isAdDistrict = (v: unknown): v is AdDistrict => v === "centre" || v === "rows" || v === "port";
/** район места по ключу (как на сервере: rows_… / port_…, остальные — Центр) */
export const districtOfSpot = (key: string | null | undefined): AdDistrict =>
  key?.startsWith("rows_") ? "rows" : key?.startsWith("port_") ? "port" : "centre";
/** «Неон-ряды · Экран на фасаде рынка» — название места с районом на языке игрока (никогда не ключ) */
export function spotName(spot: string, title?: string | null, district?: string | null): string {
  const d = isAdDistrict(district) ? district : districtOfSpot(spot);
  const name = SPOT_SHORT[spot] ?? (title || tr("spot.any"));
  return `${AD_DISTRICT_RU[d]} · ${name}`;
}
/** название места для игрока: по-русски — полное с сервера, на других языках — из словаря */
export const spotTitle = (key: string, title?: string | null): string =>
  (getLang() === "ru" ? title || SPOT_SHORT[key] : SPOT_SHORT[key] ?? title) ?? tr("spot.any");
/** у формата есть подпись под надписью: голо-баннер и экран на фасаде */
export const hasSubtitle = (f: string) => f === "banner" || f === "facade_screen";
export const COLOR_RU = tmap("ad.color.", ["cyan", "magenta", "amber", "mint", "violet"] as const);

export type ContentField = "title" | "subtitle" | "body" | "link" | "color";
const starts = (detail: string, ...keys: Key[]) => keys.some((k) => tAll(k).some((p) => detail.startsWith(p)));
/** К какому полю относится ошибка проверки текста с сервера (по началу сообщения на любом языке) */
export function contentField(detail: string): ContentField | null {
  if (starts(detail, "ad.field.link")) return "link";
  if (starts(detail, "ad.field.subtitle")) return "subtitle";
  if (starts(detail, "ad.field.title")) return "title";
  if (starts(detail, "ad.field.body", "ad.field.body2")) return "body";
  if (starts(detail, "ad.field.color")) return "color";
  return null;
}

// мгновенная подсказка до проверки сервером (сервер — главный; список совпадает с city_ads.SHORTENERS)
const SHORTENERS = new Set(
  ("bit.ly bitly.com tinyurl.com t.co goo.gl ow.ly is.gd v.gd buff.ly cutt.ly rb.gy shorturl.at tiny.cc bit.do clck.ru vk.cc " +
    "u.to rebrand.ly s.id t.ly lnkd.in adf.ly shorte.st qps.ru surl.li goo.su tinyurl.ru short.io bl.ink soo.gd trib.al dlvr.it " +
    "cli.re kutt.it shrtco.de x.gd urlz.fr l.ead.me").split(" "),
);
const TG = new Set(["t.me", "telegram.me"]);
const isShortener = (host: string) => [...SHORTENERS].some((d) => host === d || host.endsWith(`.${d}`));

/** null — подсказки нет (пусто или похоже на правильную ссылку) */
export function linkHint(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/\s/.test(s)) return tr("ad.link.noSpaces");
  let url = s;
  if (/^(t\.me|telegram\.me)\//i.test(s)) url = `https://${s}`;
  if (/^http:\/\//i.test(url)) return tr("ad.link.http");
  if (!/^https:\/\//i.test(url)) {
    // голый адрес без схемы: сокращатель узнаём сразу, остальное — подсказка про https://
    const bare = /^([a-z0-9-]+(\.[a-z0-9-]+)+)(\/|$)/i.exec(url);
    if (bare && isShortener(bare[1].toLowerCase())) return tr("ad.link.short");
    return bare ? tr("ad.link.startHttps") : tr("ad.link.only");
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return tr("ad.link.bad");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.username || u.password) return tr("ad.link.creds");
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) return tr("ad.link.ip");
  if (!host.includes(".")) return tr("ad.link.bad");
  if (isShortener(host)) return tr("ad.link.short");
  if (TG.has(host) && u.pathname.replace(/\/+/g, "") === "") return tr("ad.link.tg");
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
      return { label: tr(ad.moderated ? "adStatus.repending" : "adStatus.pending"), tone: "amber" };
    case "approved": {
      const tl = adTimeline(ad, today);
      if (tl === "live") return { label: tr("adStatus.live"), tone: "ok" };
      if (tl === "upcoming") return { label: tr("adStatus.approved"), tone: "neon" };
      return { label: tr("adStatus.ended"), tone: "neutral" };
    }
    case "rejected":
      return ad.refunded_nano < ad.paid_nano ? { label: tr("adStatus.removed"), tone: "danger" } : { label: tr("adStatus.rejected"), tone: "danger" };
    case "cancelled":
      return { label: tr("adStatus.cancelled"), tone: "neutral" };
    case "expired":
      return { label: tr("adStatus.ended"), tone: "neutral" };
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

/**
 * Где посмотреть объявление на улице (PR 6b): одобренное и в эфире сегодня, в районе со своей сценой —
 * ссылка на район с местом (камера подъедет к месту и откроет карточку). Центр — «Прогулка» без ссылки на место.
 */
export function streetLink(ad: Pick<CityAdMine, "status" | "start" | "end" | "spot" | "district">, today: string): string | null {
  if (ad.status !== "approved" || ad.start > today || ad.end < today) return null;
  const d = isAdDistrict(ad.district) ? ad.district : districtOfSpot(ad.spot);
  if (d === "centre") return null;
  return `/district?d=${d}&spot=${encodeURIComponent(ad.spot)}`;
}
