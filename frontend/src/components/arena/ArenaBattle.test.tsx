import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArenaBattle } from "./ArenaBattle";
import { battleRoom, iso, matchView, T0 } from "@/lib/arena/battle.fixture";
import type { ArenaRoom } from "@/lib/arena/api";

const html = (r: ArenaRoom) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ArenaBattle room={r} onDone={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("экран боя: рендер", () => {
  it("ход, живые, готовность по местам, таймер, поле, HUD, кнопки 48+ px, лента", () => {
    const h = html(battleRoom());
    expect(h).toContain('data-turn="3"');
    expect(h).toMatch(/Живых<\/span><b>3\/4<\/b>/);
    expect(h).toContain('aria-label="Готовы 1 из 3"');
    expect(h.match(/<li class="on"/g)).toHaveLength(1); // seat 1 готов
    expect(h).toContain("dead");
    expect(h).toContain('class="ar-cv"');
    expect(h).toContain('class="ar-cv-over"');
    expect(h).toContain("Кулаки");
    expect(h).toContain("Зона <b>9×9</b>");
    expect(h).toContain("Клетка — идти, соперник — атаковать");
    expect(h).toMatch(/class="ui-btn primary lg"[^>]*>Готово/);
    expect(h).toContain("Сброс");
    expect(h).toContain("Аптечка, 1 из 2");
    expect(h).toContain("Матч начался");
    expect(h).not.toContain("backdrop");
  });

  it("мой план уже «Готов» — «Изменить», метка «принято», план из сервера", () => {
    const h = html(
      battleRoom({ current: { turn: 3, opens_at: iso(T0), deadline: iso(T0 + 10_000), ready_seats: [0], my_plan: { plan: { path: [], attack: 1, medkit: false }, ready: true } } }),
    );
    expect(h).toContain("Изменить");
    expect(h).toContain("принято");
    expect(h).toContain("Ждём остальных игроков");
  });

  it("я выбыл — оверлей «Вы выбыли», место и ход; кнопок плана нет", () => {
    const players = matchView().players!.map((p) => (p.seat === 0 ? { ...p, alive: false, hp: 0, death_turn: 2 } : p));
    const h = html(battleRoom({ players }));
    expect(h).toContain("Вы выбыли");
    expect(h).toContain("3 место · ход 2");
    expect(h).toContain("Досмотреть");
    expect(h).toContain("Итоги");
    expect(h).not.toContain("Сброс");
  });

  it("бой окончен — «Бой окончен» и кнопка «Итоги»", () => {
    const h = html(battleRoom({ phase: "finished", finished: true, current: null }, { status: "finished" }));
    expect(h).toContain("Бой окончен");
    expect(h).toContain('data-phase="finished"');
  });

  it("поля ещё нет — заглушка загрузки", () => {
    expect(html(battleRoom({}, { match: { id: 1, turn: 1, current: null } }))).toContain("Загружаем поле");
  });
});
