import { motionAllowed } from "@/lib/walkPrefs";

/**
 * «Жизнь улицы» в «Прогулке»: каждые несколько секунд — одно разовое событие: ховер-кар пересекает квартал
 * (у земли или на воздушной трассе), дальний борт проходит за башней, дрон перелетает, окно зажигается и гаснет.
 * Только разовые WAAPI-прогоны по JS-таймеру (бюджет бесконечных анимаций улицы занят); не больше трёх событий сразу.
 * На слабых устройствах, при «меньше движения» и в фоне — выключено. Координаты — px кадра 720×1280.
 */
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export type LifeKind = "car" | "street" | "far" | "drone" | "window";
/** трассы: y, размер (w×h), длительность пересечения (мс) */
const LANES: Record<"car" | "street" | "far", { y: number[]; w: number; h: number; dur: [number, number] }> = {
  car: { y: [812, 826], w: 26, h: 7, dur: [5200, 7000] }, // воздушная трасса между кварталами
  street: { y: [1004, 1022], w: 44, h: 11, dur: [3200, 4200] }, // у земли — ближе и быстрее
  far: { y: [640, 690], w: 14, h: 4, dur: [8000, 10000] }, // за башней (её закрывает копия башни)
};
/** окна на фасадах (зажигаются ночью и вечером) */
export const LIFE_WINDOWS: [number, number][] = [
  [122, 560], [134, 604], [148, 650], [176, 700], [292, 742], [306, 790], [452, 700], [470, 772],
  [560, 604], [588, 640], [622, 760], [654, 812], [58, 700], [86, 760],
];

/** какое событие сейчас: окна — только когда в городе темно */
export function pickKind(lit: boolean, r = Math.random()): LifeKind {
  if (r < 0.32) return "car";
  if (r < 0.5) return "street";
  if (r < 0.66) return "far";
  if (r < 0.8 || !lit) return "drone";
  return "window";
}

function layer(stage: Element, parent: string, cls: string): HTMLElement | null {
  const host = stage.querySelector(parent);
  if (!host) return null;
  let el = host.querySelector<HTMLElement>(`:scope > .${cls}`);
  if (!el) {
    el = document.createElement("div");
    el.className = cls;
    el.setAttribute("aria-hidden", "true");
    host.appendChild(el);
  }
  return el;
}

export type LifeOpts = { now?: boolean; onEvent?: (k: LifeKind) => void };

/** запустить жизнь улицы; stop() убирает свои элементы, spawn(kind) — показать событие сразу (снимки в dev) */
export function startStreetLife(stage: HTMLElement, opts: LifeOpts = {}): { stop: () => void; spawn: (k: LifeKind) => void } {
  let t = 0;
  let alive = true;
  let active = 0;
  const lit = () => !!stage.querySelector(".cv2.ph-night, .cv2.ph-dusk");

  const spawn = (kind: LifeKind) => {
    const near = layer(stage, ".cv2-life", "walk-near");
    const far = layer(stage, ".cv2-back", "walk-far");
    if (!near || !far) return;
    const host = kind === "far" ? far : near;
    const el = document.createElement("i");
    const done = () => {
      el.remove();
      active--;
    };
    active++;
    opts.onEvent?.(kind);
    const night = lit();
    if (kind === "window") {
      const [x, y] = pick(LIFE_WINDOWS);
      el.className = "wl-win";
      Object.assign(el.style, { left: pc(x, W), top: pc(y, H), width: pc(7, W), height: pc(8, H) });
      host.appendChild(el);
      const hold = rnd(5000, 11000);
      el.animate(
        [{ opacity: 0 }, { opacity: 0.9, offset: 0.04 }, { opacity: 0.6, offset: 0.06 }, { opacity: 1, offset: 0.09 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }],
        { duration: hold, easing: "linear", fill: "both" },
      ).finished.then(done, done);
      return;
    }
    if (kind === "drone") {
      const ltr = Math.random() < 0.5;
      const y = rnd(380, 500);
      const x0 = ltr ? rnd(-20, 200) : rnd(520, 740);
      const dx = (ltr ? 1 : -1) * rnd(160, 260);
      el.className = `wl-drone${night ? " lit" : ""}`;
      Object.assign(el.style, { left: pc(x0, W), top: pc(y, H) });
      el.innerHTML = "<b></b><s></s>";
      host.appendChild(el);
      const wpx = host.clientWidth / W;
      const dur = rnd(5200, 7000);
      el.animate(
        [
          { transform: "translate(0,0)", opacity: 0 },
          { transform: `translate(${dx * 0.25 * wpx}px,${-6 * wpx}px)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${dx * 0.55 * wpx}px,${4 * wpx}px)`, offset: 0.5 },
          { transform: `translate(${dx * 0.85 * wpx}px,${-3 * wpx}px)`, opacity: 1, offset: 0.88 },
          { transform: `translate(${dx * wpx}px,${2 * wpx}px)`, opacity: 0 },
        ],
        { duration: dur, easing: "ease-in-out", fill: "both" },
      ).finished.then(done, done);
      // мигалка — тоже конечная: столько вспышек, сколько длится перелёт
      el.querySelector("s")?.animate([{ opacity: 1 }, { opacity: 0.15, offset: 0.2 }, { opacity: 0.15 }], { duration: 900, iterations: Math.ceil(dur / 900) });
      return;
    }
    const lane = LANES[kind];
    const ltr = Math.random() < 0.5;
    const y = pick(lane.y) + rnd(-3, 3);
    el.className = `wl-car k-${kind}${night ? " lit" : ""}${ltr ? "" : " rtl"}`;
    Object.assign(el.style, { left: pc(ltr ? -lane.w - 10 : W + 10, W), top: pc(y, H), width: pc(lane.w, W), height: pc(lane.h, H) });
    el.innerHTML = "<b></b>";
    host.appendChild(el);
    const span = ((W + lane.w + 20) * host.clientWidth) / W;
    const dur = rnd(lane.dur[0], lane.dur[1]);
    const dy = rnd(-6, 6) * (host.clientWidth / W);
    el.animate([{ transform: "translate(0,0)" }, { transform: `translate(${ltr ? span : -span}px,${dy}px)` }], {
      duration: dur,
      easing: "linear",
      fill: "both",
    }).finished.then(done, done);
  };

  const plan = (ms: number) => {
    t = window.setTimeout(() => {
      if (!alive) return;
      if (!document.hidden && motionAllowed() && active < 3) spawn(pickKind(lit()));
      plan(rnd(2600, 5200));
    }, ms);
  };
  plan(opts.now ? 0 : 1200);

  return {
    stop: () => {
      alive = false;
      window.clearTimeout(t);
      stage.querySelectorAll(".walk-near, .walk-far").forEach((n) => n.remove());
    },
    spawn,
  };
}
