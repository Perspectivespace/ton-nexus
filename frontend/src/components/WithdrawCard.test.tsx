import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

// Касса не тянет TON Connect статически — кнопка «Выплатить» грузится лениво
vi.mock("@tonconnect/ui-react", () => {
  throw new Error("@tonconnect/ui-react imported statically");
});

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WithdrawCard, tonAmount, whoLabel } from "./WithdrawCard";
import type { PayoutConfig, WithdrawOut } from "@/api/hooks";

const item: WithdrawOut = {
  id: 12,
  user_id: 3,
  amount: "1.500000000",
  wallet_address: "UQ" + "D".repeat(46),
  status: "pending",
  admin_note: null,
  created_at: "2026-11-02T09:00:00+00:00",
  reviewed_at: null,
  payout_started_at: null,
  tx_hash: null,
  paid_at: null,
  user_telegram_id: 777,
  username: "vasya",
  first_name: "Вася",
} as WithdrawOut;

const cfg: PayoutConfig = { enabled: true, payout_wallet: "UQ" + "E".repeat(46), payout_wallet_raw: "0:" + "ee".repeat(32), network: "mainnet", is_owner: true };

const text = (it: WithdrawOut, config: PayoutConfig | undefined) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WithdrawCard item={it} config={config} isOwner onDone={() => {}} />
    </QueryClientProvider>,
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Касса → Вывод: карточка заявки", () => {
  it("кто, сколько и куда; кнопка выплаты грузится лениво", () => {
    const t = text(item, cfg);
    expect(t).toContain("Вася");
    expect(t).toContain("@vasya · tg 777");
    expect(t).toContain("1.5");
    expect(t).toContain(item.wallet_address);
    expect(t).toContain("копировать");
    expect(t).toContain("в холде");
    expect(t).toContain("Загрузка…"); // Suspense до чанка TON Connect
    expect(t).toContain("Проверить");
    expect(t).not.toContain("Одобрить");
  });
  it("выплаты не настроены — подсказка, без кнопки выплаты", () => {
    const t = text(item, { ...cfg, enabled: false });
    expect(t).toContain("Выплаты TON выключены");
    expect(t).toContain("Проверить");
  });
  it("отправляется — статус и время перевода", () => {
    const t = text({ ...item, status: "sending", payout_started_at: "2026-11-02T09:05:00+00:00" }, cfg);
    expect(t).toContain("отправляется");
    expect(t).toContain("Перевод выдан");
  });
  it("форматы", () => {
    expect(tonAmount("2.000000000")).toBe("2");
    expect(tonAmount("0.250000000")).toBe("0.25");
    expect(tonAmount("3")).toBe("3");
    expect(whoLabel({ ...item, first_name: null, username: null, user_telegram_id: null })).toEqual({ name: "#3", ids: "" });
    expect(whoLabel({ ...item, first_name: null })).toEqual({ name: "@vasya", ids: "tg 777" });
  });
});
