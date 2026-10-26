/**
 * Скрытый счётчик FPS (docs/DESIGN.md, п. «Скорость»). Включается переключателем «Счётчик FPS»
 * в кабинете владельца (вкладка «Обзор») или, как раньше, ссылкой с ?fps=1 (или start_param «fps1»
 * у прямой ссылки на Mini App) и остаётся включённым на этом устройстве (localStorage),
 * пока не выключить переключателем или не открыть ?fps=0 / «fps0». Выключенный стоит ноль: здесь только чтение флага, сам счётчик —
 * отдельный чанк (fpsMeter.ts), который даже не скачивается.
 */
import { WebApp } from "./telegram";

const KEY = "tn-fps";

function flagFromLaunch(): "1" | "0" | null {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get("fps") ?? null;
    if (v === "1" || v === "0") return v;
    const sp = q.get("tgWebAppStartParam") ?? WebApp?.initDataUnsafe?.start_param;
    if (sp === "fps1") return "1";
    if (sp === "fps0") return "0";
  } catch {
    /* */
  }
  return null;
}

/** включён ли счётчик на этом устройстве */
export function isFpsOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** включить/выключить сразу, без перезапуска приложения; выбор запоминается на устройстве */
export function setFpsOn(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* приватный режим: работает до закрытия */
  }
  void import("./fpsMeter").then(
    (m) => (on ? m.startFpsMeter() : m.stopFpsMeter()),
    () => undefined,
  );
}

export function initFps() {
  let on = false;
  try {
    const f = flagFromLaunch();
    if (f === "1") localStorage.setItem(KEY, "1");
    if (f === "0") localStorage.removeItem(KEY);
    on = localStorage.getItem(KEY) === "1";
  } catch {
    return;
  }
  if (on) void import("./fpsMeter").then((m) => m.startFpsMeter(), () => undefined);
}
