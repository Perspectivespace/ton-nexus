import { idleWhenQuiet } from "@/lib/quiet";
import { Component, lazy, Suspense, createElement, type ComponentType, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { RouteSkeleton } from "@/components/RouteSkeleton";
import { ErrorState } from "@/components/ui/States";
import { warmFonts } from "@/lib/fontWarm";

/**
 * Разделы грузятся отдельными чанками (главная — в стартовом). Чтобы раздел открывался без задержки:
 * — после загрузки главной в простое подтягиваются вероятные следующие разделы (prefetchLikely);
 * — при наведении / касании ссылки — её раздел (prefetchOnIntent).
 * Уже загруженный раздел рендерится синхронно, без Suspense — без кадра-заглушки.
 */
type Loader = () => Promise<ComponentType>;

const LOADERS: Record<string, Loader> = {
  miner: () => import("@/pages/Miner").then((m) => m.Miner),
  tasks: () => import("@/pages/Tasks").then((m) => m.Tasks),
  taskDetail: () => import("@/pages/TaskDetail").then((m) => m.TaskDetail),
  taskCreate: () => import("@/pages/TaskCreate").then((m) => m.TaskCreate),
  wallet: () => import("@/pages/Wallet").then((m) => m.Wallet),
  // не раздел, а чанк стойки для шторки «Усиление реактора» на Майнере — только для фоновой подгрузки
  upgrade: () => import("@/components/UpgradeStand").then((m) => m.UpgradeStand),
  wheel: () => import("@/pages/Wheel").then((m) => m.Wheel),
  owner: () => import("@/pages/Owner").then((m) => m.Owner),
  inbox: () => import("@/pages/Inbox").then((m) => m.Inbox),
  withdraws: () => import("@/pages/WithdrawQueue").then((m) => m.WithdrawQueue),
  deploy: () => import("@/pages/Deploy").then((m) => m.Deploy),
  tower: () => import("@/pages/Tower").then((m) => m.default),
  towerTop: () => import("@/pages/TowerTop").then((m) => m.default),
};
type Key = keyof typeof LOADERS;

const loaded: Partial<Record<Key, ComponentType>> = {};
const pending: Partial<Record<Key, Promise<ComponentType>>> = {};

function load(key: Key): Promise<ComponentType> {
  return (pending[key] ??= LOADERS[key]().then(
    (c) => (loaded[key] = c),
    (e) => {
      delete pending[key]; // сеть моргнула — следующая попытка загрузит заново
      throw e;
    },
  ));
}

/**
 * Старые и новые адреса разделов дока (DESIGN.md §14): /earn → Заработок (/tasks), /profile → Профиль (/wallet),
 * /upgrade → Майнер с открытой шторкой «Усиление реактора». Остальные параметры адреса (?tab=…) сохраняются.
 */
export const ALIASES: Record<string, string> = {
  "/earn": "/tasks",
  "/profile": "/wallet",
  "/upgrade": "/miner?upgrade=1",
};

/** Куда ведёт псевдоним с учётом query: aliasTarget("/earn", "?tab=promo") → "/tasks?tab=promo" */
export function aliasTarget(path: string, search = ""): string | null {
  const p = path.replace(/\/+$/, "") || "/";
  const to = ALIASES[p];
  if (!to) return null;
  const [base, q0] = to.split("?");
  const q = new URLSearchParams(q0 ?? "");
  new URLSearchParams(search).forEach((v, k) => q.set(k, v));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** <Route element> для псевдонима: replace, чтобы «Назад» не возвращал на старый адрес */
export function Alias() {
  const loc = useLocation();
  return <Navigate to={aliasTarget(loc.pathname, loc.search) ?? "/"} replace />;
}

/** путь → раздел (для предзагрузки по ссылке) */
export function routeKey(path: string): Key | null {
  const raw = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  const alias = aliasTarget(raw);
  const p = alias ? alias.replace(/[?#].*$/, "") : raw;
  if (p === "/miner") return "miner";
  if (p === "/tasks") return "tasks";
  if (p === "/tasks/new") return "taskCreate";
  if (p.startsWith("/tasks/")) return "taskDetail";
  if (p === "/wallet") return "wallet";
  if (p === "/wheel") return "wheel";
  if (p === "/owner") return "owner";
  if (p === "/inbox") return "inbox";
  if (p === "/withdraws") return "withdraws";
  if (p === "/deploy") return "deploy";
  if (p === "/tower") return "tower";
  if (p === "/tower/top") return "towerTop";
  return null;
}

/** Подтянуть чанк раздела; промис разрешается, когда раздел готов к синхронному рендеру. Ошибки глотает. */
export function prefetchRoute(path: string): Promise<void> {
  const k = routeKey(path);
  return k ? load(k).then(() => undefined, () => undefined) : Promise.resolve();
}

/** Раздел для <Route element>: загруженный — сразу, иначе lazy + скелетон «Ночного контура» */
const cache: Partial<Record<Key, ReactNode>> = {};
export function route(key: Key): ReactNode {
  if (cache[key]) return cache[key];
  const L = lazy(() => load(key).then((c) => ({ default: c })));
  function RouteView() {
    const C = loaded[key];
    return C ? createElement(C) : createElement(L);
  }
  RouteView.displayName = `Route(${key})`;
  return (cache[key] = (
    <ChunkBoundary>
      <Suspense fallback={<RouteSkeleton />}>
        <RouteView />
      </Suspense>
    </ChunkBoundary>
  ));
}

/** Чанк не загрузился (сеть, или после деплоя старый файл удалён) — один раз тихо перезагружаем, иначе — «Повторить» */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    if (isChunkError(e)) reloadOnce();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        title="Раздел не загрузился"
        message="Проверьте связь и попробуйте ещё раз."
        onRetry={() => location.reload()}
      />
    );
  }
}

const isChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(String((e as Error)?.message ?? e));

const RELOAD_KEY = "tn-chunk-reload";
function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return;
  }
  location.reload();
}

let wired = false;
/** Один раз за запуск: предзагрузка по намерению (наведение/касание/фокус ссылки) и в простое после главной */
export function initRoutePrefetch() {
  if (wired) return;
  wired = true;
  // vite: не загрузился preload-чанк — та же логика «одна тихая перезагрузка»
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadOnce();
  });
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* */
    }
  }, 10_000);
  const intent = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    const href = a?.getAttribute("href");
    if (href && href.startsWith("/")) void prefetchRoute(href);
  };
  for (const t of ["pointerover", "touchstart", "focusin"] as const) document.addEventListener(t, intent, { passive: true, capture: true });
}

// фоновая подгрузка — только вне окна смены экрана (lib/quiet.ts): иначе чанки Wheel/Upgrade исполняются посреди первых кадров
const idle = idleWhenQuiet;

/**
 * После первой отрисовки главной: когда страница догрузилась (событие load — город и шрифты уже не делят канал)
 * и браузер простаивает — по одному разделы дока и с главной. Служебные разделы — только по намерению.
 * В режиме экономии трафика — тоже только по намерению.
 */
let likelyStarted = false;
export function prefetchLikely() {
  if (likelyStarted) return;
  likelyStarted = true;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const queue: Key[] = ["miner", "wallet", "tasks", "wheel", "upgrade"];
  const next = () => {
    const k = queue.shift();
    if (!k) return;
    // вместе с чанком майнера — его начертания шрифта (иначе они качаются и перекладывают экран при первом входе)
    if (k === "miner") void warmFonts();
    load(k).then(() => idle(next), () => undefined);
  };
  if (document.readyState === "complete") idle(next);
  else window.addEventListener("load", () => idle(next), { once: true });
}
