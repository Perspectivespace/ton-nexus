import type { Lane, Sprite } from "@/lib/districts";
import carUrl from "@/assets/districts/life/rows-car.webp";
import droneUrl from "@/assets/districts/life/rows-drone.webp";
import walkerUrl from "@/assets/districts/life/rows-walker.webp";
import tramUrl from "@/assets/districts/life/port-tram.webp";
import boatUrl from "@/assets/districts/life/port-boat.webp";

/**
 * Жизнь улицы района: раз в несколько секунд — одно разовое событие (ховер-кар, трамвай к станции, катер, дрон).
 * Только разовые WAAPI-прогоны по JS-таймеру — бесконечных анимаций нет (бюджет экрана ≤ 19 петель).
 * Не больше двух событий сразу; в фоне вкладки — пропуск. Включает экран района только на сильных устройствах
 * без «меньше движения». Элементы живут внутри слоя улицы и едут вместе с ним (параллакс).
 * Финальные районы — нарисованные спрайты: «Неон-ряды» — ховер-кар, дрон-курьер, прохожий под зонтом
 * (шаг — лёгкое покачивание в том же разовом прогоне); «Порт» — небо-трамвай по эстакаде, катер по каналу, дрон и ховер-кар.
 * Трасса с участком пути (lane.x) — едет только по нему и проявляется/гаснет на его концах.
 */
export const SPRITES: Record<Sprite, string> = { car: carUrl, drone: droneUrl, walker: walkerUrl, tram: tramUrl, boat: boatUrl };

/**
 * кадры разового прогона: въезд с краю, проезд, выезд; bob — покачивание (px) каждые ~0,45 с.
 * flip — едет справа налево: зеркалим спрайт ПОСЛЕ сдвига в том же transform (отдельное свойство scale
 * применяется до transform и зеркалило бы сам сдвиг — спрайт уезжал бы за левый край слоя).
 */
export function moverFrames(a: number, b: number, dur: number, bob = 0, flip = false): Keyframe[] {
  const at = (t: number, y = 0) => `translate3d(${Math.round(a + (b - a) * t)}px,${y}px,0)${flip ? " scaleX(-1)" : ""}`;
  if (!bob) {
    return [
      { transform: at(0), opacity: 0 },
      { opacity: 1, offset: 0.06 },
      { opacity: 1, offset: 0.94 },
      { transform: at(1), opacity: 0 },
    ];
  }
  const steps = Math.max(2, Math.round(dur / 450));
  const out: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const opacity = t < 0.04 || t > 0.96 ? 0 : 1;
    out.push({ transform: at(t, i % 2 ? -bob : 0), opacity, offset: t });
  }
  return out;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const MAX_ACTIVE = 2;

export function startDistrictLife(host: HTMLElement, lanes: Lane[], opts: { first?: number } = {}) {
  let alive = true;
  let active = 0;
  let t = 0;

  const spawn = (lane: Lane) => {
    if (!alive || active >= MAX_ACTIVE || typeof host.animate !== "function") return;
    const el = document.createElement("div");
    el.className = `dz-mover ${lane.kind}${lane.sprite ? " sprite" : ""}`;
    el.setAttribute("aria-hidden", "true");
    if (lane.sprite) el.style.backgroundImage = `url("${SPRITES[lane.sprite]}")`;
    const ltr = Math.random() < 0.5;
    el.style.top = `${(lane.y * 100).toFixed(2)}%`;
    el.style.width = `${(lane.w * 100).toFixed(2)}%`;
    el.style.height = `${(lane.h * 100).toFixed(2)}%`;
    host.appendChild(el);
    active++;
    // только transform и opacity — движение целиком на компоновщике
    const W = host.clientWidth || 1;
    const H = host.clientHeight || 1;
    const dur = rnd(lane.dur[0], lane.dur[1]);
    // вся улица — с запасом за краями; участок пути — от его начала до конца (левый край спрайта)
    const [x0, x1] = lane.x ? [lane.x[0] * W, (lane.x[1] - lane.w) * W] : [-0.1 * W, 1.1 * W];
    const a = Math.round(ltr ? x0 : x1);
    const b = Math.round(ltr ? x1 : x0);
    const bob = lane.bob ? Math.max(1, Math.round(lane.bob * lane.h * H)) : 0;
    const anim = el.animate(moverFrames(a, b, dur, bob, !ltr), { duration: dur, easing: "linear", fill: "forwards" });
    const done = () => {
      el.remove();
      active--;
    };
    anim.onfinish = done;
    anim.oncancel = done;
  };

  const loop = () => {
    if (!alive) return;
    if (!document.hidden && lanes.length) spawn(lanes[Math.floor(Math.random() * lanes.length)]);
    t = window.setTimeout(loop, rnd(5000, 11000));
  };
  t = window.setTimeout(loop, opts.first ?? 1200);
  // спрайты — несколько КБ: подкачать заранее, чтобы первый прохожий не появился пустым
  for (const l of lanes) if (l.sprite) new Image().src = SPRITES[l.sprite];

  return {
    spawn: (i = 0) => lanes[i] && spawn(lanes[i]),
    stop: () => {
      alive = false;
      window.clearTimeout(t);
      for (const el of host.querySelectorAll(".dz-mover")) el.remove();
    },
  };
}
