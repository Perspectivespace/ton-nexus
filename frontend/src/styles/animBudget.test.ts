import { describe, expect, it } from "vitest";

/* CSS читаем с диска: в vitest импорт «?raw» для .css отдаёт пустую строку, а @types/node в проекте нет. */
type Fs = { readFileSync(path: URL, enc: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const read = (name: string) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const buildings = read("buildings.css");
const city = read("city.css");

/* Бюджет «≤ 19 бесконечных анимаций на экран» (DESIGN.md §12) на маршрутах-зданиях (Майнер):
 * улица скрыта под интерьером, поэтому её петли снимаются совсем — на экране живёт только реактор (2/4/4/7 по тирам).
 * Пауза не годится: остановленная анимация всё равно числится в document.getAnimations(). */
const insideRule = (css: string) =>
  css.split("}").find((r) => r.includes(".city.inside .cv2 *")) ?? "";

describe("anim budget: street loops inside a building", () => {
  it("removes (not pauses) every street animation under .city.inside", () => {
    const rule = insideRule(buildings);
    expect(rule).toMatch(/animation:\s*none\s*!important/);
    expect(rule).toContain("::before");
    expect(rule).toContain("::after");
    expect(buildings).not.toMatch(/\.city\.inside[^{]*\{[^}]*animation-play-state:\s*paused/);
  });

  it("keeps the one-shot city fade-in so returning to Контур does not re-fade", () => {
    expect(insideRule(buildings)).toContain(":not(.cv2-img)");
    const img = city.split("}").find((r) => /\.cv2-img\s*\{/.test(r) && r.includes("animation")) ?? "";
    expect(img).toMatch(/cv2-in/);
    expect(img).not.toMatch(/infinite/);
  });
});
