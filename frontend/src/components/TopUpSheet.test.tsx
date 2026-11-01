import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  g.location ??= { origin: "http://localhost" };
});

// TopUpSheet не должен тянуть TON Connect статически — только лениво, внутри провайдера
vi.mock("@tonconnect/ui-react", () => {
  throw new Error("@tonconnect/ui-react imported statically");
});

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopUpSheet, amountError } from "./TopUpSheet";
import { ensureConnected, type ConnectUI } from "@/lib/tonconnectFlow";
import type { DepositInfo } from "@/api/hooks";

const info: DepositInfo = { enabled: true, project_address: "UQ" + "A".repeat(46), memo: "TNABC234", min_ton: "0.1", network: "mainnet" };
const text = (info: DepositInfo | undefined) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TopUpSheet info={info} onClose={() => {}} />
    </QueryClientProvider>,
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("TopUpSheet", () => {
  it("выключено — без кнопки кошелька", () => {
    expect(text({ ...info, enabled: false })).toContain("Пополнение скоро");
    expect(text(undefined)).toContain("Загрузка");
  });
  it("включено — сумма, быстрые суммы и кнопка кошелька грузится лениво", () => {
    const t = text(info);
    expect(t).toContain("Сумма");
    expect(t).toContain("5 TON");
    expect(t).toContain("Минимум 0.1 TON");
    expect(t).toContain("Перевод с биржи");
  });
  it("проверка суммы", () => {
    expect(amountError("1", "0.1")).toBeNull();
    expect(amountError("0.000000001", "0")).toBeNull();
    expect(amountError("0.05", "0.1")).toBe("Минимум 0.1 TON");
    expect(amountError("1.0000000001", "0.1")).not.toBeNull();
    expect(amountError("abc", "0.1")).not.toBeNull();
    expect(amountError("", "0.1")).not.toBeNull();
    expect(amountError("10001", "0.1")).toBe("Не больше 10 000 TON");
  });
});

function fakeUI(connected = false) {
  let status: ((w: unknown) => void) | null = null;
  let modal: ((s: { status: string; closeReason: string | null }) => void) | null = null;
  const ui = {
    connected,
    connectionRestored: Promise.resolve(connected),
    onStatusChange: (cb: (w: unknown) => void) => ((status = cb), () => (status = null)),
    onModalStateChange: (cb: typeof modal) => ((modal = cb), () => (modal = null)),
    openModal: vi.fn(async () => {}),
  };
  return {
    ui: ui as unknown as ConnectUI,
    open: ui.openModal,
    connect: () => {
      ui.connected = true;
      status?.({ account: {} });
    },
    cancel: () => modal?.({ status: "closed", closeReason: "action-cancelled" }),
    subscribed: () => status !== null || modal !== null,
  };
}

describe("ensureConnected: сначала подключить, потом перевод", () => {
  it("уже подключён — модалку не открываем", async () => {
    const f = fakeUI(true);
    await ensureConnected(f.ui);
    expect(f.open).not.toHaveBeenCalled();
  });
  it("ждёт подключения кошелька, а не возврата openModal", async () => {
    const f = fakeUI();
    let done = false;
    const p = ensureConnected(f.ui).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(f.open).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    f.connect();
    await p;
    expect(done).toBe(true);
    expect(f.subscribed()).toBe(false);
  });
  it("закрыл модалку — ошибка, перевод не отправляется", async () => {
    const f = fakeUI();
    const p = ensureConnected(f.ui);
    await new Promise((r) => setTimeout(r, 0));
    f.cancel();
    await expect(p).rejects.toThrow("Кошелёк не подключён");
    expect(f.subscribed()).toBe(false);
  });
});
