import { beforeAll, describe, expect, it, vi } from "vitest";

// тесты идут в среде node, а клиент API тянет telegram.ts, который читает window при загрузке
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= {};
});

let ApiError: typeof import("@/api/client").ApiError;
let isFinal: typeof import("./api").isFinal;
let parseTowerError: typeof import("./api").parseTowerError;
let untilReset: typeof import("./api").untilReset;

beforeAll(async () => {
  ({ ApiError } = await import("@/api/client"));
  ({ isFinal, parseTowerError, untilReset } = await import("./api"));
});

describe("parseTowerError", () => {
  it("разбирает detail-объект", () => {
    const e = new ApiError(409, JSON.stringify({ code: "no_attempts", message: "нет", next_reset_at: "2026-10-28T21:00:00+00:00" }));
    expect(parseTowerError(e)).toEqual({ status: 409, code: "no_attempts", message: "нет", nextResetAt: "2026-10-28T21:00:00+00:00" });
  });
  it("строковый detail и сеть", () => {
    expect(parseTowerError(new ApiError(500, "boom"))).toMatchObject({ code: "http_500", message: "boom" });
    expect(parseTowerError(new TypeError("Failed to fetch"))).toMatchObject({ status: 0, code: "network" });
  });
  it("повторять имеет смысл только сеть, 5xx, 408 и 429", () => {
    expect(isFinal(parseTowerError(new ApiError(422, "{}")))).toBe(true);
    expect(isFinal(parseTowerError(new ApiError(409, "{}")))).toBe(true);
    expect(isFinal(parseTowerError(new ApiError(500, "x")))).toBe(false);
    expect(isFinal(parseTowerError(new ApiError(429, "x")))).toBe(false);
    expect(isFinal(parseTowerError(new TypeError("x")))).toBe(false);
  });
});

describe("untilReset", () => {
  const now = Date.parse("2026-10-28T16:00:00Z");
  it("часы и минуты, минуты округляются вверх", () => {
    expect(untilReset("2026-10-28T21:00:00Z", now)).toBe("через 5 ч");
    expect(untilReset("2026-10-28T21:12:10Z", now)).toBe("через 5 ч 13 мин");
    expect(untilReset("2026-10-28T16:42:00Z", now)).toBe("через 42 мин");
    expect(untilReset("2026-10-28T16:00:20Z", now)).toBe("через 1 мин");
    expect(untilReset("2026-10-28T15:59:00Z", now)).toBe("меньше чем через минуту");
  });
  it("без даты — общая подпись", () => {
    expect(untilReset(undefined, now)).toBe("в 00:00 по Москве");
  });
});
