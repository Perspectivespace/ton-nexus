import { describe, expect, it, vi } from "vitest";

// telegram.ts читает window при импорте; в node-окружении подставляем минимальную заглушку
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
});
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Nav, dockItems, isDockRoute } from "./Nav";
import { Dock } from "./ui/Dock";

function render(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const labels = (html: string) => [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);

describe("нижний док из пяти мест", () => {
  it("порядок: Контур · Майнер · [Игры] · Заработок · Профиль", () => {
    const html = render("/");
    expect(labels(html)).toEqual(["Контур", "Майнер", "Игры", "Заработок", "Профиль"]);
    expect(html.match(/<a /g)).toHaveLength(4);
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/wallet"');
  });

  it("две равные группы по бокам и средний слот между ними", () => {
    const html = render("/");
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav.match(/class="dg"/g)).toHaveLength(2);
    const mid = nav.indexOf("dock-mid");
    expect(mid).toBeGreaterThan(nav.indexOf('href="/miner"'));
    expect(mid).toBeLessThan(nav.indexOf('href="/tasks"'));
  });

  it("кнопка «Игры» — диалоговая, закрыта, шторка не загружена до первого нажатия", () => {
    const html = render("/");
    expect(html).toMatch(/<button[^>]*class="dock-games"/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Игры"');
    expect(html).not.toContain("gs-sheet");
  });

  it("активный пункт и затемнение для экранов с лентой", () => {
    const home = render("/");
    expect(home).toMatch(/<nav class="ui-dock"/);
    const tasks = render("/tasks");
    expect(tasks).toMatch(/<nav class="ui-dock deep"/);
    expect(tasks).toMatch(/<a[^>]*class="active"[^>]*href="\/tasks"|<a[^>]*href="\/tasks"[^>]*class="active"/);
  });

  it("док виден только на корнях четырёх разделов", () => {
    for (const i of dockItems) expect(isDockRoute(i.to)).toBe(true);
    expect(isDockRoute("/tasks/")).toBe(true);
    for (const p of ["/wheel", "/tower", "/upgrade", "/tasks/12", "/owner"]) expect(isDockRoute(p)).toBe(false);
  });

  it("Dock без центра — прежняя плоская разметка", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dock items={dockItems} />
      </MemoryRouter>,
    );
    expect(html).not.toContain('class="dg"');
    expect(html.match(/<a /g)).toHaveLength(4);
  });
});
