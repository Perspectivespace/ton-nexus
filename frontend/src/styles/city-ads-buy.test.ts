import { describe, expect, it } from "vitest";

type Fs = { readFileSync(path: URL, enc: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const css = fs.readFileSync(new URL("./city-ads-buy.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`нет правила ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("покупка рекламы: кадр «Место»", () => {
  it("четыре района — сетка 2×2, без leftover 3+1", () => {
    expect(rule(".cab-district")).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
  });

  it("номер у верхнего края кадра ставится под рамку", () => {
    const r = rule(".cab-slot.s-badge-below b");
    expect(r).toMatch(/top:\s*100%/);
    expect(r).toMatch(/bottom:\s*auto/);
  });
});
