/**
 * Интерактивные здания (DESIGN.md п. 3.8.3). В продукте — только реакторная башня → «Майнер»
 * («Обмен» → «Баланс» остался в концепте, ветка concept/city-buildings).
 * Здание на главной → короткий наезд камеры (0,45 с, только transform/opacity) → интерьер раздела.
 * Координаты — в пикселях кадра города 720×1280; у фаз суток геометрия общая, у обликов T1–T4 — своя.
 */
export type BuildingId = "reactor";

/** [x, y, w, h] здания в кадре для обликов T1..T4 */
type Box = [number, number, number, number];

export interface Building {
  id: BuildingId;
  route: string;
  /** подпись здания на улице */
  name: string;
  /** раздел, который откроется внутри */
  section: string;
  box: Record<1 | 2 | 3 | 4, Box>;
}

export const BUILDINGS: Record<BuildingId, Building> = {
  reactor: {
    id: "reactor",
    route: "/miner",
    name: "Реакторная башня",
    section: "Майнер",
    box: { 1: [300, 430, 180, 420], 2: [322, 430, 160, 420], 3: [316, 430, 150, 420], 4: [334, 430, 140, 420] },
  },
};

export const buildingAt = (pathname: string): Building | undefined =>
  Object.values(BUILDINGS).find((b) => b.route === pathname);

export const tierBox = (b: Building, tier: number): Box => b.box[(Math.min(4, Math.max(1, tier)) as 1 | 2 | 3 | 4)];

/** Длительности (мс) */
export const ZOOM_MS = 450;
export const FADE_MS = 220;
export const ZOOM_SCALE = 2.3;
/** через сколько мс после тапа уже монтировать раздел: камера едет на compositor-потоке, а React успевает
 *  отрисовать экран под невидимым контентом — к концу наезда всё готово и в момент смены нет рывка */
export const NAV_AT = { zoom: 150, fade: 40 } as const;

/** none — «уменьшить движение»: без наезда; fade — слабое устройство: простое растворение; zoom — полный наезд */
export function motionMode(): "none" | "fade" | "zoom" {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "none";
  } catch {
    /* */
  }
  return document.documentElement.classList.contains("low-end") ? "fade" : "zoom";
}

/**
 * Куда двигать камеру: центр здания → центр экрана, масштаб вокруг центра здания.
 * Сцена на главной: ширина min(100%, 560px), по центру, сдвинута вверх на 120 px (city.css, .cv2-home).
 */
export function zoomVars(b: Building, tier: number): Record<string, string> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw, 560);
  const h = (w * 1280) / 720;
  const [x, y, bw, bh] = tierBox(b, tier);
  const cx = x + bw / 2;
  const cy = y + bh / 2;
  const l0 = (vw - w) / 2;
  const t0 = -120;
  const px = l0 + (cx / 720) * w;
  const py = t0 + (cy / 1280) * h;
  const s = ZOOM_SCALE;
  // здание — в центр экрана, но края кадра не должны заезжать в экран (здание у края → камера упирается в край)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const dx = clamp(vw / 2 - px, vw - (px + (l0 + w - px) * s), -(px + (l0 - px) * s));
  const dy = Math.min(vh * 0.42 - py, -(py + (t0 - py) * s));
  return {
    "--bz-ox": `${((cx / 720) * 100).toFixed(2)}%`,
    "--bz-oy": `${((cy / 1280) * 100).toFixed(2)}%`,
    "--bz-dx": `${Math.round(dx)}px`,
    "--bz-dy": `${Math.round(dy)}px`,
    "--bz-s": String(ZOOM_SCALE),
  };
}
