// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AD_SPOT_BOX } from "@/components/CityAdSpots";
import { SCENE_DISTRICTS, SURFACES } from "@/lib/districts";
import { CROP_ALL, slotBadgeBelow } from "./AdScene";
import { districtCropAll } from "./DistrictAdScene";

describe("slotBadgeBelow", () => {
  it("нулевая высота кадра — номер сверху", () => {
    expect(slotBadgeBelow(0, 0, 0)).toBe(false);
  });

  it("голо-баннер Арены у самого верха кадра «Место» — номер под рамкой", () => {
    const [, y, , ch] = districtCropAll("arena");
    const s = (SURFACES.arena ?? []).find((v) => v.spot === "arena_banner");
    expect(s).toBeTruthy();
    expect((s!.y - y) / ch).toBeLessThan(0.08);
    expect(slotBadgeBelow(s!.y, y, ch)).toBe(true);
  });

  it("остальные места Арены, Рядов, Порта и все места Центра — номер сверху", () => {
    const below: string[] = [];
    for (const d of SCENE_DISTRICTS) {
      const [, y, , ch] = districtCropAll(d);
      for (const s of SURFACES[d] ?? []) {
        if (slotBadgeBelow(s.y, y, ch)) below.push(s.spot);
      }
    }
    expect(below).toEqual(["arena_banner"]);

    const centreBelow = Object.entries(AD_SPOT_BOX)
      .filter(([, box]) => slotBadgeBelow(box[1], CROP_ALL[1], CROP_ALL[3]))
      .map(([key]) => key);
    expect(centreBelow).toEqual([]);
  });
});
