/**
 * «Прогулка» — математика камеры (без DOM, покрыта тестами): границы кадра при зуме, касание или протяжка,
 * «резинка» за краем, скорость отпускания, инерция, параллакс слоёв и наклон телефона.
 * Камера: сцена 720×1280 сдвинута на (x, y) px и увеличена в s раз от верхнего центра (transform-origin 50% 0).
 */
export type Cam = { x: number; y: number; s: number };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
export type Vec = { x: number; y: number };

/** порог «касание или протяжка» (px экрана): меньше — касание вывески, больше — панорама */
export const TAP_SLOP = 8;
/** время затухания инерции (мс): как прокрутка в iOS — скольжение ~1 с */
export const GLIDE_TAU = 325;
/** скорость, ниже которой скольжение останавливается (px/мс) */
export const GLIDE_STOP = 0.01;
/** сопротивление «резинки» за краем кадра при протяжке */
export const RUBBER = 0.35;

/** допустимые сдвиги камеры, чтобы кадр закрывал экран (extraBottom — запас снизу под открытую карточку) */
export function camBounds(stageW: number, stageH: number, s: number, vw: number, vh: number, extraBottom = 0): Bounds {
  const hx = Math.max(0, (stageW * s - vw) / 2);
  return { minX: -hx, maxX: hx, minY: Math.min(0, vh - stageH * s) - Math.max(0, extraBottom), maxY: 0 };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const clampCam = (c: Cam, b: Bounds): Cam => ({ s: c.s, x: clamp(c.x, b.minX, b.maxX), y: clamp(c.y, b.minY, b.maxY) });
export const inBounds = (c: Cam, b: Bounds) => c.x >= b.minX && c.x <= b.maxX && c.y >= b.minY && c.y <= b.maxY;

/** палец сдвинулся дальше порога — это протяжка, а не касание */
export const isDrag = (dx: number, dy: number, slop = TAP_SLOP) => dx * dx + dy * dy > slop * slop;

/** «резинка»: за краем движение ослабевает */
export function rubber(v: number, min: number, max: number, k = RUBBER): number {
  if (v < min) return min - (min - v) * k;
  if (v > max) return max + (v - max) * k;
  return v;
}

export type Sample = { t: number; x: number; y: number };
/** скорость отпускания (px/мс) по последним ~100 мс движения пальца; палец замер перед отпусканием — скорости нет */
export function releaseVelocity(samples: Sample[], now: number, windowMs = 100): Vec {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > 60) return { x: 0, y: 0 };
  const recent = samples.filter((p) => now - p.t <= windowMs);
  const first = recent[0];
  const dt = last.t - first.t;
  if (recent.length < 2 || dt <= 0) return { x: 0, y: 0 };
  const cap = 4; // px/мс — защита от рывков
  return { x: clamp((last.x - first.x) / dt, -cap, cap), y: clamp((last.y - first.y) / dt, -cap, cap) };
}

/**
 * Шаг инерции: скорость затухает экспоненциально; у края кадра ось останавливается.
 * Камера за краем (после «резинки») пружиной возвращается в границы.
 */
export function glideStep(c: Cam, v: Vec, dt: number, b: Bounds): { cam: Cam; v: Vec; done: boolean } {
  const decay = Math.exp(-dt / GLIDE_TAU);
  const spring = 1 - Math.exp(-dt / 90);
  const axis = (p: number, vel: number, min: number, max: number): [number, number] => {
    if (p < min || p > max) {
      const edge = p < min ? min : max;
      const np = p + (edge - p) * spring;
      return [Math.abs(np - edge) < 0.5 ? edge : np, 0];
    }
    let np = p + vel * dt;
    let nv = vel * decay;
    if (np < min || np > max) {
      np = clamp(np, min, max);
      nv = 0;
    }
    return [np, Math.abs(nv) < GLIDE_STOP ? 0 : nv];
  };
  const [x, vx] = axis(c.x, v.x, b.minX, b.maxX);
  const [y, vy] = axis(c.y, v.y, b.minY, b.maxY);
  const cam = { s: c.s, x, y };
  return { cam, v: { x: vx, y: vy }, done: vx === 0 && vy === 0 && inBounds(cam, b) };
}

/** плавность пролёта камеры */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s + (b.s - a.s) * t });

/** зум «Прогулки» и опускание к улице: доля вертикального хода камеры от верха кадра (1 — низ кадра) */
export const WALK_ZOOM = 1.32;
export const WALK_STREET = 0.78;

/** сдвиг слоя глубины (px) относительно города: k < 1 — дальше (отстаёт), k > 1 — ближе (обгоняет) */
export const TILT_LAYER_PX = 26;
export function layerShift(k: number, cam: Cam, rest: Cam, tilt: Vec): Vec {
  return { x: (k - 1) * (cam.x - rest.x + tilt.x * TILT_LAYER_PX), y: (k - 1) * (cam.y - rest.y + tilt.y * TILT_LAYER_PX) };
}

/** наклон телефона → смещение −1…1 по осям (углы в радианах, относительно положения при включении) */
export const TILT_RANGE = 0.35; // ≈ 20°
export function tiltVec(beta: number, gamma: number, base: { beta: number; gamma: number }): Vec {
  return { x: clamp((gamma - base.gamma) / TILT_RANGE, -1, 1), y: clamp((beta - base.beta) / TILT_RANGE, -1, 1) };
}
