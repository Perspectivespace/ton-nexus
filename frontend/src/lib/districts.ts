import type { CityPhase } from "@/lib/cityPhase";

/**
 * Районы города (PR 2 районов): данные и чистая математика сцены (без DOM, покрыта тестами).
 *
 * Сцена района — 4 слоя рисунка 4:3: небо, дальний горизонт, улица, ближний план. Улица по высоте заполняет экран,
 * поэтому по ширине она ~2,9 экрана телефона: её ведут пальцем (инерция и «резинка» — как в «Прогулке»).
 * Слои едут с разной скоростью: небо 0.25, горизонт 0.55, улица 1, ближний план 1.3 (параллакс).
 * Нарисованы только день и ночь; рассвет и вечер — подкраска поверх (день + розовая дымка, ночь + тёплый закат).
 * Оба района — финальный рисунок (свой дальний план, спрайты жизни улицы): «Неон-ряды» — PR 4, «Порт» — PR 5.
 * На слабых устройствах — одна сведённая картинка без параллакса и без уличных событий.
 */
export type DistrictId = "centre" | "rows" | "port";
export type SceneDistrict = Exclude<DistrictId, "centre">;
export type LayerId = "sky" | "far" | "mid" | "near";
export type Art = "day" | "night";
export type Tint = "dawn" | "dusk" | null;

/** порядок районов на полоске навигации (PR 3): Центр — главная, районы — справа от него */
export const DISTRICT_ORDER: DistrictId[] = ["centre", "rows", "port"];
export const SCENE_DISTRICTS: SceneDistrict[] = ["rows", "port"];
export const DISTRICT_RU: Record<DistrictId, string> = { centre: "Центр", rows: "Неон-ряды", port: "Порт" };

/** слои снизу вверх и их скорость относительно улицы */
export const LAYERS: { id: LayerId; k: number }[] = [
  { id: "sky", k: 0.25 },
  { id: "far", k: 0.55 },
  { id: "mid", k: 1 },
  { id: "near", k: 1.3 },
];
/** пропорции рисунка слоя (ширина / высота) */
export const ART_ASPECT = 4 / 3;

export const isSceneDistrict = (v: unknown): v is SceneDistrict => v === "rows" || v === "port";

/** рисунок и подкраска для фазы суток */
export function lookFor(phase: CityPhase): { art: Art; tint: Tint } {
  if (phase === "day") return { art: "day", tint: null };
  if (phase === "dawn") return { art: "day", tint: "dawn" };
  if (phase === "dusk") return { art: "night", tint: "dusk" };
  return { art: "night", tint: null };
}

/** районы с собственным дальним планом (финальный рисунок); у остальных — общий горизонт skyline-<день/ночь> */
export const OWN_FAR: SceneDistrict[] = ["rows", "port"];
/** у района финальный рисунок (свой дальний план) — значок «Черновик» не показывается */
export const isFinalArt = (d: SceneDistrict) => OWN_FAR.includes(d);

/**
 * Имена файлов (src/assets/districts/*.webp). Дальний горизонт — свой у районов с финальным рисунком (OWN_FAR),
 * у черновых (если появится новый район-эскиз) — общий (skyline-<день/ночь>). lite — слабое устройство: одна сведённая картинка района.
 */
export function layerFiles(d: SceneDistrict, art: Art, lite: boolean): { id: LayerId | "flat"; file: string }[] {
  if (lite) return [{ id: "flat", file: `${d}-${art}-flat` }];
  return [
    { id: "sky", file: `${d}-${art}-sky` },
    { id: "far", file: OWN_FAR.includes(d) ? `${d}-${art}-far` : `skyline-${art}` },
    { id: "mid", file: `${d}-${art}-mid` },
    { id: "near", file: `${d}-${art}-near` },
  ];
}

/**
 * Рекламные поверхности на рисунке улицы (доли рисунка слоя «улица», 4:3; одинаковы днём и ночью).
 * Рисунок здесь пустой (тёмная панель / чистое небо) — реклама ляжет поверх в PR 6. Ключи — места бэкенда.
 * rot — наклон места (градусы, по часовой; вокруг центра): строка на стреле крана идёт вдоль наклонной стрелы.
 */
export type Surface = {
  spot: string;
  kind: "facade_screen" | "line" | "neon" | "banner";
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
};
export const SURFACES: Partial<Record<SceneDistrict, Surface[]>> = {
  rows: [
    { spot: "rows_facade", kind: "facade_screen", x: 0.423, y: 0.398, w: 0.16, h: 0.174 }, // экран на фасаде рынка
    { spot: "rows_line", kind: "line", x: 0.395, y: 0.588, w: 0.228, h: 0.058 }, // строка над навесами
    { spot: "rows_neon", kind: "neon", x: 0.288, y: 0.554, w: 0.066, h: 0.076 }, // вывеска у входа
    { spot: "rows_banner", kind: "banner", x: 0.535, y: 0.27, w: 0.09, h: 0.09 }, // голо-баннер над крышей (чистое небо)
  ],
  port: [
    { spot: "port_line", kind: "line", x: 0.228, y: 0.264, w: 0.222, h: 0.03, rot: 16 }, // строка вдоль стрелы крана
    { spot: "port_banner_cargo", kind: "banner", x: 0.295, y: 0.413, w: 0.082, h: 0.067 }, // экран на штабеле контейнеров
    { spot: "port_banner_tram", kind: "banner", x: 0.656, y: 0.412, w: 0.0625, h: 0.056 }, // панель на станции трамвая
    { spot: "port_neon", kind: "neon", x: 0.846, y: 0.366, w: 0.125, h: 0.087 }, // вывеска над воротами склада
  ],
};

/** габарит места с учётом наклона (доли рисунка 4:3) — для проверки, что трассы жизни улицы его не пересекают */
export function surfaceBounds(s: Surface): { x: number; y: number; w: number; h: number } {
  if (!s.rot) return { x: s.x, y: s.y, w: s.w, h: s.h };
  const a = (s.rot * Math.PI) / 180;
  const W = s.w * ART_ASPECT; // в долях высоты: ширина рисунка = 4/3 высоты
  const bw = (Math.abs(W * Math.cos(a)) + Math.abs(s.h * Math.sin(a))) / ART_ASPECT;
  const bh = Math.abs(W * Math.sin(a)) + Math.abs(s.h * Math.cos(a));
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

/**
 * Камера к месту (PR 6b): сдвиг камеры, при котором центр места (доли рисунка улицы) — по центру экрана.
 * Слой «улица» по ширине = ширина улицы sw и стоит центром в центре экрана при x = 0; результат — в границах панорамы.
 */
export function cameraXFor(s: Surface, sw: number, range: number): number {
  const b = surfaceBounds(s);
  const x = -(b.x + b.w / 2 - 0.5) * sw;
  return Math.max(-range, Math.min(range, x));
}
/** место целиком на экране шириной vw при сдвиге камеры x (с полями margin, px) */
export function surfaceOnScreen(s: Surface, x: number, sw: number, vw: number, margin = 12): boolean {
  const b = surfaceBounds(s);
  const left = vw / 2 + (b.x - 0.5) * sw + x;
  const right = left + b.w * sw;
  return left >= margin && right <= vw - margin;
}

/**
 * Точка покоя камеры района: прямой вход и проезд от соседа заканчиваются здесь, а не строго в центре улицы.
 * В центре «Порта» и «Неон-рядов» места рекламы резались краем экрана (строка на кране, баннеры). Ищем ближайший
 * к центру сдвиг, при котором ни одно место не обрезано (каждое либо целиком на экране, либо целиком за ним),
 * при равенстве — где целиком видно больше мест. Нет такого сдвига — центр.
 */
export function restX(d: SceneDistrict, vw: number, vh: number, margin = 6): number {
  const list = SURFACES[d] ?? [];
  const sw = streetWidth(vw, vh);
  const range = panRange(vw, vh);
  let best = 0;
  let score = -1;
  for (let i = 0; i <= 2 * Math.ceil(range); i++) {
    const x = (i % 2 ? 1 : -1) * Math.ceil(i / 2); // 0, 1, −1, 2, −2 … — от центра к краям
    if (Math.abs(x) > range) continue;
    let full = 0;
    let cut = false;
    for (const s of list) {
      const b = surfaceBounds(s);
      const left = vw / 2 + (b.x - 0.5) * sw + x;
      const right = left + b.w * sw;
      if (left >= margin && right <= vw - margin) full++;
      else if (right > 0 && left < vw) cut = true;
    }
    if (!cut && full > score) {
      best = x;
      score = full;
    }
  }
  return best;
}

/** соседние районы со своей сценой (их слои подкачиваются в простое) */
export function neighbours(d: SceneDistrict): SceneDistrict[] {
  const i = DISTRICT_ORDER.indexOf(d);
  return [DISTRICT_ORDER[i - 1], DISTRICT_ORDER[i + 1]].filter(isSceneDistrict);
}

/** ширина улицы (px): рисунок по высоте экрана, но не уже экрана */
export const streetWidth = (vw: number, vh: number) => Math.max(vw, Math.round(vh * ART_ASPECT));
/** сколько экранов в ширину улица */
export const streetScreens = (vw: number, vh: number) => streetWidth(vw, vh) / Math.max(1, vw);
/** насколько можно увести улицу от центра в каждую сторону (px) */
export const panRange = (vw: number, vh: number) => Math.max(0, (streetWidth(vw, vh) - vw) / 2);
/**
 * Ширина коробки слоя: слой со скоростью k проходит за панораму k·(ширина улицы − экран), поэтому коробка
 * ровно настолько шире экрана — края слоя не показываются ни в одной точке панорамы.
 */
export const layerBoxWidth = (k: number, vw: number, vh: number) => Math.round(vw + k * (streetWidth(vw, vh) - vw));
/** сдвиг слоя (px) при сдвиге камеры x */
export const layerX = (k: number, x: number) => k * x;

/**
 * Запуск по прямой ссылке: start_param «district-rows» / «district-port» (открыта всем игрокам).
 */
export function districtFromStart(startParam: string | null | undefined): SceneDistrict | null {
  const m = /^district-(rows|port)$/.exec(String(startParam ?? ""));
  return m ? (m[1] as SceneDistrict) : null;
}

/**
 * Трасса разового уличного события: высота (доля кадра), размер (доля ширины / высоты кадра), длительность (мс).
 * sprite — нарисованный спрайт (src/assets/districts/life), bob — покачивание шага (доля высоты спрайта).
 * x — участок пути (доли ширины рисунка: откуда и докуда), если едет не через всю улицу: трамвай — только по эстакаде,
 * катер — только по воде; на концах участка проявляется и гаснет.
 */
export type Sprite = "car" | "drone" | "walker" | "tram" | "boat";
export type Lane = {
  kind: "car" | "tram" | "boat" | "drone" | "walker";
  y: number;
  w: number;
  h: number;
  dur: [number, number];
  sprite?: Sprite;
  bob?: number;
  x?: [number, number];
};
/** пропорции спрайтов (ширина / высота) — по ним h трассы = w · 4/3 / пропорция */
export const SPRITE_ASPECT: Record<Sprite, number> = { car: 4.098, drone: 1.574, walker: 0.546, tram: 4.528, boat: 2.8 };
const sized = (sprite: Sprite, y: number, w: number, dur: [number, number], bob?: number, x?: [number, number]): Lane => ({
  kind: sprite,
  sprite,
  y,
  w,
  h: Number(((w * ART_ASPECT) / SPRITE_ASPECT[sprite]).toFixed(4)),
  dur,
  ...(bob ? { bob } : {}),
  ...(x ? { x } : {}),
});
/** трассы событий по районам (в долях рисунка улицы); не пересекают рекламные поверхности (SURFACES) */
export const LANES: Record<SceneDistrict, Lane[]> = {
  rows: [
    sized("car", 0.21, 0.05, [6500, 8500]), // ховер-кар над куполом рынка
    sized("car", 0.15, 0.028, [9000, 12000]), // дальняя воздушная трасса
    sized("drone", 0.105, 0.026, [11000, 14000]), // дрон-курьер с посылкой
    sized("walker", 0.75, 0.0614, [20000, 26000], 0.02), // прохожий под зонтом по мостовой
  ],
  port: [
    sized("tram", 0.506, 0.085, [9000, 11000], 0, [0.39, 0.84]), // небо-трамвай по эстакаде (от штабеля до склада)
    sized("boat", 0.675, 0.045, [15000, 19000], 0, [0, 0.5]), // патрульный катер по каналу (между стенкой дальнего причала и тумбами)
    sized("drone", 0.1, 0.022, [11000, 14000]), // дрон-курьер над кранами
    sized("car", 0.165, 0.03, [9000, 12000]), // дальняя воздушная трасса
  ],
};
