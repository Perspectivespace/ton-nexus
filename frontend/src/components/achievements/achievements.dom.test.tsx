// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { setLang } from "@/i18n";
import { ToastProvider } from "@/components/ui";
import type { AchView } from "@/api/achievements";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ calls: [] as { path: string; init?: RequestInit }[], view: null as unknown, fresh: { items: [] as unknown[] }, wall: null as unknown }));
vi.mock("@/api/client", () => ({
  api: async (path: string, init?: RequestInit) => {
    m.calls.push({ path, init });
    if (path === "/api/v1/achievements") return m.view;
    if (path === "/api/v1/achievements/fresh") return m.fresh;
    if (path === "/api/v1/achievements/wall") return m.wall;
    if (path === "/api/v1/achievements/seen") return { seen: 1 };
    if (path === "/api/v1/achievements/pin") return { pin: JSON.parse(String(init?.body)).branch ? { branch: "tasks", tier: 10, metal: "bronze", index: 1, of: 3 } : null };
    throw new Error(`unexpected ${path}`);
  },
}));

import { Achievements } from "@/pages/Achievements";
import { AchCelebration } from "./AchCelebration";
import { AchievementsCard, branchShare } from "./AchievementsCard";
import { AuthorBadge } from "./AuthorBadge";
import { AchievementsWall } from "@/pages/AchievementsWall";

const VIEW: AchView = {
  enabled: true,
  pin: null,
  earned_ton: "0.03",
  done: 1,
  total: 3,
  branches: [
    {
      key: "tasks",
      value: 17,
      next: { at: 25, left: 8 },
      tiers: [
        { at: 10, ton: "0.03", xp: 10, metal: "bronze", index: 1, done: true, status: "paid", awarded_at: "2026-11-19T10:00:00" },
        { at: 25, ton: "0.06", xp: 20, metal: "silver", index: 2, done: false, status: null, awarded_at: null },
        { at: 50, ton: "0.1", xp: 30, metal: "neon", index: 3, done: false, status: null, awarded_at: null },
      ],
    },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement;
async function mount(el: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ToastProvider>{el}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await until(() => true); // один такт на первые запросы
}
/** дождаться условия: ответы «сервера» приходят асинхронно, под нагрузкой — не за один такт */
async function until(ok: () => boolean, tries = 60) {
  for (let i = 0; i < tries; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    if (ok()) return;
  }
}
const btn = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

beforeEach(() => {
  m.calls = [];
  m.view = VIEW;
  m.fresh = { items: [] };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  setLang("ru");
});

describe("достижения: экран игрока", () => {
  it("ветка с прогрессом: сколько до следующей ступени, сколько ступеней осталось", async () => {
    await mount(<Achievements />);
    await until(() => !!host.querySelector(".ach-tier"));
    expect(host.textContent).toContain("Задания");
    expect(host.textContent).toContain("До ступени 25: ещё 8");
    expect(host.textContent).toContain("осталось ступеней: 2");
    expect(host.textContent).toContain("1 из 3");
    expect(host.querySelectorAll(".ach-tier.done")).toHaveLength(1);
  });

  it("полученную ступень можно закрепить в профиле", async () => {
    await mount(<Achievements />);
    await until(() => !!host.querySelector(".ach-tier"));
    await act(async () => (host.querySelector(".ach-tier.done") as HTMLButtonElement).click());
    await act(async () => btn("Закрепить в профиле").click());
    await until(() => m.calls.some((c) => c.path === "/api/v1/achievements/pin"));
    const pin = m.calls.find((c) => c.path === "/api/v1/achievements/pin");
    expect(pin?.init?.method).toBe("PUT");
    expect(JSON.parse(String(pin?.init?.body))).toEqual({ branch: "tasks", tier: 10 });
  });

  it("неполученную ступень закрепить нельзя", async () => {
    await mount(<Achievements />);
    await until(() => !!host.querySelector(".ach-tier"));
    await act(async () => (host.querySelector(".ach-tier:not(.done)") as HTMLButtonElement).click());
    expect(btn("Закрепить в профиле")).toBeUndefined();
    expect(document.body.textContent).toContain("Не открыто");
  });

  it("на английском — английский текст", async () => {
    setLang("en");
    await mount(<Achievements />);
    await until(() => !!host.querySelector(".ach-tier"));
    expect(host.textContent).toContain("8 more to reach 25");
    expect(host.textContent).toContain("tiers left: 2");
  });
});

describe("достижения: профиль, окно, значок автора", () => {
  it("карточка профиля: подсказка закрепить и прогресс веток", async () => {
    await mount(<AchievementsCard />);
    await until(() => !!host.querySelector(".ach-mini"));
    expect(host.textContent).toContain("Откройте полученную ступень");
    expect(host.textContent).toContain("17 / 25");
    expect(branchShare(VIEW.branches[0])).toBeCloseTo(7 / 15);
  });

  it("праздничное окно: награда и отметка «показано»", async () => {
    m.fresh = { items: [{ id: 7, branch: "tasks", tier: 10, ton: "0.03", xp: 10, status: "paid", created_at: null, metal: "bronze", index: 1, of: 3 }] };
    await mount(<AchCelebration enabled />);
    await until(() => !!document.querySelector(".ach-cel"));
    expect(document.body.textContent).toContain("Новое достижение");
    expect(document.body.textContent).toContain("+0,03 TON");
    await act(async () => btn("Отлично").click());
    await until(() => !document.querySelector(".ach-cel"));
    const seen = m.calls.find((c) => c.path === "/api/v1/achievements/seen");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ ids: [7] });
    expect(document.querySelector(".ach-cel")).toBeNull();
  });

  it("крупная награда ждёт подтверждения — так и написано", async () => {
    m.fresh = { items: [{ id: 8, branch: "level", tier: 150, ton: "10", xp: 90, status: "pending", created_at: null, metal: "gold", index: 8, of: 11 }] };
    await mount(<AchCelebration enabled />);
    await until(() => !!document.querySelector(".ach-cel"));
    expect(document.body.textContent).toContain("Награда 10 TON придёт после подтверждения");
    await act(async () => btn("Отлично").click());
  });

  it("окно не запрашивается, пока выключено (заставка, знакомство)", async () => {
    await mount(<AchCelebration enabled={false} />);
    expect(m.calls).toHaveLength(0);
  });

  it("значок амбассадора на карточке: звание по ступени, RU и EN", async () => {
    await mount(<AuthorBadge badge={{ branch: "ambassador", tier: 50, metal: "gold", index: 3, of: 5 }} />);
    expect(host.textContent).toBe("Надёжный амбассадор");
    act(() => root?.unmount());
    setLang("en");
    await mount(<AuthorBadge badge={{ branch: "ambassador", tier: 300, metal: "neon", index: 5, of: 5 }} />);
    expect(host.textContent).toBe("Legendary Ambassador");
  });
});

describe("«Стена славы»", () => {
  const entry = (rank: number, name: string | null, holders: number, is_me = false) => ({
    rank, name, level: 10 + rank, count: 5 - rank, is_me, pin: null,
    rarest: { branch: "level" as const, tier: 300, metal: "neon" as const, index: 11, of: 11, holders },
  });

  it("редкая ступень, сколько у кого, и моё место ниже топа", async () => {
    m.wall = { entries: [entry(1, "Ann", 1), entry(2, null, 3)], total_players: 12, me: { rank: 9, count: 2, rarest: null } };
    await mount(<AchievementsWall />);
    await until(() => !!host.querySelector(".ach-wall-row"));
    const rows = [...host.querySelectorAll(".ach-wall-list .ach-wall-row")].map((r) => r.textContent);
    expect(rows[0]).toContain("Ann");
    expect(rows[0]).toContain("единственный обладатель");
    expect(rows[1]).toContain("Игрок");
    expect(rows[1]).toContain("есть у 3 игроков");
    expect(host.textContent).toContain("12 игроков с достижениями");
    expect(host.querySelector(".ach-wall-me")?.textContent).toContain("Ваше место");
    expect(host.querySelector(".ach-wall-me")?.textContent).toContain("9");
  });

  it("я в топе — отдельной строки нет; EN", async () => {
    setLang("en");
    m.wall = { entries: [entry(1, "Ann", 2, true)], total_players: 1, me: { rank: 1, count: 4, rarest: null } };
    await mount(<AchievementsWall />);
    await until(() => !!host.querySelector(".ach-wall-row"));
    expect(host.querySelector(".ach-wall-me")).toBeNull();
    expect(host.textContent).toContain("held by 2 players");
    expect(host.textContent).toContain("Account level · 300");
  });

  it("пустая стена", async () => {
    m.wall = { entries: [], total_players: 0, me: null };
    await mount(<AchievementsWall />);
    await until(() => host.textContent!.includes("Стена пока пуста"));
    expect(host.textContent).toContain("Получите ступень, чтобы попасть на стену");
  });
});
