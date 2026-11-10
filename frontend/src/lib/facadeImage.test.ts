import { describe, expect, it } from "vitest";
import { FACADE_H, FACADE_W, facadeFileError, shrinkForUpload, shrinkScale } from "./facadeImage";

describe("картинка экрана на фасаде", () => {
  it("тип и размер файла", () => {
    expect(facadeFileError(null)).toBeNull();
    expect(facadeFileError({ type: "image/png", size: 1000 })).toBeNull();
    expect(facadeFileError({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
    expect(facadeFileError({ type: "image/webp", size: 10 })).toBeNull();
    expect(facadeFileError({ type: "image/gif", size: 10 })).toMatch(/PNG, JPG или WebP/);
    expect(facadeFileError({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPG или WebP/);
    expect(facadeFileError({ type: "image/png", size: 0 })).toMatch(/Пустой/);
    expect(facadeFileError({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 МБ/);
  });

  it("уменьшение только больших картинок, пропорция сохраняется", () => {
    expect(shrinkScale(1200, 900)).toBe(1);
    expect(shrinkScale(4000, 3000)).toBeCloseTo(0.4);
    expect(shrinkScale(1000, 3200)).toBeCloseTo(0.5);
  });

  it("пропорция экрана — как у места на рисунке (≈ 1,23 : 1)", () => {
    expect(FACADE_W / FACADE_H).toBeCloseTo((0.16 * 4) / (0.174 * 3), 1);
  });

  it("без canvas (старый WebView, тесты) — уходит исходный файл", async () => {
    const f = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    expect(await shrinkForUpload(f)).toBe(f);
  });
});
