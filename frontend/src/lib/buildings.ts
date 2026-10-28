/**
 * Разделы-здания (DESIGN.md п. 3.8.3): на маршруте раздела вместо улицы — его нарисованный интерьер.
 * В продукте — только реакторная башня → «Майнер». Входа тапом по башне нет: в раздел ведёт док.
 */
export type BuildingId = "reactor";

export interface Building {
  id: BuildingId;
  route: string;
  /** подпись здания на улице */
  name: string;
  /** раздел, который открыт внутри */
  section: string;
}

export const BUILDINGS: Record<BuildingId, Building> = {
  reactor: {
    id: "reactor",
    route: "/miner",
    name: "Реакторная башня",
    section: "Майнер",
  },
};

export const buildingAt = (pathname: string): Building | undefined =>
  Object.values(BUILDINGS).find((b) => b.route === pathname);

/** none — «уменьшить движение»: интерьер без проявления; иначе — короткое проявление */
export function motionMode(): "none" | "fade" {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "none";
  } catch {
    /* */
  }
  return "fade";
}
