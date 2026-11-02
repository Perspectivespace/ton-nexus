import type { SendTransactionRequest } from "@tonconnect/ui-react";
import { ensureConnected, type ConnectUI } from "./tonconnectFlow";

/** Перевод заявки на вывод — собирает сервер (GET /withdraw/{id}/tx-payload) */
export type PayoutTx = {
  id: number;
  to: string;
  amount_nano: string;
  payload: string;
  comment: string;
  valid_until: number;
  network: string;
  payout_wallet: string;
  payout_wallet_raw: string;
};

export type PayoutUI = ConnectUI & {
  account: { address: string } | null;
  sendTransaction: (tx: SendTransactionRequest) => Promise<unknown>;
};

export class WrongWalletError extends Error {
  constructor(
    public connected: string,
    public expected: string,
  ) {
    super(`Подключён не кошелёк выплат. Выплаты идут только с ${short(expected)} — нажмите «Отключить» в блоке «Кошелёк выплат» и подключите его.`);
  }
}

export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);

/** TON Connect отдаёт адрес в raw-виде «0:hex» — сравниваем так же, без учёта регистра */
export function sameWallet(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (x: string) => x.trim().toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

/**
 * «Выплатить»: подключить кошелёк, убедиться, что это кошелёк выплат, получить перевод с сервера
 * и отправить его. Другой кошелёк — WrongWalletError до запроса payload (заявка не уходит в «отправляется»).
 */
export async function runPayout({
  ui,
  payoutWallet,
  payoutWalletRaw,
  fetchPayload,
}: {
  ui: PayoutUI;
  payoutWallet: string;
  payoutWalletRaw: string;
  fetchPayload: () => Promise<PayoutTx>;
}): Promise<PayoutTx> {
  await ensureConnected(ui);
  const connected = ui.account?.address ?? "";
  if (!sameWallet(connected, payoutWalletRaw)) throw new WrongWalletError(connected, payoutWallet);
  const tx = await fetchPayload();
  // настройку могли сменить, пока открыта Касса: сверяем с тем, что вернул сервер
  if (!sameWallet(connected, tx.payout_wallet_raw)) throw new WrongWalletError(connected, tx.payout_wallet);
  await ui.sendTransaction({
    validUntil: tx.valid_until,
    network: tx.network === "testnet" ? "-3" : "-239",
    from: tx.payout_wallet_raw, // кошелёк сам откажет, если подписывает не тот аккаунт
    messages: [{ address: tx.to, amount: tx.amount_nano, payload: tx.payload }],
  } as SendTransactionRequest);
  return tx;
}

export const isCancel = (msg: string) => /reject|declin|cancel|отклон|не подключ/i.test(msg);
