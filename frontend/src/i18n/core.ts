import { create } from "zustand";
import { ru } from "./ru";
import { en } from "./en";

/**
 * Переводы приложения (docs/i18n.md). Пока два языка — ru и en; новый язык = папка словаря + строка в DICTS.
 * Ключи плоские, с префиксом раздела: "nav.profile", "home.title". Подстановки — {name}.
 * Множественное число — формы через «|»: ru — одна|несколько|много («{n} день|{n} дня|{n} дней»), en — one|other.
 */
export type Key = keyof typeof ru;
export type Dict = Record<Key, string>;
export const DICTS = { ru, en } satisfies Record<string, Dict>;
export type Lang = keyof typeof DICTS;
export const LANGS = Object.keys(DICTS) as Lang[];
export const LANG_NAMES: Record<Lang, string> = { ru: "Русский", en: "English" };
const LOCALES: Record<Lang, string> = { ru: "ru-RU", en: "en-US" };

/** Русскоязычная аудитория (как на сервере, app/core/i18n.py): ru, uk, be, kk → RU, остальные → EN */
const RU_FAMILY = new Set(["ru", "uk", "be", "kk"]);
export function detectLang(languageCode?: string | null): Lang {
  const base = (languageCode ?? "").trim().toLowerCase().replace("_", "-").split("-")[0];
  return RU_FAMILY.has(base) ? "ru" : "en";
}

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as string[]).includes(v);
}

const STORE_KEY = "tn.lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* */
  }
  try {
    const tg = (window as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram;
    const code = tg?.WebApp?.initDataUnsafe?.user?.language_code;
    if (code) return detectLang(code);
  } catch {
    /* */
  }
  return "ru";
}

type LangState = { lang: Lang; setLang: (l: Lang) => void };

export const useLangStore = create<LangState>((set) => ({
  lang: typeof window === "undefined" ? "ru" : initial(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch {
      /* */
    }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    set({ lang });
  },
}));

export const getLang = (): Lang => useLangStore.getState().lang;
export const setLang = (l: Lang) => useLangStore.getState().setLang(l);
export const locale = (l: Lang = getLang()) => LOCALES[l];

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Строка по ключу на текущем языке (нет перевода — русская, нет и её — сам ключ) */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const l = getLang();
  const s = (DICTS[l] as Dict)[key] ?? ru[key] ?? key;
  return fill(s, vars);
}

const rules: Partial<Record<Lang, Intl.PluralRules>> = {};
/** Номер формы для «|»-строки: ru — one / few / many, en — one / other */
export function pluralIndex(n: number, l: Lang = getLang()): number {
  const cat = (rules[l] ??= new Intl.PluralRules(LOCALES[l])).select(Math.abs(n));
  if (l === "ru") return cat === "one" ? 0 : cat === "few" ? 1 : 2;
  return cat === "one" ? 0 : 1;
}

/** Множественное число: tp("time.days", 3) → «3 дня» / «3 days»; {n} в строке — число (форматированное) */
export function tp(key: Key, n: number, vars?: Record<string, string | number>): string {
  const l = getLang();
  const forms = ((DICTS[l] as Dict)[key] ?? ru[key] ?? key).split("|");
  const s = forms[Math.min(pluralIndex(n, l), forms.length - 1)];
  return fill(s, { n: fmtNum(n), ...vars });
}

/** Число по правилам языка: ru — «1 240,5», en — «1,240.5» */
export function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  return Number.isFinite(n) ? n.toLocaleString(locale(), opts) : String(n);
}

/** Дата / время по правилам языка */
export function fmtDate(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? "" : x.toLocaleString(locale(), opts);
}
