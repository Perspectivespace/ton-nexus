import type { Lane } from "@/lib/districts";

/**
 * Жизнь улицы района: раз в несколько секунд — одно разовое событие (ховер-кар, трамвай к станции, катер, дрон).
 * Только разовые WAAPI-прогоны по JS-таймеру — бесконечных анимаций нет (бюджет экрана ≤ 19 петель).
 * Не больше двух событий сразу; в фоне вкладки — пропуск. Включает экран района только на сильных устройствах
 * без «меньше движения». Элементы живут внутри слоя улицы и едут вместе с ним (параллакс).
 */
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const MAX_ACTIVE = 2;

export function startDistrictLife(host: HTMLElement, lanes: Lane[], opts: { first?: number } = {}) {
  let alive = true;
  let active = 0;
  let t = 0;

  const spawn = (lane: Lane) => {
    if (!alive || active >= MAX_ACTIVE || typeof host.animate !== "function") return;
    const el = document.createElement("div");
    el.className = `dz-mover ${lane.kind}`;
    el.setAttribute("aria-hidden", "true");
    const ltr = Math.random() < 0.5;
    el.style.top = `${(lane.y * 100).toFixed(2)}%`;
    el.style.width = `${(lane.w * 100).toFixed(2)}%`;
    el.style.height = `${(lane.h * 100).toFixed(2)}%`;
    if (!ltr) el.style.scale = "-1 1";
    host.appendChild(el);
    active++;
    // только transform и opacity — движение целиком на компоновщике
    const W = host.clientWidth || 1;
    const a = `translate3d(${Math.round(ltr ? -0.1 * W : 1.1 * W)}px,0,0)`;
    const b = `translate3d(${Math.round(ltr ? 1.1 * W : -0.1 * W)}px,0,0)`;
    const anim = el.animate(
      [
        { transform: a, opacity: 0 },
        { opacity: 1, offset: 0.06 },
        { opacity: 1, offset: 0.94 },
        { transform: b, opacity: 0 },
      ],
      { duration: rnd(lane.dur[0], lane.dur[1]), easing: "linear", fill: "forwards" },
    );
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

  return {
    spawn: (i = 0) => lanes[i] && spawn(lanes[i]),
    stop: () => {
      alive = false;
      window.clearTimeout(t);
      for (const el of host.querySelectorAll(".dz-mover")) el.remove();
    },
  };
}
