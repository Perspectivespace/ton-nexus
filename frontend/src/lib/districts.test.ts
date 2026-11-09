import { describe, expect, it } from "vitest";
import {
  ART_ASPECT, districtFromStart, LANES, LAYERS, layerBoxWidth, layerFiles, layerX, lookFor, neighbours, panRange,
  SCENE_DISTRICTS, streetScreens, streetWidth,
} from "./districts";

type Fs = { existsSync(path: URL): boolean; statSync(path: URL): { size: number } };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const asset = (file: string) => new URL(`../assets/districts/${file}.webp`, import.meta.url);

describe("districts: layers and speeds", () => {
  it("four layers at 0.25 / 0.55 / 1 / 1.3, bottom to top", () => {
    expect(LAYERS).toEqual([
      { id: "sky", k: 0.25 },
      { id: "far", k: 0.55 },
      { id: "mid", k: 1 },
      { id: "near", k: 1.3 },
    ]);
  });

  it("day and night are drawn; dawn and dusk are a tint", () => {
    expect(lookFor("day")).toEqual({ art: "day", tint: null });
    expect(lookFor("night")).toEqual({ art: "night", tint: null });
    expect(lookFor("dawn")).toEqual({ art: "day", tint: "dawn" });
    expect(lookFor("dusk")).toEqual({ art: "night", tint: "dusk" });
  });

  it("files: 4 layers with a shared far skyline, one flattened image on low-end; every file exists", () => {
    expect(layerFiles("rows", "night", false).map((f) => f.file)).toEqual(["rows-night-sky", "skyline-night", "rows-night-mid", "rows-night-near"]);
    expect(layerFiles("port", "day", false)[1].file).toBe("skyline-day");
    expect(layerFiles("port", "day", true)).toEqual([{ id: "flat", file: "port-day-flat" }]);
    let total = 0;
    for (const d of SCENE_DISTRICTS)
      for (const art of ["day", "night"] as const)
        for (const lite of [false, true])
          for (const { file } of layerFiles(d, art, lite)) {
            expect(fs.existsSync(asset(file)), file).toBe(true);
            total += fs.statSync(asset(file)).size;
          }
    // черновые рисунки: один район в одном облике — в пределах ~300 КБ
    for (const d of SCENE_DISTRICTS)
      for (const art of ["day", "night"] as const) {
        const one = layerFiles(d, art, false).reduce((s, { file }) => s + fs.statSync(asset(file)).size, 0);
        expect(one, `${d}-${art}`).toBeLessThan(300 * 1024);
      }
    expect(total).toBeGreaterThan(0);
  });

  it("neighbours with their own scene (centre is the main page)", () => {
    expect(neighbours("rows")).toEqual(["port"]);
    expect(neighbours("port")).toEqual(["rows"]);
  });
});

describe("districts: street geometry", () => {
  it("street fills the screen height and is ~2.9 screens wide on phones", () => {
    expect(streetWidth(390, 844)).toBe(Math.round(844 * ART_ASPECT));
    expect(streetScreens(390, 844)).toBeCloseTo(2.89, 1);
    expect(streetScreens(360, 780)).toBeCloseTo(2.89, 1);
    expect(streetWidth(1400, 600)).toBe(1400); // широкий экран: улица не уже экрана
    expect(panRange(1400, 600)).toBe(0);
  });

  it("no layer ever shows its edge across the whole pan", () => {
    for (const [vw, vh] of [[360, 780], [390, 844], [430, 932], [768, 1024]]) {
      const r = panRange(vw, vh);
      for (const { k } of LAYERS) {
        const box = layerBoxWidth(k, vw, vh);
        expect(box).toBeGreaterThanOrEqual(vw);
        for (const x of [-r, -r / 2, 0, r / 2, r]) expect(Math.abs(layerX(k, x))).toBeLessThanOrEqual((box - vw) / 2 + 1);
      }
      expect(layerBoxWidth(1, vw, vh)).toBe(streetWidth(vw, vh)); // улица — ровно рисунок
    }
  });

  it("far layers move slower than the street, near layer faster", () => {
    expect(layerX(0.25, 100)).toBe(25);
    expect(layerX(1.3, -100)).toBeCloseTo(-130);
  });
});

describe("districts: launch link and street lanes", () => {
  it("start_param district-rows / district-port only", () => {
    expect(districtFromStart("district-rows")).toBe("rows");
    expect(districtFromStart("district-port")).toBe("port");
    expect(districtFromStart("district-centre")).toBeNull();
    expect(districtFromStart("fps1")).toBeNull();
    expect(districtFromStart(undefined)).toBeNull();
  });

  it("lanes stay inside the picture", () => {
    for (const d of SCENE_DISTRICTS) {
      expect(LANES[d].length).toBeGreaterThan(0);
      for (const l of LANES[d]) {
        expect(l.y).toBeGreaterThan(0);
        expect(l.y + l.h).toBeLessThan(1);
        expect(l.dur[0]).toBeLessThanOrEqual(l.dur[1]);
      }
    }
  });
});
