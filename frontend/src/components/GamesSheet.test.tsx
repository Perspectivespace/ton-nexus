import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  // framer-motion при «окне» вешает слушатель resize — в node достаточно заглушек
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GamesSheet from "./GamesSheet";

type Arena = { me?: { is_owner: boolean }; enabled?: boolean; waiting?: number[] };
function render(open: boolean, wheel?: { left_today: number }, best?: number, arena: Arena = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  if (wheel) qc.setQueryData(["wheel"], wheel);
  if (best != null) qc.setQueryData(["tower", "me"], { best_month: best });
  if (arena.me) qc.setQueryData(["me"], { ...arena.me, balance: "1.0" });
  if (arena.enabled != null) qc.setQueryData(["economy"], [{ key: "arena", value: { enabled: arena.enabled } }]);
  if (arena.waiting)
    qc.setQueryData(["arena", "rooms"], {
      types: arena.waiting.map((w, i) => ({ type: `a${i}`, seats: 4, board: 9, stake_nano: "100000000", prizes_nano: ["360000000"], pot_nano: "400000000", commission_bps: 1000, waiting: w })),
      active_room_id: null,
      server_time: "2026-11-02T12:00:00Z",
    });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GamesSheet open={open} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("шторка «Игры»", () => {
  it("закрытая — ничего не рисует", () => {
    expect(render(false)).toBe("");
  });

  it("строки состояния берут данные колеса и башни", () => {
    const html = render(true, { left_today: 1 }, 1240);
    expect(html).toContain('class="gs-st hot"');
    expect(html).toContain("1 бесплатное вращение");
    expect(html).toContain("Рекорд месяца · 1240");
  });

  it("две карточки-ссылки: Колесо удачи → /wheel, Башня → /tower; общая шапка с крестиком", () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html.match(/class="gs-card[^"]*"/g)).toEqual(['class="gs-card"', 'class="gs-card amber"']);
    expect(html.indexOf('href="/wheel"')).toBeLessThan(html.indexOf('href="/tower"'));
    // у «Башни» вторая ссылка «Топ» — рядом с основной, без вложенных <a>
    expect(html.indexOf('href="/tower"')).toBeLessThan(html.indexOf('href="/tower/top"'));
    expect(html).toMatch(/<a[^>]*class="gs-hit"[^>]*><\/a>/);
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<a /);
    expect(html).toContain("Колесо удачи");
    expect(html).toContain("Башня");
    expect(html).toContain('class="ui-sh-hd"');
    expect(html).toMatch(/<button[^>]*class="ui-x"[^>]*aria-label="Закрыть"/);
    expect(html).toContain("gs-grab");
    // заголовок связан с диалогом
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  describe("карточка «Арены»", () => {
    it("игрок: нет ответа лобби (закрыта) — карточки нет", () => {
      const html = render(true, undefined, undefined, { me: { is_owner: false } });
      expect(html).not.toContain("gs-feat");
      expect(html).not.toContain('href="/arena"');
    });

    it("игрок: лобби открыто — карточка первой, PvP · 0.1 TON · N ждут, без «тест»", () => {
      const html = render(true, undefined, undefined, { me: { is_owner: false }, waiting: [2, 1] });
      expect(html).toContain('class="gs-feat"');
      expect(html.indexOf('href="/arena"')).toBeLessThan(html.indexOf('href="/wheel"'));
      expect(html).toContain("PvP · 0.1 TON · 3 ждут");
      expect(html).toContain("NEW");
      expect(html).not.toContain("gs-test");
    });

    it("владелец: настройка выключена — карточка с бейджем «тест», включена — без", () => {
      const off = render(true, undefined, undefined, { me: { is_owner: true }, enabled: false });
      expect(off).toContain('class="gs-feat"');
      expect(off).toMatch(/class="gs-test">тест</);
      const on = render(true, undefined, undefined, { me: { is_owner: true }, enabled: true, waiting: [0, 0] });
      expect(on).toContain('class="gs-feat"');
      expect(on).not.toContain("gs-test");
    });
  });
});
