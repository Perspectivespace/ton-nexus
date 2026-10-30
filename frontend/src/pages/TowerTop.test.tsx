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
import TowerTop, { closedLines, pinGapText, placesWord } from "./TowerTop";
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

  const P3 = [
    { from_place: 1, to_place: 1, ton: "5.4545" },
    { from_place: 2, to_place: 2, ton: "2.7272" },
    { from_place: 3, to_place: 3, ton: "1.8181" },
  ];
  // 100 TON, 500 игроков: 25 мест, 11–20 и 21–25 — группами (как считает сервер)
  const P25 = [
    ...["26.2057", "13.1028", "8.7352", "6.5514", "5.2411", "4.3676", "3.7436", "3.2757", "2.9117", "2.6205"].map((t, i) => ({
      from_place: i + 1,
      to_place: i + 1,
      ton: t,
    })),
    { from_place: 11, to_place: 20, ton: "1.7525" },
    { from_place: 21, to_place: 25, ton: "1.1437" },
  ];
  // 100 TON, 2000 игроков: 100 мест, ниже видимого топа-50 — группа 51–100
  const P100 = [
    ...P25.slice(0, 10),
    { from_place: 11, to_place: 20, ton: "1.2892" },
    { from_place: 21, to_place: 50, ton: "0.5792" },
    { from_place: 51, to_place: 100, ton: "0.2653" },
  ];
  const on = (over: Partial<TowerLeaderboard>) =>
    board({ prize_budget_ton: "10", min_prize_ton: "0.1", min_score: 1, ...over });

  it("призы: 3 места при 20 игроках — чипы, фонд и сколько до 4-го места", () => {
    const html = render(on({ prizes: P3, prize_places: 3, participants: 20, total_players: 20, next_place_at: 21 }));
    expect(count(html, 'class="tt-prize"')).toBe(3);
    expect(html).toContain("5,4545 TON");
    expect(html).toContain("Призовой фонд 10 TON · 3 призовых места");
    expect(html).toContain("Ещё 1 игрок — и мест станет 4");
    expect(html).toContain("Ниже — без приза");
    expect(html).not.toContain("tt-band\"><span>");
  });

  it("призы: 25 мест — свои суммы до 10-го, дальше подписи групп", () => {
    const html = render(
      on({ prize_budget_ton: "100", prizes: P25, prize_places: 25, participants: 500, total_players: 500, next_place_at: 520, entries: entries(50) }),
    );
    expect(html).toContain("Призовой фонд 100 TON · 25 призовых мест");
    expect(html).toContain("Ещё 20 игроков — и мест станет 26");
    // 10 своих сумм (3 на пьедестале + 4…10 в списке) и 2 подписи групп
    expect(count(html, 'class="tt-prize"')).toBe(12);
    expect(html).toContain("<span>11–20 место</span>");
    expect(html).toContain("1,7525 TON");
    expect(html).toContain("<span>21–25 место</span>");
    expect(html.indexOf("21–25 место")).toBeLessThan(html.indexOf("Ниже — без приза"));
    expect(html).not.toContain("tt-below");
  });

  it("призы: 100 мест — группа 51–100 ниже видимого топа в «Призы ниже»", () => {
    const html = render(
      on({ prize_budget_ton: "100", prizes: P100, prize_places: 100, participants: 2000, total_players: 2000, next_place_at: 2020, entries: entries(50) }),
    );
    expect(html).toContain("100 призовых мест");
    expect(html).toContain("Призы ниже");
    expect(html).toMatch(/tt-below[\s\S]*51–100 место[\s\S]*0,2653 TON/);
    expect(html).not.toContain("Ниже — без приза");
  });

  it("призы: фонд не даёт больше мест — честно пишем почему", () => {
    const html = render(on({ prize_budget_ton: "5", prizes: P3, prize_places: 3, participants: 900, next_place_at: null, prize_limited_by: "budget" }));
    expect(html).toContain("Больше мест фонд не даёт: приз от 0,1 TON");
    const max = render(on({ prizes: P3, prize_places: 3, participants: 900, next_place_at: null, prize_limited_by: "max" }));
    expect(max).not.toContain("Ещё");
    expect(max).not.toContain("Больше мест");
  });

  it("призы: меньше минимума — фонд есть, чипов нет, сколько игроков не хватает", () => {
    const html = render(on({ prizes: [], prize_places: 0, participants: 7, total_players: 7, next_place_at: 10, entries: entries(7) }));
    expect(html).not.toContain("tt-prize");
    expect(html).toContain("Призовой фонд 10 TON");
    expect(html).toContain("Призы — от 10 игроков · ещё 3 игрока");
  });

  it("склонение числа мест", () => {
    expect(placesWord(1)).toBe("1 призовое место");
    expect(placesWord(21)).toBe("21 призовое место");
    expect(placesWord(22)).toBe("22 призовых места");
    expect(placesWord(12)).toBe("12 призовых мест");
    expect(placesWord(111)).toBe("111 призовых мест");
  });

  it("прошлый месяц — без призов и без фонда", () => {
    const html = render(on({ month: "2026-09", prizes: null, prize_budget_ton: null }), "/tower/top?m=prev");
    expect(html).toContain("Итоги закрытого месяца не меняются");
    expect(html).not.toContain("TON");
  });

  it("я вне видимого топа — разрыв до последнего ПРИЗОВОГО места", () => {
    // 3 приза, 3-е место набрало 980: мне (700) нужно 281
    const html = render(on({ prizes: P3, prize_places: 3, participants: 57, prize_cutoff_score: 980 }));
    expect(html).toContain('class="tt-pin"');
    expect(html).toMatch(/tt-row me"><span class="tt-rank">30<\/span>/);
    expect(html).toContain("+281 до 3-го места · приз 1,8181 TON");
    expect(pinGapText(board({ prizes: P100, prize_cutoff_score: 400 }), 70, 300)).toBe("Приз сейчас 0,2653 TON");
    expect(pinGapText(board({ prizes: P100, prize_cutoff_score: 400 }), 120, 300)).toBe("+101 до 100-го места · приз 0,2653 TON");
  });

  it("без призов — в закреплённой строке не обещаем «до N-го места»", () => {
    const html = render(board());
    expect(html).toMatch(/tt-row me"><span class="tt-rank">30<\/span>/);
    expect(html).not.toContain("tt-gap");
    expect(html).not.toMatch(/до \d+-го места/);
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

describe("закрытый месяц (вкладка «Прошлый»)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const P3 = [
    { from_place: 1, to_place: 1, ton: "5.4545" },
    { from_place: 2, to_place: 2, ton: "2.7272" },
    { from_place: 3, to_place: 3, ton: "1.8181" },
  ];
  const closed = (over: Partial<TowerLeaderboard> = {}): TowerLeaderboard => {
    const es = entries(12, 2);
    es[0] = { ...es[0], prize_ton: "5.4545", prize_status: "paid" };
    es[1] = { ...es[1], prize_ton: "2.7272", prize_status: "awaiting" };
    es[2] = { ...es[2], prize_ton: "1.8181", prize_status: "voided" };
    return board({
      month: "2026-09",
      month_ends_at: "2026-09-30T21:00:00+00:00",
      entries: es,
      total_players: 20,
      participants: 20,
      me: { rank: 2, score: 990, prize_ton: "2.7272", prize_status: "awaiting" },
      prizes: P3,
      prize_places: 3,
      prize_budget_ton: "10",
      prize_total_ton: "9.9998",
      prize_paid_ton: "5.4545",
      prize_awaiting_ton: "2.7272",
      closed: true,
      close_reason: null,
      ...over,
    });
  };

  it("у призов — статус выплаты; места замороженные", () => {
    const html = render(closed(), "/tower/top?m=prev");
    expect(html).toContain("закрыт 1 октября");
    expect(html).toContain('class="tt-prize paid"');
    expect(html).toContain('class="tt-prize awaiting"');
    expect(html).toContain('class="tt-prize voided"');
    expect(html).toContain(", выплачено");
    expect(html).toContain(", ждёт выплаты");
    expect(html).toContain(", аннулирован");
    expect(html).toContain("Фонд 10 TON · 3 призовых места");
    expect(html).toContain("Выплачено 5,4545 TON · ждут выплаты 2,7272 TON");
    // легенда вместо правил; отсчёта нет
    expect(html).toContain("tt-legend");
    expect(html).not.toContain("До итогов");
  });

  it("без призов — причина закрытия", () => {
    const few = closed({ prizes: null, prize_places: 0, prize_budget_ton: null, close_reason: "few_participants", entries: entries(7), me: null });
    expect(closedLines(few).main).toBe("Призов не было: меньше 10 игроков");
    const html = render(few, "/tower/top?m=prev");
    expect(html).toContain("Призов не было: меньше 10 игроков");
    expect(html).not.toContain("tt-prize");
    expect(closedLines(closed({ prizes: null, prize_places: 0, close_reason: "disabled" })).main).toBe("Призы в этом месяце не разыгрывались");
  });

  it("всё решено — «Призы выплачены»; моё место вне топа — приз со статусом", () => {
    expect(closedLines(closed({ prize_awaiting_ton: "0" })).sub).toBe("Призы выплачены · 5,4545 TON");
    expect(closedLines(closed({ prize_awaiting_ton: "0", prize_paid_ton: "0" })).sub).toBe("Призы аннулированы");
    expect(closedLines(closed({ prize_paid_ton: "0", prize_awaiting_ton: "9.9998" })).sub).toBe("9,9998 TON ждут выплаты");
    const html = render(
      closed({ entries: closed().entries.map((e) => ({ ...e, is_me: false })), me: { rank: 70, score: 10 } }),
      "/tower/top?m=prev",
    );
    expect(html).toMatch(/tt-row me"><span class="tt-rank">70<\/span>/);
  });

  it("текущий месяц не показывает статусы, даже если они пришли", () => {
    const html = render(closed({ month: "2026-10", month_ends_at: "2026-10-31T21:00:00+00:00", closed: false }));
    expect(html).not.toContain("tt-prize paid");
    expect(html).toContain("До итогов");
  });
});
