// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createReporter, scrubText } from "./errorReport";

const ADDR = "UQ" + "B".repeat(46);
const FAKE_BOT = "bot1234:" + "y".repeat(30); // не настоящий токен

describe("сбор ошибок клиента", () => {
  it("вырезает личное: адреса, initData, суммы, токены, строку запроса", () => {
    const s = scrubText(
      `send ${ADDR} 0:${"cd".repeat(32)} balance 12.3456 TON id 987654321 https://x.app/m?tgWebAppData=abc#hash=1 initData=query_id%3D1 ${FAKE_BOT} me@x.io`,
      500,
    );
    for (const bad of [ADDR, "12.3456", "987654321", "tgWebAppData=abc", "query_id%3D1", FAKE_BOT, "me@x.io"]) expect(s).not.toContain(bad);
    expect(s).toContain("https://x.app/m");
    expect(scrubText("TypeError: x is undefined", 500)).toBe("TypeError: x is undefined");
    expect(scrubText("y ".repeat(900), 100).length).toBeLessThanOrEqual(100);
  });

  it("одна ошибка — один отчёт; всплеск и шум отсекаются", () => {
    const sent: Record<string, unknown>[] = [];
    let now = 0;
    const report = createReporter({ send: (b) => sent.push(JSON.parse(b)), now: () => now });
    const e = new TypeError("boom");
    expect(report("error", e)).toBe(true);
    expect(report("error", e)).toBe(false); // повтор
    expect(report("error", "Script error.")).toBe(false); // чужой скрипт без подробностей
    expect(report("rejection", new Error("Failed to fetch dynamically imported module: /assets/a.js"))).toBe(false);
    expect(report("rejection", "r1")).toBe(true);
    expect(report("rejection", "r2")).toBe(true);
    expect(report("rejection", "r3")).toBe(false); // больше 3 за 10 с
    now = 11_000;
    expect(report("rejection", "r3")).toBe(true);
    expect(sent[0]).toMatchObject({ kind: "error", message: "TypeError: boom", build: "dev" });
    expect(Object.keys(sent[0]).sort()).toEqual(["build", "kind", "message", "platform", "route", "stack"]);
  });

  it("не больше 15 отчётов за запуск", () => {
    let now = 0;
    const sent: string[] = [];
    const report = createReporter({ send: (b) => sent.push(b), now: () => (now += 20_000) });
    for (let i = 0; i < 30; i++) report("error", `e${i}`);
    expect(sent).toHaveLength(15);
  });
});
