import { describe, expect, it } from "vitest";
import { AD_PALETTE, adVars } from "@/lib/cityAdPalette";
import { IDLE_COLOR } from "@/lib/districtIdle";
import { SCENE_DISTRICTS, SURFACES } from "@/lib/districts";

/* Реклама читается в любое время суток: контраст букв и плашки по WCAG (мелкий текст — ≥ 4.5:1).
 * Цвета берём из самих CSS (токены --ad-*, подкраски рассвета/вечера районов, дневные панели города), поэтому
 * ослабление плашки или посветление букв в CSS роняет этот тест.
 * Худший случай: полупрозрачная тёмная плашка поверх белого (солнечное небо, белый фасад, вспышка молнии),
 * светлая панель — поверх чёрного; подкраска рассвета/вечера кладётся поверх всего (так в районах: .dz-tint над слоями).
 * Дождь и туман не учитываем: реклама стоит над дождём (z-index), туман — под ней. */
type Fs = { readFileSync(path: URL, enc: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const read = (name: string) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const ads = read("city-ads.css");
const idle = read("idle-ads.css");
const districts = read("districts.css");
const city = read("city.css");

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const css = (c: string): RGB => (c.startsWith("#") ? hex(c) : (c.match(/\d+/g)!.slice(0, 3).map(Number) as RGB));
const over = (top: RGB, a: number, under: RGB): RGB => top.map((v, i) => v * a + under[i] * (1 - a)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const rule = (src: string, selector: string) => {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`нет правила ${selector}`);
  return src.slice(at, src.indexOf("}", at));
};
const token = (name: string) => {
  const m = rule(ads, ".cads-live, .dz-idles").match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`нет токена ${name}`);
  return m[1].trim();
};
/** подкраска фазы: самая плотная остановка градиента .dz-tint.<фаза> */
const tint = (phase: "dawn" | "dusk"): { c: RGB; a: number } => {
  const stops = [...rule(districts, `.dz-tint.${phase}`).matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)];
  const s = stops.map((m) => ({ c: [+m[1], +m[2], +m[3]] as RGB, a: +m[4] })).sort((p, q) => q.a - p.a)[0];
  return s;
};
const PHASES = ["day", "dawn", "dusk", "night"] as const;
const veil = (phase: (typeof PHASES)[number]) => (phase === "dawn" || phase === "dusk" ? tint(phase) : null);
/** контраст пары с учётом подкраски фазы поверх обоих цветов */
const seen = (fg: RGB, bg: RGB, phase: (typeof PHASES)[number]) => {
  const v = veil(phase);
  return v ? ratio(over(v.c, v.a, fg), over(v.c, v.a, bg)) : ratio(fg, bg);
};
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const MIN = 4.5;
const plate = (): RGB => over(css(`rgb(${token("--ad-plate")})`), Number(token("--ad-plate-a")), WHITE);
const core = (color: string) => css(String((adVars(color) as Record<string, string>)["--ac-core"]));

describe("реклама читается в любое время суток (контраст ≥ 4.5:1)", () => {
  it("голо-баннер и вывеска: заголовок, подпись и неон любого цвета на плашке — во всех фазах", () => {
    const bad: string[] = [];
    for (const phase of PHASES) {
      const ink = seen(css(token("--ad-ink")), plate(), phase);
      if (ink < MIN) bad.push(`${phase} ink ${ink.toFixed(2)}`);
      for (const c of Object.keys(AD_PALETTE)) {
        const r = seen(core(c), plate(), phase);
        if (r < MIN) bad.push(`${phase} ${c} ${r.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("плашка под буквами одна на все фазы и плотная; буквы — из токенов, днём с тёмной обводкой", () => {
    expect(Number(token("--ad-plate-a"))).toBeGreaterThanOrEqual(0.85);
    expect(ads).toMatch(/\.cad-holo::before \{[^}]*var\(--ad-plate-bg\)/);
    expect(idle).toMatch(/\.dz-idle:is\(\.k-banner, \.k-neon\)::before \{[^}]*var\(--ad-plate-bg\)/);
    expect(ads).toMatch(/\.cads-live\.is-unlit \.cad-holo \.t \{[^}]*var\(--ad-outline\)/);
    expect(idle).toMatch(/\.cads-live\.is-unlit\) \.dz-idle:is\(\.k-banner, \.k-neon\) \.t \{[^}]*var\(--ad-outline\)/);
    // бледного дневного стекла больше нет: днём буквы не тёмные на светлом
    expect(ads + idle).not.toMatch(/is-unlit[^{]*\{[^}]*rgba\(2[34]\d, 2[45]\d, 255/);
    expect(ads + idle).not.toMatch(/--ac-ink/);
  });

  it("LED-строка и экран фасада: светлые буквы на тёмном во всех фазах", () => {
    const led = css(rule(ads, ".cad-tick .trk").match(/color:\s*(#[0-9A-Fa-f]{6})/)![1]);
    const board = css(rule(ads, ".cad-tick").match(/background:\s*(#[0-9A-Fa-f]{6})/)![1]);
    const idleLed = css(rule(idle, ".k-line .t").match(/color:\s*(#[0-9A-Fa-f]{6})/)![1]);
    const idleBoard = css(rule(idle, ".dz-idle.k-line").match(/background:\s*(#[0-9A-Fa-f]{6})/)![1]);
    // экран фасада: самый светлый участок фона — фиолетовый верх под янтарным бликом
    const fac = rule(idle, ".dz-idle.k-facade_screen");
    const facBg = over(hex("#FFB547"), Number(fac.match(/rgba\(255, 181, 71, ([\d.]+)\)/)![1]), css(fac.match(/#[0-9A-Fa-f]{6}/)![0]));
    const facText = ["#FFF6E6", "#FFE0AE", "#FFC870"].filter((c) => idle.includes(c)).map(hex);
    expect(facText.length).toBe(3);
    const bad: string[] = [];
    for (const phase of PHASES) {
      for (const [n, fg, bg] of [
        ["tower", led, over(hex(AD_PALETTE.amber), 0.13, board)],
        ["line", idleLed, over(hex(AD_PALETTE.cyan), 0.14, idleBoard)],
        ...facText.map((t, i) => [`facade${i}`, t, facBg] as const),
      ] as const) {
        const r = seen(fg, bg, phase);
        if (r < MIN) bad.push(`${phase} ${n} ${r.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
    // табло днём не светлеет
    expect(ads).not.toMatch(/is-unlit \.cad-tick \{/);
  });

  it("дневные панели города (рассвет/день): тёмные буквы на светлой панели поверх тёмного фасада", () => {
    const bad: string[] = [];
    for (const [phase, sel, small] of [
      ["day", ".cv2 .ad", ".cv2 .ad small"],
      ["dawn", ".ph-dawn.cv2 .ad", ".ph-dawn.cv2 .ad small"],
    ] as const) {
      const r = rule(city, sel);
      const minA = Math.min(...[...r.matchAll(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/g)].filter((m) => !r.slice(0, m.index).includes("box-shadow")).map((m) => +m[1]));
      const panel = over(css(r.match(/rgba\((\d+,\s*\d+,\s*\d+)/)![0]), minA, BLACK);
      for (const c of [r.match(/color:\s*(#[0-9A-Fa-f]{6})/)![1], rule(city, small).match(/color:\s*(#[0-9A-Fa-f]{6})/)![1]]) {
        const k = ratio(hex(c), panel);
        if (k < MIN) bad.push(`${phase} ${c} ${k.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
    expect(city).not.toMatch(/\.cv2 \.ad \{[^}]*opacity:\s*\./);
  });

  it("места районов (Неон-ряды, Порт) рисуются проверенными здесь стилями и цветами — контраст держится во всех фазах", () => {
    const kinds = new Set(["facade_screen", "line", "banner", "neon"]);
    for (const d of SCENE_DISTRICTS) {
      const list = SURFACES[d] ?? [];
      expect(list.length, d).toBe(4);
      for (const s of list) {
        expect(kinds.has(s.kind), `${d} ${s.spot}`).toBe(true);
        expect(Object.keys(AD_PALETTE)).toContain(IDLE_COLOR[s.kind]);
      }
    }
  });
});
