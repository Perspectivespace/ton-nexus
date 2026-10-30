import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TowerTop from "./TowerTop";
import { TOWER_TOP_LIMIT } from "@/api/hooks";
import type { TowerLeaderboard, TowerLeaderEntry } from "@/api/types";

const NOW = Date.parse("2026-10-19T16:54:51Z");

function entries(n: number, meAt?: number): TowerLeaderEntry[] {
  return Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: `Игрок ${i + 1}`, score: 1000 - i * 10, is_me: i + 1 === meAt }));
}

function board(over: Partial<TowerLeaderboard> = {}): TowerLeaderboard {
  return {
    month: "2026-10",
    entries: entries(12),
    total_players: 57,
    me: { rank: 30, score: 700 },
    month_ends_at: "2026-10-31T21:00:00+00:00",
    min_participants: 10,
    prizes: null,
    ...over,
  };
}

function render(data: TowerLeaderboard | undefined, url = "/tower/top") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const prev = url.includes("m=prev");
  if (data) qc.setQueryData(["tower", "leaderboard", prev ? "2026-09" : "current", TOWER_TOP_LIMIT], data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <TowerTop />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("экран «Топ месяца»", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("пьедестал 2-1-3, места с 4-го, отсчёт до 00:00 МСК 1-го", () => {
    const html = render(board());
    expect(html).toContain("Топ месяца");
    expect(html).toContain("Октябрь");
    expect(html).toContain("57 игроков");
    const podium = html.slice(html.indexOf("tt-podium"), html.indexOf("</ol>"));
    expect(podium.indexOf("tt-step p2")).toBeLessThan(podium.indexOf("tt-step p1"));
    expect(podium.indexOf("tt-step p1")).toBeLessThan(podium.indexOf("tt-step p3"));
    expect(count(html, 'class="tt-row"')).toBe(9); // места 4…12
    expect(html).toContain("12 д 04:05:09");
    expect(html).toContain("До итогов 12 дней 4 часа");
    expect(html).toContain("при равенстве выше тот, кто набрал раньше");
    expect(html).toContain("хватит бесплатных попыток");
  });

  it("без призов — честная строка и ни одного TON", () => {
    const html = render(board());
    expect(html).toContain("Призы пока не назначены");
    expect(html).not.toContain("tt-prize");
    expect(html).not.toContain("TON");
  });

  it("призы включены — чипы на местах и условие по числу игроков", () => {
    const prizes = [
      { place: 1, ton: "5" },
      { place: 2, ton: "3" },
      { place: 3, ton: "1.5" },
      { place: 4, ton: "1" },
    ];
    const html = render(board({ prizes, total_players: 7 }));
    expect(count(html, 'class="tt-prize"')).toBe(4);
    expect(html).toContain("5 TON");
    expect(html).toContain("1.5 TON");
    expect(html).toContain("Призы за места 1–4");
    expect(html).toContain("нужно от 10 игроков, сейчас 7");
    expect(render(board({ prizes, total_players: 57 }))).not.toContain("нужно от");
  });

  it("я вне видимого топа — закреплённая строка с разрывом до последнего места", () => {
    const html = render(board());
    expect(html).toContain('class="tt-pin"');
    expect(html).toMatch(/tt-row me"><span class="tt-rank">30<\/span>/);
    // последний видимый — 12-е место с 890 очками: нужно 891 − 700
    expect(html).toContain("+191 до 12-го места");
  });

  it("я в видимом топе — без закреплённой строки, моя строка подсвечена", () => {
    const html = render(board({ entries: entries(12, 5), me: { rank: 5, score: 960 } }));
    expect(html).not.toContain("tt-pin");
    expect(html).toContain('class="tt-row me"');
    const html1 = render(board({ entries: entries(12, 1), me: { rank: 1, score: 1000 } }));
    expect(html1).toContain("tt-step p1 me");
  });

  it("ещё не играл в этом месяце — приглашение сыграть", () => {
    const html = render(board({ me: null }));
    expect(html).toContain("Вас нет в топе");
    expect(html).toMatch(/tt-pin[\s\S]*href="\/tower"/);
  });

  it("пустой месяц — без пьедестала, с кнопкой «Играть»", () => {
    const html = render(board({ entries: [], total_players: 0, me: null }));
    expect(html).toContain("Пока никто не сыграл");
    expect(html).toContain("Пока без игроков");
    expect(html).not.toContain("tt-podium");
    expect(html).not.toContain("tt-pin");
    expect(html).toContain('href="/tower"');
  });

  it("прошлый месяц — итоги вместо отсчёта, без призов и приглашения", () => {
    const html = render(board({ month: "2026-09", me: null, month_ends_at: "2026-09-30T21:00:00+00:00" }), "/tower/top?m=prev");
    expect(html).toContain("Сентябрь");
    expect(html).toContain("закрыт 1 октября");
    expect(html).not.toContain("До итогов");
    expect(html).not.toContain("tt-pin");
    expect(html).toContain("Итоги закрытого месяца не меняются");
    const empty = render(board({ month: "2026-09", entries: [], total_players: 0, me: null }), "/tower/top?m=prev");
    expect(empty).toContain("В сентябре никто не играл");
    expect(empty).not.toContain("Играть");
  });

  it("неполный пьедестал — свободные места", () => {
    const html = render(board({ entries: entries(2), total_players: 2, me: null }));
    expect(html).toContain("tt-step p3 free");
    expect(html).toContain("3-е место свободно");
  });

  it("стили: без backdrop-filter и бесконечных анимаций; движение гасится", () => {
    const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): { readFileSync(p: URL, e: string): string } } }).process.getBuiltinModule("node:fs");
    const css = fs.readFileSync(new URL("../styles/tower-top.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/prefers-reduced-motion[^}]*\.tt-step \{ animation: none/);
    expect(css).toContain("html.low-end .tt-step { animation: none; }");
  });
});
