import { Component, lazy, Suspense, createElement, type ComponentType, type ReactNode } from "react";
import { RouteSkeleton } from "@/components/RouteSkeleton";
import { ErrorState } from "@/components/ui/States";

/**
 * Разделы грузятся отдельными чанками (главная — в стартовом). Чтобы раздел открывался без задержки:
 * — после загрузки главной в простое подтягиваются вероятные следующие разделы (prefetchLikely);
 * — при наведении / касании ссылки — её раздел (prefetchOnIntent);
 * — при тапе по башне — «Майнер» ещё до старта наезда (CityBuildings).
 * Уже загруженный раздел рендерится синхронно, без Suspense — без кадра-заглушки.
 */
type Loader = () => Promise<ComponentType>;

const LOADERS: Record<string, Loader> = {
  miner: () => import("@/pages/Miner").then((m) => m.Miner),
  tasks: () => import("@/pages/Tasks").then((m) => m.Tasks),
  taskDetail: () => import("@/pages/TaskDetail").then((m) => m.TaskDetail),
  taskCreate: () => import("@/pages/TaskCreate").then((m) => m.TaskCreate),
  wallet: () => import("@/pages/Wallet").then((m) => m.Wallet),
  upgrade: () => import("@/pages/Upgrade").then((m) => m.Upgrade),
  wheel: () => import("@/pages/Wheel").then((m) => m.Wheel),
  owner: () => import("@/pages/Owner").then((m) => m.Owner),
  inbox: () => import("@/pages/Inbox").then((m) => m.Inbox),
  withdraws: () => import("@/pages/WithdrawQueue").then((m) => m.WithdrawQueue),
  deploy: () => import("@/pages/Deploy").then((m) => m.Deploy),
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

/** путь → раздел (для предзагрузки по ссылке) */
export function routeKey(path: string): Key | null {
  const p = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  if (p === "/miner") return "miner";
  if (p === "/tasks") return "tasks";
  if (p === "/tasks/new") return "taskCreate";
  if (p.startsWith("/tasks/")) return "taskDetail";
  if (p === "/wallet") return "wallet";
  if (p === "/upgrade") return "upgrade";
  if (p === "/wheel") return "wheel";
  if (p === "/owner") return "owner";
  if (p === "/inbox") return "inbox";
  if (p === "/withdraws") return "withdraws";
  if (p === "/deploy") return "deploy";
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

const idle = (cb: () => void) => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 2500 });
  else setTimeout(cb, 1200);
};

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
    load(k).then(() => idle(next), () => undefined);
  };
  if (document.readyState === "complete") idle(next);
  else window.addEventListener("load", () => idle(next), { once: true });
}
