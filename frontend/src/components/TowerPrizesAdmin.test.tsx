import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TowerPrizesAdmin, noteText, reasonText } from "./TowerPrizesAdmin";
import type { TowerPrizeMonth, TowerPrizeResult, TowerPrizesAdmin as Admin } from "@/api/types";

const row = (place: number, status: TowerPrizeResult["status"], over: Partial<TowerPrizeResult> = {}): TowerPrizeResult => ({
  id: place,
  place,
  user_id: 100 + place,
  name: `Игрок ${place}`,
  username: null,
  score: 1000 - place,
  game_id: place,
  booster: null,
  amount_ton: "1.5",
  status,
  note: null,
  paid_at: status === "paid" ? "2026-11-02T09:00:00+00:00" : null,
  banned: false,
  ...over,
});

const month = (over: Partial<TowerPrizeMonth> = {}): TowerPrizeMonth => ({
  id: 1,
  month: "2026-10",
  status: "payout",
  reason: null,
  total_players: 20,
  participants: 20,
  min_participants: 10,
  places: 4,
  budget_ton: "10",
  planned_ton: "6",
  paid_ton: "1.5",
  pending_ton: "3",
  closed_at: "2026-10-31T21:00:05+00:00",
  closed_auto: true,
  counts: { pending: 1, paid: 1, flagged: 1, voided: 1 },
  results: [
    row(1, "paid"),
    row(2, "pending", { booster: "slow", username: "anya" }),
    row(3, "flagged", { note: "replay_mismatch" }),
    row(4, "voided", { note: "banned", banned: true }),
  ],
  ...over,
});

function render(data: Admin) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  qc.setQueryData(["tower", "prizes-admin"], data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <TowerPrizesAdmin />
    </QueryClientProvider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("«Призы Башни» в Кассе", () => {
  it("строки: выплатить — только ждущим, одобрить — только на проверке; выплаченный не аннулируется", () => {
    const html = render({ months: [month()], unclosed: [], server_time: "2026-11-02T09:00:00+00:00" });
    expect(html).toContain("Призы Башни");
    expect(html).toContain("Октябрь");
    expect(count(html, ">Выплатить<")).toBe(1);
    expect(count(html, ">Одобрить<")).toBe(1);
    expect(count(html, ">Аннулировать<")).toBe(2);
    expect(html).toContain("Выплатить всем · 1");
    expect(html).toContain("Повтор забега не дал записанный счёт — выплата после вашей проверки");
    expect(html).toContain("Игрок забанен до выплаты — приз сгорает");
    expect(html).toContain("@anya");
    expect(html).toContain("с бустером");
    expect(html).toContain("1,5 TON");
    expect(html).not.toContain("Закрыть месяц");
  });

  it("незакрытый месяц — кнопка «Закрыть месяц»; без призов — причина", () => {
    const html = render({
      months: [month({ status: "no_prizes", reason: "few_participants", participants: 7, places: 0, results: [], counts: { pending: 0, paid: 0, flagged: 0, voided: 0 } })],
      unclosed: ["2026-09"],
      server_time: "2026-11-02T09:00:00+00:00",
    });
    expect(html).toContain("Закрыть месяц");
    expect(html).toContain("Участников 7 из 10 нужных — призов нет");
    expect(html).not.toContain("Выплатить всем");
  });

  it("всё выплачено — нет кнопки «Выплатить всем»; пусто — подсказка", () => {
    const done = render({
      months: [month({ status: "settled", pending_ton: "0", counts: { pending: 0, paid: 3, flagged: 0, voided: 0 }, results: [row(1, "paid"), row(2, "paid"), row(3, "paid")] })],
      unclosed: [],
      server_time: "",
    });
    expect(done).not.toContain("Выплатить всем");
    expect(done).not.toContain(">Выплатить<");
    expect(render({ months: [], unclosed: [], server_time: "" })).toContain("Закрытых месяцев пока нет");
  });

  it("подписи причин", () => {
    expect(reasonText({ reason: "disabled", participants: 30, min_participants: 10 })).toBe("Призы в этом месяце были выключены");
    expect(noteText({ status: "flagged", note: "no_game" })).toContain("Лучший забег не найден");
    expect(noteText({ status: "pending", note: "approved:replay_mismatch" })).toBe("Проверено владельцем вручную");
    expect(noteText({ status: "paid", note: null })).toBeNull();
  });

  it("стили: без backdrop-filter и бесконечных анимаций", () => {
    const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): { readFileSync(p: URL, e: string): string } } }).process.getBuiltinModule("node:fs");
    const css = fs.readFileSync(new URL("../styles/tower-prizes.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/infinite|animation/);
  });
});
