import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Ratings, { RatingView, gapText, prizeText, ruleText } from "./Ratings";
import { ProfileRanks, TasksTopLink, tasksTopSub } from "@/components/RatingLinks";
import { FriendRulePreview } from "@/components/SettingEditor";
import { summarize } from "@/lib/settingsMeta";
import type { RatingBoard, RatingSummary } from "@/api/types";

const board = (over: Partial<RatingBoard> = {}): RatingBoard => ({
  kind: "tasks",
  period: "month",
  periods: ["month", "all"],
  month: "2026-10",
  month_ends_at: "2026-10-31T21:00:00+00:00",
  server_time: "2026-10-27T09:00:00+00:00",
  total_players: 5,
  entries: [
    { rank: 1, name: "Аня", value: 9, is_me: false },
    { rank: 2, name: "Борис", value: 7, is_me: false },
    { rank: 3, name: "Вера", value: 4, is_me: false },
    { rank: 4, name: "Гоша", value: 3, is_me: false },
  ],
  me: { rank: 5, value: 1, next_rank: 4, need: 3 },
  soon: false,
  rule: null,
  prize: null,
  ...over,
});

const summary: RatingSummary = {
  month: "2026-10",
  level: { rank: 12, value: 4, total: 300, soon: false },
  tasks: { rank: null, value: null, total: 41, soon: false },
  tower: { rank: 3, value: 900, total: 50, soon: false },
  friends: { rank: null, value: null, total: 0, soon: true },
  friend_rule: { min_level: 3, min_tasks: 20, need_both: false },
  prizes: { level: false, tasks: false, friends: false, tower: true },
};

function wrap(node: ReactNode, url = "/", seed?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("тексты топов", () => {
  it("до места выше — с окончаниями", () => {
    expect(gapText(board())).toBe("Ещё 3 задания — и вы 4-й");
    expect(gapText(board({ me: { rank: 9, value: 2, next_rank: 8, need: 1 } }))).toBe("Ещё 1 задание — и вы 8-й");
    expect(gapText(board({ me: { rank: 1, value: 9 } }))).toBe("Вы на первом месте");
  });

  it("уровень за всё время — опыт до следующего уровня", () => {
    const d = board({ kind: "level", period: "all", periods: ["all"], me: { rank: 56, value: 3, xp: 40, xp_to_next: 160 } });
    expect(gapText(d)).toBe("Ещё 160 XP до 4-го уровня");
    expect(ruleText(d)).toMatch(/^Уровень аккаунта/);
  });

  it("с призами: приз сейчас или сколько до последнего призового места", () => {
    const prize = {
      budget_ton: "10",
      places: 3,
      prizes: [
        { from_place: 1, to_place: 1, ton: "5.4545" },
        { from_place: 2, to_place: 2, ton: "2.7272" },
        { from_place: 3, to_place: 3, ton: "1.8181" },
      ],
      total_ton: "9.9998",
      next_place_at: 21,
      limited_by: null,
      min_participants: 3,
      min_score: 1,
      min_prize_ton: "0.1",
      participants: 5,
      cutoff_value: 4,
    } as const;
    const d = board({ prize: { ...prize, prizes: [...prize.prizes] } });
    expect(gapText(d)).toBe("+4 задания до 3-го места · приз 1,8181 TON");
    expect(gapText({ ...d, me: { rank: 2, value: 7 } })).toBe("Приз сейчас 2,7272 TON");
    expect(prizeText(d)).toEqual({ main: "Призовой фонд 10 TON · 3 призовых места", sub: "Ещё 16 участников — и мест станет 4" });
    const html = wrap(<RatingView d={d} onPeriod={() => {}} />);
    expect(html).toContain("Призовой фонд 10 TON");
    expect(html).toContain("Ниже — без приза");
    expect(html).toContain("Принятые задания за октябрь");
  });
});

describe("экран", () => {
  it("топ заданий: пьедестал, список, закреплённое место", () => {
    const html = wrap(<RatingView d={board()} onPeriod={() => {}} />);
    expect(html).toContain("Задания · октябрь");
    expect(html).toContain("5 игроков");
    expect(html).toContain("Гоша");
    expect(html).toContain("Ещё 3 задания — и вы 4-й");
    expect(html).toContain("Всё время");
  });

  it("не в топе — приглашение", () => {
    const html = wrap(<RatingView d={board({ me: null })} onPeriod={() => {}} />);
    expect(html).toContain("Вас нет в топе");
    expect(html).toContain("Одно принятое задание — и вы в таблице");
  });

  it("друзья «скоро»: надписи из настройки владельца", () => {
    const d = board({ kind: "friends", soon: true, entries: [], me: null, total_players: 0, rule: { min_level: 5, min_tasks: 0, need_both: false } });
    const html = wrap(<RatingView d={d} onPeriod={() => {}} />);
    expect(html).toContain("скоро");
    expect(html).toContain("Будем считать друзей, которые дошли до 5-го уровня");
    expect(html).toContain("Друг засчитается, когда дойдёт до 5-го уровня");
    expect(html).not.toContain("заданий");
    const both = wrap(<RatingView d={{ ...d, rule: { min_level: 3, min_tasks: 21, need_both: true } }} onPeriod={() => {}} />);
    expect(both).toContain("дошли до 3-го уровня и выполнили 21 задание");
  });

  it("друзья открыты, меня нет — подсказка из условия", () => {
    const d = board({ kind: "friends", me: null, rule: { min_level: 0, min_tasks: 2, need_both: false } });
    expect(wrap(<RatingView d={d} onPeriod={() => {}} />)).toContain("Друг засчитается, когда выполнит 2 задания");
  });

  it("/ratings?t=friends — вкладка друзей из кеша", () => {
    const d = board({ kind: "friends", soon: true, entries: [], me: null, rule: summary.friend_rule });
    const html = wrap(<Ratings />, "/ratings?t=friends&from=tasks", (qc) => qc.setQueryData(["ratings", "friends", "default"], d));
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Заработок");
    expect(html).toContain("дошли до 3-го уровня или выполнили 20 заданий");
  });
});

describe("точки входа", () => {
  const seed = (qc: QueryClient) => qc.setQueryData(["ratings", "summary"], summary);

  it("«Мои места»: места и прочерк", () => {
    const html = wrap(<ProfileRanks />, "/", seed);
    expect(html).toContain("Мои места");
    expect(html).toContain("Уровень: 12-е место");
    expect(html).toContain("Задания: пока без места");
    expect(html).toContain("/ratings?t=tower&amp;from=profile");
  });

  it("«Топ исполнителей · октябрь»", () => {
    const html = wrap(<TasksTopLink />, "/", seed);
    expect(html).toContain("Топ исполнителей · октябрь");
    expect(tasksTopSub(summary)).toBe("41 игрок в топе · одно задание — и вы там");
    expect(tasksTopSub({ ...summary, tasks: { rank: 2, value: 5, total: 41, soon: false } })).toBe("Вы 2-й из 41");
  });
});

describe("настройки владельца", () => {
  it("сводка и предпросмотр условия друга", () => {
    expect(summarize("friend_rule", { min_level: 3, min_tasks: 20, need_both: false })).toBe("3-й ур. или 20 заданий");
    expect(summarize("friend_rule", { min_level: 0, min_tasks: 0, need_both: false })).toBe("Сразу, без условий");
    expect(summarize("level_prizes", { enabled: false, budget_ton: "0" })).toBe("Выключены");
    const html = renderToStaticMarkup(<FriendRulePreview draft={{ min_level: "4", min_tasks: "1", need_both: "1" }} />);
    expect(html).toContain("Друзья, которые дошли до 4-го уровня и выполнили 1 задание");
    expect(html).toContain("Друг засчитается, когда дойдёт до 4-го уровня и выполнит 1 задание");
  });
});
