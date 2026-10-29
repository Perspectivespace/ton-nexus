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

function render(open: boolean, wheel?: { left_today: number }, best?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  if (wheel) qc.setQueryData(["wheel"], wheel);
  if (best != null) qc.setQueryData(["tower", "me"], { best_month: best });
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
});
