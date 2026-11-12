import { describe, expect, it } from "vitest";
import { checkSeed, sha256Hex } from "./seed";

describe("проверка seed карты", () => {
  it("sha256 как на сервере: sha256('<соль>:<seed>')", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("совпадает / не совпадает", async () => {
    const hash = (await sha256Hex("00ff:42"))!;
    expect(await checkSeed(42, "00ff", hash)).toBe("ok");
    expect(await checkSeed("42", "00ff", hash.toUpperCase())).toBe("ok");
    expect(await checkSeed(43, "00ff", hash)).toBe("bad");
    expect(await checkSeed(42, "00fe", hash)).toBe("bad");
  });
});
