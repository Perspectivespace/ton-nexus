import { getInitData, WebApp } from "@/lib/telegram";
import { BUILD_ID } from "@/lib/version";

/**
 * Сбор ошибок клиента (P6): необработанные исключения и отклонённые промисы уходят на сервер
 * (POST /api/v1/client-errors), владелец видит их в кабинете. Без личных данных: перед отправкой
 * вырезаем адреса TON, initData и подписи, строки запроса, суммы и длинные числа (сервер чистит повторно).
 * Не чаще: одна и та же ошибка — один раз за запуск; не больше 3 отчётов за 10 с и 15 за запуск.
 * Сбой самой отправки молча проглатываем — отчёт об ошибке не должен порождать новые ошибки.
 */
export type ErrorKind = "error" | "rejection" | "render";

const BASE = import.meta.env.VITE_API_BASE || "";
export const REPORT_URL = `${BASE}/api/v1/client-errors`;
const MAX_PER_SESSION = 15;
const BURST = 3;
const BURST_MS = 10_000;

const SCRUB: [RegExp, string][] = [
  [/(tgWebAppData|initData|init_data|query_id|auth_date|hash|signature|token|access_token|key|password|user)=[^&\s"']*/gi, "$1=<hidden>"],
  [/(X-Telegram-Init-Data|Authorization)\s*[:=]\s*\S+/gi, "$1: <hidden>"],
  [/\bbot\d+:[A-Za-z0-9_-]{20,}/g, "<token>"],
  [/\b[EUk0]Q[A-Za-z0-9_-]{46}\b/g, "<addr>"],
  [/(^|[^\w])-?[01]:[0-9a-fA-F]{64}\b/g, "$1<addr>"],
  [/\b[0-9a-fA-F]{32,}\b/g, "<hex>"],
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, "<blob>"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>"],
  [/(^|[^\w.])\d+[.,]\d+(?![\w.])/g, "$1<n>"],
  [/(^|[^\w])\d{5,}(?![\w])/g, "$1<n>"],
];

/** Вырезать личное и обрезать. Адрес страницы — без строки запроса и хэша (там initData Telegram). */
export function scrubText(text: unknown, limit: number): string {
  let s = String(text ?? "").slice(0, limit * 2);
  s = s.replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"')]*/g, "$1");
  for (const [rx, rep] of SCRUB) s = s.replace(rx, rep);
  return s.slice(0, limit).trim();
}

/** Шум, о котором сообщать незачем: чужие скрипты без подробностей, ResizeObserver, догрузка чанков (её чинит перезагрузка) */
const IGNORE = /^Script error\.?$|ResizeObserver loop|dynamically imported module|Importing a module script failed|error loading dynamically/i;

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack ?? "" };
  if (typeof err === "string") return { message: err, stack: "" };
  try {
    return { message: JSON.stringify(err)?.slice(0, 300) ?? String(err), stack: "" };
  } catch {
    return { message: String(err), stack: "" };
  }
}

export interface ReporterDeps {
  send: (body: string) => void;
  now: () => number;
}

const defaultSend = (body: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const init = getInitData();
  if (init) headers["X-Telegram-Init-Data"] = init;
  void fetch(REPORT_URL, { method: "POST", headers, body, keepalive: true, credentials: "omit" }).catch(() => undefined);
};

function platform(): string {
  try {
    return WebApp ? `${WebApp.platform} ${WebApp.version}` : "web";
  } catch {
    return "web";
  }
}

/** Крючок для будущего: кроме сервера, сообщить ещё куда-то (например, показать тост команде). */
type Listener = (kind: ErrorKind, message: string) => void;
const listeners: Listener[] = [];
export const onErrorReported = (fn: Listener) => {
  listeners.push(fn);
  return () => void listeners.splice(listeners.indexOf(fn), 1);
};

export function createReporter(deps: ReporterDeps = { send: defaultSend, now: () => Date.now() }) {
  const seen = new Set<string>();
  const recent: number[] = [];
  let sent = 0;
  return function report(kind: ErrorKind, err: unknown, extraStack = ""): boolean {
    try {
      const d = describe(err);
      if (!d.message || IGNORE.test(d.message)) return false;
      const message = scrubText(d.message, 500);
      const stack = scrubText([d.stack, extraStack].filter(Boolean).join("\n"), 4000);
      const frame = stack.split("\n").find((l) => /at |@/.test(l))?.replace(/:\d+(:\d+)?\)?$/, "") ?? "";
      const key = `${kind}|${message}|${frame}`;
      if (seen.has(key) || sent >= MAX_PER_SESSION) return false;
      const t = deps.now();
      while (recent.length && t - recent[0] > BURST_MS) recent.shift();
      if (recent.length >= BURST) return false;
      seen.add(key);
      recent.push(t);
      sent++;
      deps.send(
        JSON.stringify({ kind, message, stack: stack || null, route: scrubText(location.pathname, 120), build: BUILD_ID, platform: platform().replace(/[^A-Za-z0-9 ._/-]/g, "").slice(0, 120) }),
      );
      listeners.forEach((fn) => fn(kind, message));
      return true;
    } catch {
      return false;
    }
  };
}

export const reportError = createReporter();

let wired = false;
/** Слушатели окна: ошибки скриптов (не загрузки картинок) и отклонённые промисы без обработчика */
export function initErrorReporting() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("error", (e: ErrorEvent) => {
    if (!(e instanceof ErrorEvent)) return; // ошибка загрузки ресурса (img, script) — не наша
    reportError("error", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => reportError("rejection", e.reason));
}
