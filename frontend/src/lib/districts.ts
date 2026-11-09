import type { CityPhase } from "@/lib/cityPhase";

/**
 * Районы города (PR 2 районов): данные и чистая математика сцены (без DOM, покрыта тестами).
 *
 * Сцена района — 4 слоя рисунка 4:3: небо, дальний горизонт, улица, ближний план. Улица по высоте заполняет экран,
 * поэтому по ширине она ~2,9 экрана телефона: её ведут пальцем (инерция и «резинка» — как в «Прогулке»).
 * Слои едут с разной скоростью: небо 0.25, горизонт 0.55, улица 1, ближний план 1.3 (параллакс).
 * Нарисованы только день и ночь; рассвет и вечер — подкраска поверх (день + розовая дымка, ночь + тёплый закат).
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

/**
 * Имена файлов (src/assets/districts/*.webp). Дальний горизонт общий у всех районов (skyline-<день/ночь>).
 * lite — слабое устройство: одна сведённая картинка района.
 */
export function layerFiles(d: SceneDistrict, art: Art, lite: boolean): { id: LayerId | "flat"; file: string }[] {
  if (lite) return [{ id: "flat", file: `${d}-${art}-flat` }];
  return [
    { id: "sky", file: `${d}-${art}-sky` },
    { id: "far", file: `skyline-${art}` },
    { id: "mid", file: `${d}-${art}-mid` },
    { id: "near", file: `${d}-${art}-near` },
  ];
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
 * Запуск по прямой ссылке: start_param «district-rows» / «district-port» (только владелец — проверяет экран района).
 */
export function districtFromStart(startParam: string | null | undefined): SceneDistrict | null {
  const m = /^district-(rows|port)$/.exec(String(startParam ?? ""));
  return m ? (m[1] as SceneDistrict) : null;
}

/** трасса разового уличного события: высота (доля кадра), размер (доля ширины кадра), длительность (мс) */
export type Lane = { kind: "car" | "tram" | "boat" | "drone"; y: number; w: number; h: number; dur: [number, number] };
/** трассы событий по районам (в долях рисунка улицы) */
export const LANES: Record<SceneDistrict, Lane[]> = {
  rows: [
    { kind: "car", y: 0.335, w: 0.022, h: 0.008, dur: [7000, 9000] }, // воздушная трасса за рынком
    { kind: "car", y: 0.39, w: 0.03, h: 0.01, dur: [5200, 6800] },
    { kind: "drone", y: 0.22, w: 0.012, h: 0.006, dur: [9000, 12000] },
  ],
  port: [
    { kind: "tram", y: 0.455, w: 0.09, h: 0.03, dur: [9000, 11000] }, // по эстакаде к станции
    { kind: "boat", y: 0.655, w: 0.05, h: 0.012, dur: [14000, 18000] },
    { kind: "drone", y: 0.2, w: 0.012, h: 0.006, dur: [9000, 12000] },
  ],
};
