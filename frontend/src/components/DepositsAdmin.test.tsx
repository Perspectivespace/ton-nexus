import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DepositsAdmin } from "./DepositsAdmin";
import type { AdminDeposit } from "@/api/hooks";

const dep: AdminDeposit = {
  id: 7,
  tx_hash: "ab".repeat(32),
  amount_ton: "2.5",
  status: "unmatched",
  memo: null,
  comment: "привет",
  from_address: "0:" + "cd".repeat(32),
  user_id: null,
  utime: 1_790_000_000,
  created_at: "2026-10-30T10:00:00+00:00",
};

function render(list: AdminDeposit[], isOwner: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  qc.setQueryData(["deposits", "admin"], list);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <DepositsAdmin isOwner={isOwner} />
    </QueryClientProvider>,
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("Касса → Пополнения", () => {
  it("владелец видит перевод и форму зачисления", () => {
    const t = render([dep], true);
    expect(t).toContain("2.5");
    expect(t).toContain("без мемо");
    expect(t).toContain("привет");
    expect(t).toContain("Telegram ID игрока");
    expect(t).toContain("Зачислить 2.5 TON");
  });
  it("админ видит список, но без зачисления", () => {
    const t = render([dep], false);
    expect(t).toContain("без мемо");
    expect(t).not.toContain("Telegram ID игрока");
    expect(t).toContain("только владелец");
  });
  it("пусто", () => {
    expect(render([], true)).toContain("Всё зачислено");
  });
});
