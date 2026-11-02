import { describe, expect, it, vi } from "vitest";
import { runPayout, sameWallet, WrongWalletError, type PayoutTx, type PayoutUI } from "./payoutFlow";

const RAW = "0:" + "ab".repeat(32);
const OTHER = "0:" + "cd".repeat(32);
const FRIENDLY = "UQ" + "B".repeat(46);

const tx = (over: Partial<PayoutTx> = {}): PayoutTx => ({
  id: 5,
  to: "UQ" + "C".repeat(46),
  amount_nano: "1500000000",
  payload: "te6cc",
  comment: "TN payout #5",
  valid_until: 1_800_000_000,
  network: "mainnet",
  payout_wallet: FRIENDLY,
  payout_wallet_raw: RAW,
  ...over,
});

function fakeUI(address: string | null, connected = true) {
  let status: ((w: unknown) => void) | null = null;
  let modal: ((s: { status: string; closeReason: string | null }) => void) | null = null;
  const ui = {
    connected,
    connectionRestored: Promise.resolve(connected),
    account: address ? { address } : null,
    onStatusChange: (cb: (w: unknown) => void) => ((status = cb), () => (status = null)),
    onModalStateChange: (cb: typeof modal) => ((modal = cb), () => (modal = null)),
    openModal: vi.fn(async () => {}),
    sendTransaction: vi.fn(async (_tx: unknown) => ({ boc: "x" })),
  };
  return {
    ui: ui as unknown as PayoutUI,
    raw: ui,
    connect: (addr: string) => {
      ui.connected = true;
      ui.account = { address: addr };
      status?.({ account: { address: addr } });
    },
    cancel: () => modal?.({ status: "closed", closeReason: "action-cancelled" }),
  };
}

describe("Касса → «Выплатить»: только с кошелька выплат", () => {
  it("подключён другой кошелёк — ошибка, payload не запрашиваем, ничего не отправляем", async () => {
    const f = fakeUI(OTHER);
    const fetchPayload = vi.fn(async () => tx());
    const p = runPayout({ ui: f.ui, payoutWallet: FRIENDLY, payoutWalletRaw: RAW, fetchPayload });
    await expect(p).rejects.toBeInstanceOf(WrongWalletError);
    await expect(p).rejects.toThrow(/не кошелёк выплат/);
    await expect(p).rejects.not.toThrow(/личн/);
    expect(fetchPayload).not.toHaveBeenCalled();
    expect(f.raw.sendTransaction).not.toHaveBeenCalled();
  });

  it("кошелёк выплат — перевод на адрес заявки с payload сервера, from и сетью", async () => {
    const f = fakeUI(RAW.toUpperCase().replace("0X", "0x"));
    const fetchPayload = vi.fn(async () => tx());
    const out = await runPayout({ ui: f.ui, payoutWallet: FRIENDLY, payoutWalletRaw: RAW, fetchPayload });
    expect(out.id).toBe(5);
    expect(fetchPayload).toHaveBeenCalledOnce();
    expect(f.raw.sendTransaction).toHaveBeenCalledWith({
      validUntil: 1_800_000_000,
      network: "-239",
      from: RAW,
      messages: [{ address: tx().to, amount: "1500000000", payload: "te6cc" }],
    });
  });

  it("testnet — сеть -3", async () => {
    const f = fakeUI(RAW);
    await runPayout({ ui: f.ui, payoutWallet: FRIENDLY, payoutWalletRaw: RAW, fetchPayload: async () => tx({ network: "testnet" }) });
    expect(f.raw.sendTransaction.mock.calls[0][0]).toMatchObject({ network: "-3" });
  });

  it("сервер вернул другой кошелёк выплат (настройку сменили) — не отправляем", async () => {
    const f = fakeUI(RAW);
    const p = runPayout({
      ui: f.ui,
      payoutWallet: FRIENDLY,
      payoutWalletRaw: RAW,
      fetchPayload: async () => tx({ payout_wallet_raw: OTHER, payout_wallet: "UQother" }),
    });
    await expect(p).rejects.toBeInstanceOf(WrongWalletError);
    expect(f.raw.sendTransaction).not.toHaveBeenCalled();
  });

  it("не подключён — сначала модалка; подключили чужой — блок", async () => {
    const f = fakeUI(null, false);
    const fetchPayload = vi.fn(async () => tx());
    const p = runPayout({ ui: f.ui, payoutWallet: FRIENDLY, payoutWalletRaw: RAW, fetchPayload });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.raw.openModal).toHaveBeenCalledOnce();
    f.connect(OTHER);
    await expect(p).rejects.toBeInstanceOf(WrongWalletError);
    expect(fetchPayload).not.toHaveBeenCalled();
  });

  it("закрыли модалку — отмена, без payload", async () => {
    const f = fakeUI(null, false);
    const fetchPayload = vi.fn(async () => tx());
    const p = runPayout({ ui: f.ui, payoutWallet: FRIENDLY, payoutWalletRaw: RAW, fetchPayload });
    await new Promise((r) => setTimeout(r, 0));
    f.cancel();
    await expect(p).rejects.toThrow(/не подключ/);
    expect(fetchPayload).not.toHaveBeenCalled();
  });

  it("нет адреса выплат в настройке — блок", async () => {
    const f = fakeUI(RAW);
    await expect(runPayout({ ui: f.ui, payoutWallet: "", payoutWalletRaw: "", fetchPayload: async () => tx() })).rejects.toBeInstanceOf(
      WrongWalletError,
    );
    expect(sameWallet(RAW, RAW.toUpperCase())).toBe(true);
    expect(sameWallet("", "")).toBe(false);
  });
});
