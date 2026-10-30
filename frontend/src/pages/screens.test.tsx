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
import { ALIASES, aliasTarget, routeKey } from "@/lib/routes";
import { DailyCheckIn, days, hhmm, todayOf } from "@/components/DailyCheckIn";
import { Tasks, earnTab } from "./Tasks";
import { Wallet, levelTag } from "./Wallet";
import { WORK_NOTE } from "@/components/WorkArea";

const now = Date.now();
const rewards = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ day: d, ton: (0.002 * d).toFixed(4), xp: 10 * d, focus: d === 7 ? 1 : 0 }));
const player = { id: 1, telegram_id: 1, username: "p", first_name: "Игрок", balance: "1.2847", xp: 1240, level: 7, focus_tokens: 0, block_tokens: 0, success_boost_bp: 0, is_ambassador: false, is_admin: false, is_owner: false, can_deploy: false };
const owner = { ...player, is_owner: true, is_admin: true };
const daily = (done: boolean) => ({
  claimed_today: done, streak: done ? 5 : 4, check_date: "2026-10-30", cycle_day: 5, rewards,
  next_claim_at: done ? new Date(now + 5.2e6).toISOString() : null, server_time: new Date(now).toISOString(),
});

function render(node: ReactNode, url: string, seed: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData(k.split("/"), v);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("псевдонимы разделов", () => {
  it("/earn, /profile, /upgrade ведут на новые места, query сохраняется", () => {
    expect(ALIASES["/earn"]).toBe("/tasks");
    expect(aliasTarget("/earn", "?tab=promo")).toBe("/tasks?tab=promo");
    expect(aliasTarget("/profile/")).toBe("/wallet");
    expect(aliasTarget("/upgrade")).toBe("/miner?upgrade=1");
    expect(aliasTarget("/miner")).toBeNull();
  });
  it("предзагрузка по псевдониму берёт чанк целевого раздела", () => {
    expect(routeKey("/earn?tab=friends")).toBe("tasks");
    expect(routeKey("/profile")).toBe("wallet");
    expect(routeKey("/upgrade")).toBe("miner");
  });
});

describe("помощники «Заработка» и «Профиля»", () => {
  it("вкладка из ?tab=", () => {
    expect(earnTab("promo")).toBe("promo");
    expect(earnTab("friends")).toBe("friends");
    expect(earnTab(null)).toBe("tasks");
    expect(earnTab("x")).toBe("tasks");
  });
  it("склонение дней, день цикла, чч:мм", () => {
    expect([days(1), days(3), days(5), days(11), days(21), days(22)]).toEqual(["1 день", "3 дня", "5 дней", "11 дней", "21 день", "22 дня"]);
    expect(todayOf({ cycle_day: 5, streak: 4, claimed_today: false })).toBe(5);
    expect(todayOf({ cycle_day: undefined as unknown as number, streak: 7, claimed_today: false })).toBe(1);
    expect(hhmm("01:26:05")).toBe("01:27");
    expect(hhmm("00:00:01")).toBe("00:01");
    expect(hhmm("23:59:00")).toBe("23:59");
    expect(hhmm(null)).toBe("");
  });
  it("метка уровня", () => {
    expect(levelTag(undefined)).toBeNull();
    expect(levelTag({ level: 7, xp: 1240 })?.replace(/\s/g, " ")).toBe("ур. 7 · 1 240 XP");
  });
});

describe("ежедневная отметка", () => {
  it("можно забрать: награды с сервера и кнопка «Забрать»", () => {
    const t = text(render(<DailyCheckIn />, "/tasks", { daily: daily(false) }));
    expect(t).toContain("Забрать");
    expect(t).toContain("0.01"); // день 5 из rewards
    expect(t).not.toContain("Отметка получена");
  });
  it("после отметки — свёрнутая строка с серией, отсчётом и меткой N / 7", () => {
    const html = render(<DailyCheckIn />, "/tasks", { daily: daily(true) });
    const t = text(html);
    expect(t).toContain("Отметка получена");
    expect(t).toContain("5 / 7");
    expect(t).toMatch(/Серия 5 дней · следующая через \d\d:\d\d(?!:)/);
    expect(html).toMatch(/aria-expanded="false"/);
  });
});

describe("«Заработок»", () => {
  it("три вкладки; «Промокод» живёт здесь", () => {
    const t = text(render(<Tasks />, "/tasks?tab=promo", { me: player, daily: daily(false), tasks: [] }));
    expect(t).toMatch(/Задания.*Друзья.*Промокод/);
    expect(t.toLowerCase()).toContain("промокод");
    expect(t).not.toContain("+ Создать"); // игроку кнопки нет
  });
  it("«Друзья» — честная заглушка", () => {
    const t = text(render(<Tasks />, "/tasks?tab=friends", { me: player, daily: daily(false), tasks: [] }));
    expect(t).toContain("пока не начисляются");
  });
  it("команде — «+ Создать»", () => {
    const html = render(<Tasks />, "/tasks", { me: owner, daily: daily(false), tasks: [] });
    expect(html).toMatch(/href="\/tasks\/new"[^>]*>\s*\+ Создать/);
  });
});

describe("«Профиль»", () => {
  it("игрок: уровень, Вывод → История → Настройки, без промокода и «Управления»", () => {
    const t = text(render(<Wallet />, "/wallet", { me: player, "withdraw/mine": [], "withdraw/limits": { min_ton: "0.2" } }));
    expect(t).toContain("ур. 7");
    const i = ["Вывод", "История", "Настройки"].map((s) => t.indexOf(s));
    expect(i.every((x) => x >= 0)).toBe(true);
    expect(i).toEqual([...i].sort((a, b) => a - b));
    expect(t).not.toContain("Управление");
    expect(t.toLowerCase()).not.toContain("промокод");
  });
  it("команда: «Управление» последним, с подписью о видимости", () => {
    const t = text(render(<Wallet />, "/wallet", { me: owner, "withdraw/mine": [], "withdraw/limits": { min_ton: "0.2" } }));
    const w = t.indexOf("Управление");
    expect(w).toBeGreaterThan(t.indexOf("Настройки"));
    expect(t).toContain(WORK_NOTE);
  });
});

import { Miner } from "./Miner";
const miner = { upgrade_cost: "0.1", power: 3, capacity: 4, acceleration: 2, luck: 3, stability: 2, status: "running", started_at: new Date(now - 3.6e6).toISOString(), pending_reward: "0.002", accrued_now: "0.002", estimated_reward: "0.0066", storage_cap: "0.0066", cycle_hours: 12, capacity_bonus_pct: 30, luck_min_pct: 92, luck_max_pct: 118 };

describe("«Майнер»", () => {
  it("реактор, «Собрать» и одна строка «Усиление» без сетки плиток и ссылки на /upgrade", () => {
    const html = render(<Miner />, "/miner", { me: { ...player, success_boost_bp: 1000, miner }, miner });
    const t = text(html);
    expect(t).toContain("Собрать");
    expect(html.match(/class="[^"]*mn-up[^"]*"/g)?.length).toBe(1);
    expect(t).toContain("Усиление");
    expect(html).not.toContain('href="/upgrade"');
    expect(html).not.toContain("Усиление реактора"); // шторка закрыта
  });
});
