/**
 * Свежесть кода. Telegram сворачивает Mini App, а не закрывает: открытый экран часами держит старую сборку
 * (так игрок увидел заглушку боя вместо поля). Сверяем вшитый id сборки с /version.json:
 *  - при возврате на экран и раз в 5 минут — если сборка новая, перезагружаемся (кроме идущего боя);
 *  - перед боем (комната перешла в running) — проверка сразу и перезагрузка даже в бою: сервер держит матч.
 * Защита от петли: id, ради которого уже перезагружались, помним в sessionStorage — второй раз не перезагружаем.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
export const VERSION_URL = "/version.json";
export const VERSION_POLL_MS = 5 * 60_000;
const TRIED_KEY = "tn-build-reload";

export interface VersionDeps {
  build: string;
  fetchBuild: () => Promise<string | null>;
  reload: () => void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

/** id сборки на сервере; сеть/формат подвели — null (ничего не делаем) */
export async function fetchServerBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === "string" && j.build ? j.build : null;
  } catch {
    return null;
  }
}

function session(): VersionDeps["storage"] {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

const defaults = (): VersionDeps => ({
  build: BUILD_ID,
  fetchBuild: fetchServerBuild,
  reload: () => location.reload(),
  storage: session(),
});

/** проверка включена только в собранном приложении */
export const versionCheckEnabled = (build = BUILD_ID) => build !== "dev";

let battle = false;
/** экран идущего боя открыт: фоновая проверка не перезагружает (перед боем — ensureFreshForBattle) */
export function setBattleActive(on: boolean) {
  battle = on;
}

/**
 * Сверить сборку и при расхождении перезагрузиться. force — даже если идёт бой.
 * true — перезагрузка запущена.
 */
export async function checkVersion(opts: { force?: boolean } = {}, deps: Partial<VersionDeps> = {}): Promise<boolean> {
  const d = { ...defaults(), ...deps };
  if (!versionCheckEnabled(d.build)) return false;
  const server = await d.fetchBuild();
  if (!server || server === d.build) return false;
  if (battle && !opts.force) return false;
  try {
    // уже перезагружались ради этой сборки, а код всё старый (кэш WebView) — не крутим петлю
    if (d.storage?.getItem(TRIED_KEY) === server) return false;
    d.storage?.setItem(TRIED_KEY, server);
  } catch {
    return false; // без sessionStorage петлю не остановить — не перезагружаем
  }
  d.reload();
  return true;
}

/** перед показом боя: устаревший код — перезагрузка сразу (матч на сервере, вернёмся в ту же комнату) */
export const ensureFreshForBattle = (deps: Partial<VersionDeps> = {}) => checkVersion({ force: true }, deps);

let wired = false;
/** Один раз за запуск: проверка при возврате на экран, раз в 5 минут и вскоре после старта */
export function initVersionCheck() {
  if (wired || !versionCheckEnabled() || typeof document === "undefined") return;
  wired = true;
  let busy = false;
  const run = () => {
    if (busy || document.visibilityState === "hidden") return;
    busy = true;
    void checkVersion().finally(() => (busy = false));
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  window.setInterval(run, VERSION_POLL_MS);
  window.setTimeout(run, 5_000);
}
