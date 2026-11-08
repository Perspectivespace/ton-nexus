import { WebApp } from "@/lib/telegram";
import { tgOrientation } from "@/lib/walkPrefs";
import { tiltVec, type Vec } from "@/lib/walkMath";

/**
 * Наклон телефона для параллакса «Прогулки»: датчик Telegram (DeviceOrientation, Bot API 8.0+),
 * иначе браузерный deviceorientation. Ноль — положение при включении; он медленно «доезжает» за рукой,
 * чтобы смена хвата не уводила город в сторону. Возвращает функцию остановки.
 */
const DRIFT = 0.004;

export function startTilt(cb: (v: Vec) => void): () => void {
  let base: { beta: number; gamma: number } | null = null;
  const feed = (beta: number, gamma: number) => {
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    if (!base) base = { beta, gamma };
    base = { beta: base.beta + (beta - base.beta) * DRIFT, gamma: base.gamma + (gamma - base.gamma) * DRIFT };
    cb(tiltVec(beta, gamma, base));
  };

  const tg = tgOrientation();
  if (tg) {
    const on = () => feed(tg.beta ?? NaN, tg.gamma ?? NaN);
    try {
      WebApp.onEvent("deviceOrientationChanged", on);
      tg.start({ refresh_rate: 40 });
    } catch {
      /* старый клиент */
    }
    return () => {
      try {
        WebApp.offEvent("deviceOrientationChanged", on);
        tg.stop();
      } catch {
        /* старый клиент */
      }
    };
  }

  const rad = Math.PI / 180;
  const on = (e: DeviceOrientationEvent) => feed((e.beta ?? NaN) * rad, (e.gamma ?? NaN) * rad);
  const P = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  let alive = true;
  const attach = () => alive && window.addEventListener("deviceorientation", on);
  // iOS Safari спрашивает разрешение (только по жесту пользователя); отказ — просто без наклона
  if (P?.requestPermission) P.requestPermission().then((r) => r === "granted" && attach(), () => undefined);
  else attach();
  return () => {
    alive = false;
    window.removeEventListener("deviceorientation", on);
  };
}
