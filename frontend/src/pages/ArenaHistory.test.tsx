import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ArenaHistoryView } from "./ArenaHistory";
import { routeKey } from "@/lib/routes";
import { setLang } from "@/i18n";
import type { ArenaHistory, ArenaHistoryItem } from "@/lib/arena/api";

vi.mock("@/lib/haptics", () => ({ haptic: { tap: () => {} } }));

const item = (p: Partial<ArenaHistoryItem>): ArenaHistoryItem => ({
  room_id: 7, type: "a4", status: "finished", seats: 4, stake_nano: "100000000", place: 1, prize_nano: "360000000",
  net_nano: "260000000", kills: 2, turns: 14, finished_at: "2026-11-12T17:30:00+00:00", ...p,
});
const page = (items: ArenaHistoryItem[], next: number | null = null): ArenaHistory => ({
  items, next_before: next, summary: { played: 3, wins: 1, prizes_nano: "360000000", net_nano: "60000000" },
});
const html = (pages: ArenaHistory[], hasMore = false) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ArenaHistoryView pages={pages} hasMore={hasMore} loadingMore={false} onMore={() => {}} />
    </MemoryRouter>,
  );

describe("история боёв «Арены»", () => {
  it("сводка, строки со ссылкой на итоги, прерванный бой, «Показать ещё»", () => {
    const h = html([
      page([item({}), item({ room_id: 5, type: "a8", seats: 8, place: 5, prize_nano: "0", net_nano: "-100000000", kills: 1, turns: 9 })], 5),
      page([item({ room_id: 3, status: "cancelled", place: null, prize_nano: "0", net_nano: "0", kills: 0, turns: 4 })]),
    ], true);
    expect(h).toContain("+0.06");
    expect(h).toContain("Победы");
    expect(h).toContain('href="/arena/7"');
    expect(h).toContain("#1");
    expect(h).toContain("−0.1");
    expect(h).toContain("2 фрага · 14 ходов");
    expect(h).toContain("Арена 8");
    expect(h).toContain("Бой прерван · ставка вернулась");
    expect(h).toContain("Показать ещё");
  });

  it("пусто — подсказка и ссылка в лобби; английский", () => {
    expect(html([page([])])).toContain("Боёв пока нет");
    setLang("en");
    try {
      expect(html([page([])])).toContain("No matches yet");
      const e = html([page([item({ kills: 1, turns: 1 })])]);
      expect(e).toContain("1 kill · 1 turn");
      expect(e).toContain("Wins");
    } finally {
      setLang("ru");
    }
  });

  it("маршрут /arena/history — свой раздел, не комната", () => {
    expect(routeKey("/arena/history")).toBe("arenaHistory");
    expect(routeKey("/arena/12")).toBe("arenaRoom");
  });
});
